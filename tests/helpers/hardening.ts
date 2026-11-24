import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StoreDeps } from "../../src/components/store.ts";
import { defaultConfig, type RepotruckConfig } from "../../src/services/config.ts";
import type { RepoInfo } from "../../src/services/github.ts";
import { writeWorkspaceConfig } from "../../src/services/workspaceRegistry.ts";

export function workspaceFixture() {
  const base = mkdtempSync(path.join(tmpdir(), "rt-hardening-"));
  const root = path.join(base, "workspace with spaces");
  const configDir = path.join(base, "config");
  mkdirSync(root, { recursive: true });
  mkdirSync(configDir);
  const env = { REPOTRUCK_CONFIG_DIR: configDir };
  const config: RepotruckConfig = { ...defaultConfig(root), repos: [inventoryEntry()] };
  const repoDir = path.join(root, config.repos[0]!.relativePath);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, "sentinel.txt"), "user data\n");
  return {
    base,
    root,
    configDir,
    env,
    config,
    repoDir,
    save: () => writeWorkspaceConfig(root, config, env),
    cleanup: () => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }),
  };
}

export function inventoryEntry(relativePath = "acme/source/api") {
  return {
    owner: "acme",
    name: "api",
    relativePath,
    category: "source" as const,
    internal: true,
    language: null,
    updatedAt: null,
  };
}

export const remoteRepo: RepoInfo = {
  owner: "acme",
  name: "api",
  description: null,
  isPrivate: false,
  isFork: false,
  isArchived: false,
  language: null,
  httpsUrl: "https://github.com/acme/api.git",
  sshUrl: "",
  updatedAt: null,
};

export function storeDeps(overrides: StoreDeps = {}): StoreDeps {
  return {
    auth: async () => ({ token: "fixture", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [remoteRepo],
      listOrgRepos: async () => [],
      getRepo: async () => remoteRepo,
      createRepo: async () => remoteRepo,
    }),
    updater: async () => ({ currentVersion: "1.0.4", latestVersion: null, updateAvailable: false }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [],
    listWorkspacesFn: async () => [],
    ...overrides,
  };
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for observed state");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
