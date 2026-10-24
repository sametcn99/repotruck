import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import { targetDirFor, toPosixRelative, upsertInventory } from "../src/services/workspace.ts";

const config: RepotruckConfig = {
  version: 1,
  root: path.resolve("/ws"),
  preset: "categorized",
  lastSync: null,
  repos: [],
};

const repo = {
  owner: "acme",
  name: "api",
  isArchived: false,
  isFork: false,
  language: "Go",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("targetDirFor", () => {
  test("joins root with the preset target segments for internal repos", () => {
    expect(targetDirFor(path.resolve("/ws"), repo, "categorized", true)).toBe(
      path.join(path.resolve("/ws"), "acme", "source", "api"),
    );
  });

  test("prefixes community for external repos", () => {
    expect(targetDirFor(path.resolve("/ws"), repo, "flat-by-owner", false)).toBe(
      path.join(path.resolve("/ws"), "community", "acme", "api"),
    );
  });
});

describe("toPosixRelative", () => {
  test("returns a posix relative path from root to a directory", () => {
    const root = path.resolve("/ws");
    const abs = path.join(root, "community", "acme", "api");
    expect(toPosixRelative(root, abs)).toBe("community/acme/api");
  });

  test("uses forward slashes even on Windows", () => {
    const root = path.resolve("/ws");
    const abs = path.join(root, "acme", "source", "web");
    const relative = toPosixRelative(root, abs);
    expect(relative.includes("\\")).toBe(false);
    expect(relative).toBe("acme/source/web");
  });
});

describe("upsertInventory", () => {
  test("adds a new entry to an empty inventory", () => {
    const next = upsertInventory(config, repo, "acme/source/api", true);
    expect(next.repos.length).toBe(1);
    expect(next.repos[0]).toEqual({
      owner: "acme",
      name: "api",
      relativePath: "acme/source/api",
      category: "source",
      internal: true,
      language: "Go",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  test("does not mutate the input config", () => {
    const next = upsertInventory(config, repo, "acme/source/api", true);
    expect(config.repos.length).toBe(0);
    expect(next).not.toBe(config);
  });

  test("updates an existing entry in place, deduped by owner and name", () => {
    const added = upsertInventory(config, repo, "acme/source/api", true);
    const moved = { ...repo, language: "Rust" };
    const next = upsertInventory(added, moved, "acme/source/api-v2", true);
    expect(next.repos.length).toBe(1);
    expect(next.repos[0]!.relativePath).toBe("acme/source/api-v2");
    expect(next.repos[0]!.language).toBe("Rust");
  });

  test("dedupe is case-insensitive on owner and name", () => {
    const added = upsertInventory(config, repo, "acme/source/api", true);
    const next = upsertInventory(added, { ...repo, owner: "ACME", name: "API" }, "acme/api", true);
    expect(next.repos.length).toBe(1);
    expect(next.repos[0]!.owner).toBe("ACME");
    expect(next.repos[0]!.name).toBe("API");
  });

  test("keeps distinct repos as separate entries", () => {
    const added = upsertInventory(config, repo, "acme/source/api", true);
    const next = upsertInventory(added, { ...repo, name: "web" }, "acme/source/web", true);
    expect(next.repos.length).toBe(2);
  });

  test("preserves the custom field on update", () => {
    const withCustom: RepotruckConfig = {
      ...config,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "Go",
          updatedAt: null,
          custom: true,
        },
      ],
    };
    const next = upsertInventory(withCustom, repo, "acme/source/api", true);
    expect(next.repos.length).toBe(1);
    expect(next.repos[0]!.custom).toBe(true);
  });
});
