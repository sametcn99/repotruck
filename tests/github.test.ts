import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import {
  type EtagCacheStore,
  fileEtagCache,
  GitHubService,
  orgLoginsFromMemberships,
  toRepoInfo,
} from "../src/services/github.ts";

describe("orgLoginsFromMemberships", () => {
  test("reads organization.login from the real memberships payload shape", () => {
    const payload = [
      {
        url: "https://api.github.com/user/memberships/orgs/Mekanet-Energy",
        state: "active",
        role: "admin",
        organization_url: "https://api.github.com/orgs/Mekanet-Energy",
        organization: {
          login: "Mekanet-Energy",
          id: 1,
          description: null,
        },
        user: { login: "monalisa", id: 2 },
      },
      {
        url: "https://api.github.com/user/memberships/orgs/Hiretea",
        state: "active",
        role: "member",
        organization_url: "https://api.github.com/orgs/Hiretea",
        organization: {
          login: "Hiretea",
          id: 3,
          description: null,
        },
        user: { login: "monalisa", id: 2 },
      },
    ];
    expect(orgLoginsFromMemberships(payload)).toEqual(["Mekanet-Energy", "Hiretea"]);
  });

  test("ignores the legacy/wrong org.login shape instead of trusting it", () => {
    const payload = [
      { org: { login: "Wrong" }, organization: { login: "Right" } },
      { org: { login: "AlsoWrong" } },
    ];
    expect(orgLoginsFromMemberships(payload)).toEqual(["Right"]);
  });

  test("skips malformed entries and dedupes", () => {
    const payload = [
      null,
      "garbage",
      { organization: null },
      { organization: { login: "" } },
      { organization: { login: "acme" } },
      { organization: { login: "acme" } },
    ];
    expect(orgLoginsFromMemberships(payload)).toEqual(["acme"]);
  });

  test("non-array payload yields an empty list", () => {
    expect(orgLoginsFromMemberships(null)).toEqual([]);
    expect(orgLoginsFromMemberships({})).toEqual([]);
  });
});

describe("toRepoInfo defensive mapping", () => {
  test("maps a realistic repository payload", () => {
    const info = toRepoInfo({
      name: "express",
      full_name: "expressjs/express",
      private: false,
      fork: false,
      archived: false,
      language: "JavaScript",
      updated_at: "2026-10-22T18:45:37Z",
      clone_url: "https://github.com/expressjs/express.git",
      ssh_url: "git@github.com:expressjs/express.git",
      owner: { login: "expressjs" },
      stargazers_count: 66000,
    });
    expect(info).toEqual({
      owner: "expressjs",
      name: "express",
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      language: "JavaScript",
      httpsUrl: "https://github.com/expressjs/express.git",
      sshUrl: "git@github.com:expressjs/express.git",
      updatedAt: "2026-10-22T18:45:37Z",
      stars: 66000,
    });
  });

  test("maps a payload without stargazers_count to stars null", () => {
    const info = toRepoInfo({ name: "api", owner: { login: "acme" } });
    expect(info.stars).toBeNull();
  });

  test("derives clone URLs when the payload omits them", () => {
    const info = toRepoInfo({ name: "api", owner: { login: "acme" } });
    expect(info.httpsUrl).toBe("https://github.com/acme/api.git");
    expect(info.sshUrl).toBe("git@github.com:acme/api.git");
  });

  test("strips credentials from httpsUrl", () => {
    const info = toRepoInfo({
      name: "api",
      owner: { login: "acme" },
      clone_url: "https://x-access-token:secret@github.com/acme/api.git",
    });
    expect(info.httpsUrl).toBe("https://github.com/acme/api.git");
    expect(info.httpsUrl.includes("secret")).toBe(false);
  });
});

function memoryEtagCache(): EtagCacheStore & {
  map: Map<string, { etag: string; body: unknown; savedAt: number }>;
} {
  const map = new Map<string, { etag: string; body: unknown; savedAt: number }>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, entry) {
      map.set(key, entry);
    },
  };
}

describe("GitHubService etag conditional requests", () => {
  const repoBody = {
    name: "api",
    owner: { login: "acme" },
    clone_url: "https://github.com/acme/api.git",
    ssh_url: "git@github.com:acme/api.git",
    language: "TypeScript",
    updated_at: "2026-01-01T00:00:00Z",
  };

  test("second getRepo sends If-None-Match and honors the 304 cached body", async () => {
    const cache = memoryEtagCache();
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    let calls = 0;
    const octokit = {
      request: async (_url: string, params?: { headers?: Record<string, string> }) => {
        calls += 1;
        seenHeaders.push(params?.headers);
        if (calls === 1) {
          return { status: 200, data: repoBody, headers: { etag: 'W/"abc"' } };
        }
        return { status: 304, data: "", headers: { etag: 'W/"abc"' } };
      },
    } as unknown as Octokit;
    const service = new GitHubService("token", { octokit, etagCache: cache });
    const first = await service.getRepo("acme", "api");
    expect(first.name).toBe("api");
    const second = await service.getRepo("acme", "api");
    expect(second.name).toBe("api");
    expect(calls).toBe(2);
    expect(seenHeaders[1]?.["If-None-Match"]).toBe('W/"abc"');
  });

  test("responses without an etag are not cached", async () => {
    const cache = memoryEtagCache();
    let calls = 0;
    const octokit = {
      request: async () => {
        calls += 1;
        return { status: 200, data: repoBody, headers: {} };
      },
    } as unknown as Octokit;
    const service = new GitHubService("token", { octokit, etagCache: cache });
    await service.getRepo("acme", "api");
    await service.getRepo("acme", "api");
    expect(calls).toBe(2);
    expect(cache.map.size).toBe(0);
  });

  test("fileEtagCache round-trips entries and drops stale ones", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rt-etag-"));
    try {
      let now = 1_000_000;
      const cache = fileEtagCache(path.join(dir, "cache.json"), { now: () => now });
      await cache.set("repos/acme/api", { etag: 'W/"x"', body: repoBody, savedAt: now });
      expect(await cache.get("repos/acme/api")).not.toBeNull();
      now += 8 * 24 * 60 * 60 * 1000; // past the 7-day TTL
      expect(await cache.get("repos/acme/api")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fileEtagCache survives process exit via the sync flush", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rt-etag2-"));
    try {
      const file = path.join(dir, "cache.json");
      const cache = fileEtagCache(file);
      await cache.set("repos/acme/api", { etag: 'W/"y"', body: repoBody, savedAt: Date.now() });
      process.emit("exit", 0);
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      expect(raw["repos/acme/api"]).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
