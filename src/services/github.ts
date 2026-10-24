import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { Octokit } from "@octokit/rest";
import { writeFileAtomic } from "./fsUtils.ts";
import { type RateLimitRetryOptions, withRateLimitRetry } from "./rateLimit.ts";

export interface RepoInfo {
  owner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  language: string | null;
  httpsUrl: string;
  sshUrl: string;
  updatedAt: string | null;
  stars?: number | null;
}

export interface CreateRepoOptions {
  org?: string;
  private: boolean;
  description?: string;
}

export interface GitHubRepoReader {
  getRepo(owner: string, name: string): Promise<RepoInfo>;
}

export interface GitHubRepoCreator {
  createRepo(name: string, options: CreateRepoOptions): Promise<RepoInfo>;
}

/** One conditional-request cache entry: the etag plus the body it validated. */
export interface EtagCacheEntry {
  etag: string;
  body: unknown;
  savedAt: number;
}

export interface EtagCacheStore {
  get(key: string): Promise<EtagCacheEntry | null>;
  set(key: string, entry: EtagCacheEntry): Promise<void>;
}

export const ETAG_CACHE_MAX_ENTRIES = 500;
export const ETAG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isEtagCacheEntry(value: unknown): value is EtagCacheEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<EtagCacheEntry>;
  return typeof entry.etag === "string" && typeof entry.savedAt === "number";
}

/**
 * A JSON-file-backed etag cache. Writes are batched in memory and flushed on a
 * short timer (for long-running processes like the MCP server) and on process
 * exit (for one-shot CLI runs), so bulk prune checks do not rewrite the file
 * hundreds of times.
 */
export function fileEtagCache(
  file: string,
  options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {},
): EtagCacheStore {
  const maxEntries = options.maxEntries ?? ETAG_CACHE_MAX_ENTRIES;
  const ttlMs = options.ttlMs ?? ETAG_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  let cache: Map<string, EtagCacheEntry> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const load = (): Map<string, EtagCacheEntry> => {
    if (cache !== null) return cache;
    const loaded = new Map<string, EtagCacheEntry>();
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isEtagCacheEntry(value)) loaded.set(key, value);
        }
      }
    } catch {
      /* a missing or corrupt cache file starts empty */
    }
    cache = loaded;
    return loaded;
  };

  const persistNow = (sync: boolean): void => {
    if (!dirty || cache === null) return;
    dirty = false;
    let entries = [...cache.entries()];
    if (entries.length > maxEntries) {
      entries = entries.sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, maxEntries);
      cache = new Map(entries);
    }
    const content = JSON.stringify(Object.fromEntries(entries));
    try {
      if (sync) {
        // Only synchronous I/O completes from the process-exit handler.
        const tmp = `${file}.tmp-${process.pid}`;
        writeFileSync(tmp, content, "utf8");
        renameSync(tmp, file);
      } else {
        void writeFileAtomic(file, content).catch(() => {
          /* a failed cache write must never break API calls */
        });
      }
    } catch {
      /* a failed cache write must never break API calls */
    }
  };

  const schedulePersist = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      persistNow(false);
    }, 500);
    timer.unref?.();
  };

  // One-shot CLI processes exit before the debounce fires; flush then.
  process.once("exit", () => persistNow(true));

  return {
    async get(key) {
      const entry = load().get(key);
      if (entry === undefined) return null;
      if (now() - entry.savedAt > ttlMs) {
        load().delete(key);
        return null;
      }
      return entry;
    },
    async set(key, entry) {
      load().set(key, entry);
      dirty = true;
      schedulePersist();
    },
  };
}

function isHttpStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" && error !== null && (error as { status?: unknown }).status === status
  );
}

function cleanHttpsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function ownerLogin(raw: unknown): string {
  if (typeof raw === "object" && raw !== null) {
    const login = (raw as { login?: unknown }).login;
    if (typeof login === "string" && login.length > 0) return login;
  }
  return "unknown";
}

export function toRepoInfo(input: unknown): RepoInfo {
  const repo = (input ?? {}) as Record<string, unknown>;
  const owner = ownerLogin(repo.owner);
  const name = firstString(repo.name) ?? "unknown";
  const httpsUrl = firstString(repo.clone_url) ?? `https://github.com/${owner}/${name}.git`;
  const sshUrl = firstString(repo.ssh_url) ?? `git@github.com:${owner}/${name}.git`;
  return {
    owner,
    name,
    description: typeof repo.description === "string" ? repo.description : null,
    isPrivate: repo.private === true,
    isFork: repo.fork === true,
    isArchived: repo.archived === true,
    language: typeof repo.language === "string" ? repo.language : null,
    httpsUrl: cleanHttpsUrl(httpsUrl),
    sshUrl,
    updatedAt: firstString(repo.updated_at),
    stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : null,
  };
}

export function orgLoginsFromMemberships(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const logins: string[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const organization = (item as { organization?: unknown }).organization;
    if (organization === null || typeof organization !== "object") continue;
    const login = (organization as { login?: unknown }).login;
    if (typeof login === "string" && login.length > 0 && !logins.includes(login)) {
      logins.push(login);
    }
  }
  return logins;
}

export interface GitHubServiceDeps {
  octokit?: Octokit;
  retry?: RateLimitRetryOptions;
  baseUrl?: string;
  /** Optional etag cache: makes repeated getRepo calls conditional (304 = zero payload). */
  etagCache?: EtagCacheStore;
}

function etagOf(headers: unknown): string | null {
  if (headers === null || typeof headers !== "object") return null;
  const raw = (headers as Record<string, unknown>).etag;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) return raw[0];
  return null;
}

export class GitHubService implements GitHubRepoReader, GitHubRepoCreator {
  private readonly octokit: Octokit;
  private readonly retry: RateLimitRetryOptions | undefined;
  private readonly etagCache: EtagCacheStore | undefined;

  constructor(token: string, deps: GitHubServiceDeps = {}) {
    this.octokit =
      deps.octokit ??
      new Octokit({
        auth: token,
        ...(deps.baseUrl !== undefined ? { baseUrl: deps.baseUrl } : {}),
      });
    this.retry = deps.retry;
    this.etagCache = deps.etagCache;
  }

  private wrap<T>(fn: () => Promise<T>): Promise<T> {
    return withRateLimitRetry(fn, this.retry);
  }

  /**
   * Manual pagination with one retry-wrapped request per page, so a transient
   * failure on page N refetches only that page instead of the whole list.
   */
  private async paginateViaRequest<T>(
    url: string,
    params: Record<string, unknown>,
    mapItem: (raw: unknown) => T,
  ): Promise<T[]> {
    const perPage = 100;
    const results: T[] = [];
    let page = 1;
    for (;;) {
      const { data } = await this.wrap(() =>
        this.octokit.request(url, { ...params, per_page: perPage, page }),
      );
      const items = Array.isArray(data) ? (data as unknown[]) : [];
      for (const item of items) {
        results.push(mapItem(item));
      }
      if (items.length < perPage) break;
      page += 1;
    }
    return results;
  }

  async getUserLogin(): Promise<string> {
    const { data } = await this.wrap(() => this.octokit.rest.users.getAuthenticated());
    return data.login;
  }

  async getActiveOrgs(): Promise<string[]> {
    const memberships = await this.paginateViaRequest(
      "GET /user/memberships/orgs",
      { state: "active" },
      (raw) => raw,
    );
    return orgLoginsFromMemberships(memberships);
  }

  async listUserRepos(): Promise<RepoInfo[]> {
    return this.paginateViaRequest("GET /user/repos", { type: "owner" }, toRepoInfo);
  }

  async listOrgRepos(org: string): Promise<RepoInfo[]> {
    return this.paginateViaRequest("GET /orgs/{org}/repos", { org }, toRepoInfo);
  }

  async getRepo(owner: string, name: string): Promise<RepoInfo> {
    // getRepo backs prune's per-repository existence checks; sending
    // If-None-Match turns unchanged repositories into cheap 304s.
    const cacheKey = `repos/${owner.toLowerCase()}/${name.toLowerCase()}`;
    const cached = this.etagCache === undefined ? null : await this.etagCache.get(cacheKey);
    // Octokit types every non-error status as 200; 304 arrives at runtime.
    const response = (await this.wrap(() =>
      this.octokit.request("GET /repos/{owner}/{repo}", {
        owner,
        repo: name,
        ...(cached !== null ? { headers: { "If-None-Match": cached.etag } } : {}),
      }),
    )) as { status: number; data: unknown; headers: unknown };
    if (response.status === 304) {
      if (cached === null) {
        throw new Error(`unexpected 304 without a cached entry for ${owner}/${name}`);
      }
      return toRepoInfo(cached.body);
    }
    const info = toRepoInfo(response.data);
    if (this.etagCache !== undefined) {
      const etag = etagOf(response.headers);
      if (etag !== null) {
        await this.etagCache.set(cacheKey, {
          etag,
          body: response.data,
          savedAt: Date.now(),
        });
      }
    }
    return info;
  }

  async archiveRepo(owner: string, name: string): Promise<RepoInfo> {
    const { data } = await this.wrap(() =>
      this.octokit.rest.repos.update({ owner, repo: name, archived: true }),
    );
    return toRepoInfo(data);
  }

  /** GitHub caps search at 1000 results; we page until `limit` or exhaustion. */
  async searchRepos(query: string, limit: number): Promise<RepoInfo[]> {
    const capped = Math.min(Math.max(1, limit), 200);
    const perPage = Math.min(capped, 100);
    const results: RepoInfo[] = [];
    let page = 1;
    while (results.length < capped) {
      const { data } = await this.wrap(() =>
        this.octokit.rest.search.repos({
          q: query,
          order: "desc",
          per_page: perPage,
          page,
        }),
      );
      const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
      if (items.length === 0) break;
      for (const item of items) {
        results.push(toRepoInfo(item));
        if (results.length >= capped) break;
      }
      if (items.length < perPage) break;
      page += 1;
    }
    return results;
  }

  async createRepo(name: string, options: CreateRepoOptions): Promise<RepoInfo> {
    try {
      if (options.org !== undefined) {
        const { data } = await this.octokit.rest.repos.createInOrg({
          org: options.org,
          name,
          private: options.private,
          description: options.description,
        });
        return toRepoInfo(data);
      }
      const { data } = await this.octokit.rest.repos.createForAuthenticatedUser({
        name,
        private: options.private,
        description: options.description,
      });
      return toRepoInfo(data);
    } catch (error) {
      if (isHttpStatus(error, 409)) {
        throw new Error("name already exists on GitHub");
      }
      throw error;
    }
  }
}
