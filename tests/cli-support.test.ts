import { describe, expect, test } from "bun:test";
import {
  collectScopeRepos,
  describeSyncScope,
  detectTuiRuntimeError,
  formatWorkspaceLine,
  isAtLeast,
  parseSyncScope,
  tuiRuntimeError,
} from "../src/cliSupport.ts";
import type { GitHubService, RepoInfo } from "../src/services/github.ts";
import type { WorkspaceListing } from "../src/services/workspaceRegistry.ts";

describe("cliSupport - version and runtime checking", () => {
  test("isAtLeast compares semver-like arrays", () => {
    expect(isAtLeast("1.3.14", [1, 3, 14])).toBe(true);
    expect(isAtLeast("1.3.15", [1, 3, 14])).toBe(true);
    expect(isAtLeast("1.4.0", [1, 3, 14])).toBe(true);
    expect(isAtLeast("2.0.0", [1, 3, 14])).toBe(true);
    expect(isAtLeast("1.3.13", [1, 3, 14])).toBe(false);
    expect(isAtLeast("1.2.99", [1, 3, 14])).toBe(false);
    expect(isAtLeast("0.9.0", [1, 3, 14])).toBe(false);
    expect(isAtLeast("invalid", [1, 3, 14])).toBe(false);
    expect(isAtLeast("26.4", [26, 4, 0])).toBe(true);
  });

  test("tuiRuntimeError verifies Bun and Node versions", () => {
    // Valid Bun
    expect(tuiRuntimeError("1.3.14", null)).toBeNull();
    expect(tuiRuntimeError("1.4.2", "20.0.0")).toBeNull();

    // Outdated Bun
    const outdatedBun = tuiRuntimeError("1.3.10", null);
    expect(outdatedBun).toContain("requires Bun 1.3.14 or newer");

    // No Bun, valid Node
    expect(tuiRuntimeError(null, "26.4.0")).toBeNull();
    expect(tuiRuntimeError("", "27.0.0")).toBeNull();

    // No Bun, outdated Node
    const outdatedNode = tuiRuntimeError(null, "20.10.0");
    expect(outdatedNode).toContain("requires Node.js 26.4 or newer");

    // No Bun, unknown Node
    const unknownNode = tuiRuntimeError(null, null);
    expect(unknownNode).toContain("requires Node.js 26.4 or newer (found Node.js unknown)");
  });

  test("detectTuiRuntimeError runs in current environment without error", () => {
    // Current environment is Bun >= 1.3.14, should return null
    const err = detectTuiRuntimeError();
    expect(err).toBeNull();
  });
});

describe("cliSupport - SyncScope parsing and formatting", () => {
  test("parseSyncScope handles user, all, org and invalid inputs", () => {
    expect(parseSyncScope("user")).toEqual({ kind: "user" });
    expect(parseSyncScope("all")).toEqual({ kind: "all" });
    expect(parseSyncScope("org:my-team")).toEqual({ kind: "org", org: "my-team" });

    expect(parseSyncScope("org:")).toBeNull();
    expect(parseSyncScope("unknown")).toBeNull();
    expect(parseSyncScope("")).toBeNull();
  });

  test("describeSyncScope formats all scope variants", () => {
    expect(describeSyncScope({ kind: "user" })).toBe("user");
    expect(describeSyncScope({ kind: "all" })).toBe("all");
    expect(describeSyncScope({ kind: "org", org: "acme" })).toBe("org:acme");
  });

  test("formatWorkspaceLine formats listing with and without missing flag", () => {
    const presentListing: WorkspaceListing = {
      path: "/home/user/workspace",
      preset: "nested",
      repoCount: 5,
      lastSync: "2026-10-25T01:00:00Z",
      lastUsed: "2026-10-25T02:00:00Z",
      missing: false,
    };
    const line1 = formatWorkspaceLine(presentListing);
    expect(line1).toContain("/home/user/workspace");
    expect(line1).toContain("preset nested");
    expect(line1).toContain("5 repositories");
    expect(line1).toContain("last sync: 2026-10-25T01:00:00Z");
    expect(line1).not.toContain("(missing)");

    const missingListing: WorkspaceListing = {
      path: "/deleted/workspace",
      preset: "flat",
      repoCount: 0,
      lastSync: null,
      lastUsed: "2026-10-24T00:00:00Z",
      missing: true,
    };
    const line2 = formatWorkspaceLine(missingListing);
    expect(line2).toContain("/deleted/workspace");
    expect(line2).toContain("last sync: never");
    expect(line2).toContain("(missing)");
  });
});

describe("cliSupport - collectScopeRepos", () => {
  function makeMockRepo(owner: string, name: string): RepoInfo {
    return {
      owner,
      name,
      isPrivate: false,
      isArchived: false,
      isFork: false,
      description: null,
      language: null,
      updatedAt: null,
      stars: 0,
      httpsUrl: `https://github.com/${owner}/${name}`,
      sshUrl: `git@github.com:${owner}/${name}.git`,
    };
  }

  test("collectScopeRepos handles user scope", async () => {
    const mockGithub: Partial<GitHubService> = {
      listUserRepos: async () => [makeMockRepo("alice", "repo1")],
    };
    const repos = await collectScopeRepos(mockGithub as GitHubService, { kind: "user" });
    expect(repos).toHaveLength(1);
    expect(repos[0]?.name).toBe("repo1");
  });

  test("collectScopeRepos handles org scope", async () => {
    const mockGithub: Partial<GitHubService> = {
      listOrgRepos: async (org: string) => [makeMockRepo(org, "org-repo")],
    };
    const repos = await collectScopeRepos(mockGithub as GitHubService, {
      kind: "org",
      org: "team-a",
    });
    expect(repos).toHaveLength(1);
    expect(repos[0]?.owner).toBe("team-a");
  });

  test("collectScopeRepos handles all scope and dedupes repositories", async () => {
    const mockGithub: Partial<GitHubService> = {
      listUserRepos: async () => [
        makeMockRepo("alice", "shared-repo"),
        makeMockRepo("alice", "user-repo"),
      ],
      getActiveOrgs: async () => ["org-1", "org-2"],
      listOrgRepos: async (org: string) => {
        if (org === "org-1") {
          return [
            makeMockRepo("alice", "shared-repo"), // Duplicate (case-insensitive dedupe)
            makeMockRepo("org-1", "service-1"),
          ];
        }
        return [makeMockRepo("org-2", "service-2")];
      },
    };

    const repos = await collectScopeRepos(mockGithub as GitHubService, { kind: "all" });
    expect(repos).toHaveLength(4);
    const keys = repos.map((r) => `${r.owner}/${r.name}`);
    expect(keys).toEqual([
      "alice/shared-repo",
      "alice/user-repo",
      "org-1/service-1",
      "org-2/service-2",
    ]);
  });
});
