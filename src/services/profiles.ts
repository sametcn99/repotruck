import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { resolveRepoRef } from "./launcher.ts";

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ProfileOpResult {
  ok: boolean;
  message: string;
  config: RepotruckConfig;
  pinned?: boolean;
}

function canonicalKey(entry: RepoInventoryEntry): string {
  return `${entry.owner}/${entry.name}`;
}

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_PATTERN.test(name);
}

export function pinRepo(config: RepotruckConfig, ref: string): ProfileOpResult {
  const match = resolveRepoRef(config, ref);
  if (match === null) {
    return { ok: false, message: `repository not found: ${ref}`, config };
  }
  const key = canonicalKey(match.entry);
  const existing = config.pinned ?? [];
  if (existing.some((item) => item.toLowerCase() === key.toLowerCase())) {
    return { ok: true, message: `already pinned: ${key}`, config, pinned: true };
  }
  return {
    ok: true,
    message: `pinned ${key}`,
    config: { ...config, pinned: [...existing, key] },
    pinned: true,
  };
}

export function unpinRepo(config: RepotruckConfig, ref: string): ProfileOpResult {
  const match = resolveRepoRef(config, ref);
  const targetKey = match !== null ? canonicalKey(match.entry) : ref;
  const existing = config.pinned ?? [];
  const next = existing.filter((item) => item.toLowerCase() !== targetKey.toLowerCase());
  if (next.length === existing.length) {
    return { ok: false, message: `repository is not pinned: ${ref}`, config, pinned: false };
  }
  return {
    ok: true,
    message: `unpinned ${targetKey}`,
    config: {
      ...config,
      ...(next.length > 0 ? { pinned: next } : { pinned: undefined }),
    },
    pinned: false,
  };
}

export function togglePinRepo(config: RepotruckConfig, ref: string): ProfileOpResult {
  const match = resolveRepoRef(config, ref);
  const targetKey = match !== null ? canonicalKey(match.entry) : ref;
  const existing = config.pinned ?? [];
  if (existing.some((item) => item.toLowerCase() === targetKey.toLowerCase())) {
    return unpinRepo(config, ref);
  }
  // Allow pinning untracked owner/name in dashboard when valid owner/name
  if (match === null) {
    const parts = ref.split("/");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        ok: true,
        message: `pinned ${ref}`,
        config: { ...config, pinned: [...existing, ref] },
        pinned: true,
      };
    }
    return { ok: false, message: `repository not found: ${ref}`, config };
  }
  return pinRepo(config, ref);
}

export function listPinned(config: RepotruckConfig): string[] {
  return [...(config.pinned ?? [])].sort((a, b) => a.localeCompare(b));
}

export function saveProfile(
  config: RepotruckConfig,
  name: string,
  refs: readonly string[],
): ProfileOpResult {
  if (!isValidProfileName(name)) {
    return {
      ok: false,
      message: `invalid profile name: ${name} (use letters, digits, dots, dashes, underscores; must start with a letter or digit)`,
      config,
    };
  }
  if (refs.length === 0) {
    return {
      ok: false,
      message: `profile "${name}" requires at least one repository`,
      config,
    };
  }
  const resolvedKeys: string[] = [];
  for (const ref of refs) {
    const match = resolveRepoRef(config, ref);
    if (match === null) {
      return { ok: false, message: `repository not found: ${ref}`, config };
    }
    const key = canonicalKey(match.entry);
    if (!resolvedKeys.some((k) => k.toLowerCase() === key.toLowerCase())) {
      resolvedKeys.push(key);
    }
  }
  const nextProfiles: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(config.profiles ?? {})) {
    if (k.toLowerCase() !== name.toLowerCase()) {
      nextProfiles[k] = v;
    }
  }
  nextProfiles[name] = resolvedKeys;
  return {
    ok: true,
    message: `profile ${name} saved (${resolvedKeys.length} repositories)`,
    config: { ...config, profiles: nextProfiles },
  };
}

export function deleteProfile(config: RepotruckConfig, name: string): ProfileOpResult {
  const existing = config.profiles ?? {};
  const found = Object.keys(existing).find((k) => k.toLowerCase() === name.toLowerCase());
  if (found === undefined) {
    return { ok: false, message: `profile not found: ${name}`, config };
  }
  const nextProfiles: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (k !== found) nextProfiles[k] = v;
  }
  const hasAny = Object.keys(nextProfiles).length > 0;
  return {
    ok: true,
    message: `profile ${found} deleted`,
    config: {
      ...config,
      ...(hasAny ? { profiles: nextProfiles } : { profiles: undefined }),
    },
  };
}

export interface ProfileListing {
  name: string;
  repos: string[];
}

export function listProfiles(config: RepotruckConfig): ProfileListing[] {
  return Object.entries(config.profiles ?? {})
    .map(([name, repos]) => ({ name, repos: [...repos] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveProfileKeys(config: RepotruckConfig, name: string): string[] | null {
  const existing = config.profiles ?? {};
  const found = Object.keys(existing).find((k) => k.toLowerCase() === name.toLowerCase());
  if (found === undefined) return null;
  return [...(existing[found] ?? [])];
}
