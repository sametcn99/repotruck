import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { type RateLimitRetryOptions, withRateLimitRetry } from "./rateLimit.ts";

export const GIST_ID_PATTERN = /^[0-9a-f]{1,64}$/;

export function gistId(ref: string): string {
  const input = ref.trim();
  if (GIST_ID_PATTERN.test(input.toLowerCase())) return input.toLowerCase();
  try {
    const url = new URL(input);
    const parts = url.pathname.replace(/^\//, "").replace(/\/$/, "").split("/");
    const id = parts
      .at(-1)
      ?.replace(/\.git$/i, "")
      .toLowerCase();
    if (
      url.origin === "https://gist.github.com" &&
      !url.username &&
      !url.password &&
      (parts.length === 1 || (parts.length === 2 && /^[\w-]+$/.test(parts[0] ?? ""))) &&
      id &&
      GIST_ID_PATTERN.test(id)
    )
      return id;
  } catch {
    // A reference must be either a bare ID or a GitHub Gist URL.
  }
  throw new Error("Expected a GitHub Gist ID or https://gist.github.com URL");
}

export interface GistInfo {
  id: string;
  owner: string | null;
  description: string;
  public: boolean;
  updatedAt: string | null;
  files: string[];
  url: string;
}

export interface GistDetail extends GistInfo {
  version: string;
  truncated: boolean;
  contents: Record<string, string | null>;
}

export interface GistFile {
  name: string;
  content: string;
}

export interface GistRename {
  from: string;
  to: string;
}

export interface GistEdit {
  description?: string;
  files?: readonly GistFile[];
  rename?: readonly GistRename[];
  remove?: readonly string[];
  expectedVersion?: string;
}

export interface GistCreate {
  description?: string;
  public?: boolean;
  files: readonly GistFile[];
}

type FilePatch = Record<string, { content?: string; filename?: string } | null>;
type Request = Octokit["request"];

export function gistFileName(name: string): string {
  if (
    !name ||
    name !== name.trim() ||
    name.endsWith(".") ||
    /[<>:"/\\|?*\p{Cc}]/u.test(name) ||
    /^(?:\.git|gistfile\d+|(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?)$/i.test(name)
  )
    throw new Error(
      `Expected a portable Gist filename without directories: ${JSON.stringify(name)}`,
    );
  return name;
}

function readGist(data: unknown): GistDetail {
  const row = data as {
    id: string;
    owner?: { login?: string } | null;
    description?: string | null;
    public: boolean;
    updated_at?: string;
    files?: Record<string, { content?: string; encoding?: string; truncated?: boolean }>;
    history?: { version?: string }[];
    truncated?: boolean;
  };
  const id = typeof row?.id === "string" ? row.id.toLowerCase() : null;
  if (typeof id !== "string" || !GIST_ID_PATTERN.test(id) || typeof row.public !== "boolean") {
    throw new Error("GitHub returned invalid Gist metadata");
  }
  const files = Object.keys(row.files ?? {});
  const updatedAt = row.updated_at ?? null;
  return {
    id,
    owner: row.owner?.login ?? null,
    description: row.description ?? "",
    public: row.public,
    updatedAt,
    files,
    url: `https://gist.github.com/${id}`,
    version: createHash("sha256")
      .update(JSON.stringify([row.history?.[0]?.version, updatedAt, row.description]))
      .digest("hex"),
    truncated: row.truncated === true,
    contents: Object.fromEntries(
      Object.entries(row.files ?? {}).map(([name, file]) => [
        name,
        typeof file.content === "string" &&
        file.truncated !== true &&
        (file.encoding === undefined || file.encoding === "utf-8")
          ? file.content
          : null,
      ]),
    ),
  };
}

export function gistSummary({
  version: _version,
  contents: _contents,
  truncated: _truncated,
  ...summary
}: GistDetail): GistInfo {
  return summary;
}

function gistApiError(error: unknown): Error {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 401 || status === 403) {
    return new Error(
      "GitHub denied Gist access. Run repotruck auth logout and repotruck auth login to renew a device token, or supply a token with gist scope or Gists write permission.",
    );
  }
  if (status === 404) return new Error("Gist unavailable or inaccessible");
  if (status === 422)
    return new Error("GitHub rejected the Gist changes; check the file names and contents");
  if (status === 429) return new Error("GitHub Gist API rate limit reached");
  return new Error("GitHub Gist API request failed");
}

export class GistApi {
  private readonly request: Request;
  private readonly retry: RateLimitRetryOptions | undefined;

  constructor(request: Request, retry?: RateLimitRetryOptions) {
    this.request = request;
    this.retry = retry;
  }

  private async call<T>(read: boolean, request: () => Promise<{ data: T }>): Promise<T> {
    try {
      const response = read ? await withRateLimitRetry(request, this.retry) : await request();
      return response.data;
    } catch (error) {
      throw gistApiError(error);
    }
  }

  async list(login: string): Promise<GistInfo[]> {
    const items: GistInfo[] = [];
    for (let page = 1; ; page++) {
      const data = await this.call(true, () => this.request("GET /gists", { page, per_page: 100 }));
      for (const item of data) {
        const gist = gistSummary(readGist(item));
        if (gist.owner?.toLowerCase() === login.toLowerCase()) items.push(gist);
      }
      if (data.length < 100) return items;
    }
  }

  async get(id: string): Promise<GistDetail> {
    const data = await this.call(true, () => this.request("GET /gists/{gist_id}", { gist_id: id }));
    const gist = readGist(data);
    if (gist.id !== id) throw new Error("GitHub returned a different Gist ID");
    return gist;
  }

  async create(input: GistCreate): Promise<GistInfo> {
    const files = fileContents(input.files);
    if (Object.keys(files).length === 0) throw new Error("At least one Gist file is required");
    const data = await this.call(false, () =>
      this.request("POST /gists", {
        files,
        description: input.description,
        public: input.public === true,
      }),
    );
    return gistSummary(readGist(data));
  }

  async edit(current: GistDetail, input: GistEdit): Promise<GistInfo> {
    const files = editFiles(current, input);
    if (input.description === undefined && Object.keys(files).length === 0) {
      throw new Error("Specify a description or a file change");
    }
    const data = await this.call(false, () =>
      this.request({
        method: "PATCH",
        url: "/gists/{gist_id}",
        gist_id: current.id,
        files,
        description: input.description,
      }),
    );
    return gistSummary(readGist(data));
  }

  async delete(id: string): Promise<void> {
    await this.call(false, () => this.request("DELETE /gists/{gist_id}", { gist_id: id }));
  }
}

function fileContents(files: readonly GistFile[]): Record<string, { content: string }> {
  const keys = new Set<string>();
  return Object.fromEntries(
    files.map(({ name, content }) => {
      if (content.includes("\0")) throw new Error("Gist API files must be UTF-8 text");
      const key = gistFileName(name).toLowerCase();
      if (keys.has(key)) throw new Error("Duplicate Gist filename");
      keys.add(key);
      return [name, { content }];
    }),
  );
}

function editFiles(current: GistDetail, input: GistEdit): FilePatch {
  const files: FilePatch = Object.assign(Object.create(null), fileContents(input.files ?? []));
  const names = new Set(current.files);
  const touched = new Set<string>();
  const rename = input.rename ?? [];
  const remove = input.remove ?? [];
  if (
    current.truncated &&
    (Object.keys(files).length > 0 || rename.length > 0 || remove.length > 0)
  ) {
    throw new Error("The GitHub file list is incomplete; edit the local Git clone instead");
  }
  for (const name of remove) {
    if (!names.has(name) || Object.hasOwn(files, name))
      throw new Error("Invalid Gist file removal");
    names.delete(name);
    touched.add(name);
    files[name] = null;
  }
  for (const { from, to } of rename) {
    if (
      !names.has(from) ||
      touched.has(from) ||
      from === to ||
      current.files.includes(to) ||
      names.has(to) ||
      Object.hasOwn(files, to)
    ) {
      throw new Error("Invalid Gist file rename");
    }
    gistFileName(to);
    names.delete(from);
    names.add(to);
    touched.add(to);
    files[from] = { ...files[from], filename: to };
  }
  const renamed = new Set(rename.map(({ from }) => from));
  for (const name of Object.keys(files)) {
    if (files[name] !== null && !renamed.has(name)) names.add(name);
  }
  if (Object.keys(files).length > 0 && names.size === 0) {
    throw new Error("Keep at least one file in the Gist");
  }
  if (new Set([...names].map((name) => name.toLowerCase())).size !== names.size) {
    throw new Error("Duplicate Gist filename");
  }
  return files;
}
