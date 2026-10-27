import type { CustomPreset, PresetRef } from "../presets/index.ts";
import { isInternalOwner } from "../presets/index.ts";
import { type CloneProgress, cloneOrUpdate, type EmitProgress } from "./cloner.ts";
import type { GitHubRepoReader, RepoInfo } from "./github.ts";
import {
  loadWorkspace,
  targetDirFor,
  toPosixRelative,
  updateWorkspace,
  upsertInventory,
} from "./workspace.ts";

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const GITHUB_HOST = "github.com";
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const SCP_PATTERN = /^([^@/\s]+)@([^:/\s]+):(\S+)$/;

export interface ParsedGitUrl {
  owner: string;
  name: string;
}

function stripGitSuffix(name: string): string {
  return name.endsWith(".git") ? name.slice(0, -".git".length) : name;
}

function fromOwnerRepo(owner: string, name: string): ParsedGitUrl | null {
  if (!OWNER_PATTERN.test(owner)) return null;
  if (!REPO_PATTERN.test(name)) return null;
  return { owner, name };
}

function hostAllowed(hostname: string, hosts: readonly string[]): boolean {
  const lower = hostname.toLowerCase();
  return hosts.some((host) => host.toLowerCase() === lower);
}

/** Extracts the hostname-ish first segment of a git URL or `owner/name` ref. */
function hostnameOf(url: string): string | null {
  const raw = url.trim();
  if (SCHEME_PATTERN.test(raw)) {
    try {
      return new URL(raw).hostname;
    } catch {
      return null;
    }
  }
  const scpMatch = SCP_PATTERN.exec(raw);
  if (scpMatch !== null) return scpMatch[2]!;
  const firstSegment = raw.split("/")[0] ?? "";
  return firstSegment.includes(".") ? firstSegment : null;
}

/**
 * True when the URL's host is one of the configured GitHub Enterprise hosts
 * (matched by parsed hostname, never by substring).
 */
export function isGheUrl(url: string, hosts: readonly string[]): boolean {
  const gheHosts = hosts.filter((host) => host.toLowerCase() !== GITHUB_HOST);
  if (gheHosts.length === 0) return false;
  const hostname = hostnameOf(url);
  if (hostname === null) return false;
  return hostAllowed(hostname, gheHosts);
}

/**
 * Parses a GitHub repository reference. `hosts` extends the accepted hosts
 * (GitHub Enterprise); `owner/name` short form stays host-agnostic and is
 * always treated as github.com by the caller.
 */
export function parseGitUrl(
  input: string,
  hosts: readonly string[] = [GITHUB_HOST],
): ParsedGitUrl | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  if (SCHEME_PATTERN.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (!hostAllowed(parsed.hostname, hosts)) return null;
    const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
    if (segments.length !== 2) return null;
    return fromOwnerRepo(segments[0]!, stripGitSuffix(segments[1]!));
  }

  const scpMatch = SCP_PATTERN.exec(raw);
  if (scpMatch !== null) {
    if (!hostAllowed(scpMatch[2]!, hosts)) return null;
    const segments = scpMatch[3]!.split("/");
    if (segments.length !== 2) return null;
    const [owner, repo] = segments;
    if (owner === undefined || owner.length === 0) return null;
    if (repo === undefined || repo.length === 0) return null;
    return fromOwnerRepo(owner, stripGitSuffix(repo));
  }

  const segments = raw.split("/");
  if (segments.length === 2) {
    const [owner, repo] = segments;
    if (owner === undefined || owner.length === 0) return null;
    if (repo === undefined || repo.length === 0) return null;
    return fromOwnerRepo(owner, stripGitSuffix(repo));
  }
  if (
    segments.length === 3 &&
    (hostAllowed(segments[0]!, hosts) || segments[0]!.toLowerCase() === GITHUB_HOST)
  ) {
    const owner = segments[1];
    const repo = segments[2];
    if (owner === undefined || owner.length === 0) return null;
    if (repo === undefined || repo.length === 0) return null;
    return fromOwnerRepo(owner, stripGitSuffix(repo));
  }
  return null;
}

export interface SingleCloneOptions {
  root: string;
  github: GitHubRepoReader;
  userLogin: string;
  orgs: readonly string[];
  token?: string | null;
  presetOverride?: PresetRef;
  preferSsh?: boolean;
  depth?: number;
  blobless?: boolean;
  sparse?: string[];
  emit?: EmitProgress;
  hosts?: readonly string[];
  customPresets?: readonly CustomPreset[];
}

export interface SingleCloneResult {
  repo: RepoInfo;
  destDir: string;
  internal: boolean;
  preset: PresetRef;
  progress: CloneProgress;
}

export async function cloneSingleRepository(
  url: string,
  options: SingleCloneOptions,
): Promise<SingleCloneResult> {
  const hosts = options.hosts ?? [GITHUB_HOST];
  const parsed = parseGitUrl(url, hosts);
  if (parsed === null) {
    throw new Error(`invalid GitHub repository URL: ${url}`);
  }
  const repo = await options.github.getRepo(parsed.owner, parsed.name);
  const internal = isInternalOwner(repo.owner, options.userLogin, options.orgs);
  const config = await loadWorkspace(options.root, options.presetOverride);
  const destDir = targetDirFor(
    options.root,
    repo,
    config.preset,
    internal,
    options.customPresets ?? [],
  );

  const isGhe = isGheUrl(url, hosts);
  const preferSsh = isGhe ? false : options.preferSsh;

  const progress = await cloneOrUpdate(
    {
      owner: repo.owner,
      name: repo.name,
      httpsUrl: repo.httpsUrl,
      sshUrl: repo.sshUrl,
      destDir,
    },
    {
      token: options.token ?? null,
      preferSsh,
      depth: options.depth,
      blobless: options.blobless,
      sparse: options.sparse,
    },
    options.emit,
  );
  if (progress.phase !== "done") {
    throw new Error(progress.message ?? `failed to clone ${repo.owner}/${repo.name}`);
  }
  const relativePath = toPosixRelative(options.root, destDir);
  await updateWorkspace(options.root, (current) => {
    const next = upsertInventory(
      current,
      { ...repo, sparse: options.sparse },
      relativePath,
      internal,
    );
    return { config: { ...next, lastSync: new Date().toISOString() }, result: undefined };
  });
  return { repo, destDir, internal, preset: config.preset, progress };
}
