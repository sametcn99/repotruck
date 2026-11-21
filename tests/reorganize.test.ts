import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import { moveDir } from "../src/services/mover.ts";
import {
  deleteReorganizeJournal,
  readReorganizeJournal,
  reorganizeJournalPath,
  reorganizeWorkspace,
  writeReorganizeJournalAtomically,
} from "../src/services/reorganizer.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
let savedConfigDir: string | undefined;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  process.env.REPOTRUCK_CONFIG_DIR = tempDir("repotruck-reorg-cfg-");
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function snapshotDirectory(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (current: string) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        result[rel] = readFileSync(full, "utf8");
      }
    }
  };
  walk(dir);
  return result;
}

function makeEntry(
  owner: string,
  name: string,
  relativePath: string,
  internal = true,
  custom = false,
) {
  return {
    owner,
    name,
    category: "source" as const,
    relativePath,
    internal,
    language: null,
    updatedAt: null,
    ...(custom ? { custom: true } : {}),
  };
}

async function createReorgFixture(): Promise<{ root: string; config: RepotruckConfig }> {
  const root = tempDir("repotruck-reorg-suite-");
  const config: RepotruckConfig = {
    version: 1,
    root,
    preset: "flat-by-owner",
    lastSync: null,
    repos: [
      makeEntry("acme", "api", "acme/api", true, false),
      makeEntry("acme", "web", "acme/web", true, false),
      makeEntry("octo", "lib", "community/octo/lib", false, false),
    ],
  };

  for (const r of config.repos) {
    const dir = path.join(root, ...r.relativePath.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "README.md"), `# ${r.name}`, "utf8");
  }

  await writeWorkspaceConfig(root, config);
  return { root, config };
}

describe("reorganizeWorkspace core and edge cases", () => {
  test("moves a checkout out of the future source-owner folder before moving siblings into it", async () => {
    const root = tempDir("rt-reorg-fork-overlap-");
    const repos = ["react", "meta"].map((name) => ({
      ...makeEntry("acme", name, `acme/forks/${name}`),
      category: "forks" as const,
      forkSourceOwner: "meta",
    }));
    for (const repo of repos) {
      const dir = path.join(root, repo.relativePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "local.txt"), repo.name);
    }
    await writeWorkspaceConfig(root, {
      root,
      version: 1,
      preset: "categorized",
      lastSync: null,
      repos,
    });

    const result = await reorganizeWorkspace(root, "categorized");
    expect(result.collisions).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.moved.map((move) => move.key)).toEqual(["acme/meta", "acme/react"]);
    for (const repo of repos) {
      expect(readFileSync(path.join(root, "acme/forks/meta", repo.name, "local.txt"), "utf8")).toBe(
        repo.name,
      );
    }
  });

  test("learns the source owner of an existing fork and moves the local checkout", async () => {
    const root = tempDir("repotruck-reorg-fork-");
    const original = "sametcn99/forks/react";
    const expected = "sametcn99/forks/meta/react";
    const dir = path.join(root, original);
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", dir], { stdio: "ignore" });
    writeFileSync(path.join(dir, "local.txt"), "local work");
    await writeWorkspaceConfig(root, {
      root,
      version: 1,
      preset: "categorized",
      lastSync: null,
      repos: [{ ...makeEntry("sametcn99", "react", original), category: "forks" }],
      aliases: { react: original },
    });
    const unavailable = await reorganizeWorkspace(root, "categorized", { dryRun: true });
    expect(unavailable.skipped).toEqual([
      { key: "sametcn99/react", reason: "fork source owner unavailable" },
    ]);

    const getRepo = async (owner: string, name: string) => ({
      owner,
      name,
      isFork: true,
      isArchived: false,
      isPrivate: false,
      forkSourceOwner: "meta",
      description: null,
      language: null,
      updatedAt: null,
      httpsUrl: "",
      sshUrl: "",
    });
    const preview = await reorganizeWorkspace(root, "categorized", { dryRun: true, getRepo });
    expect(preview.moved).toEqual([{ key: "sametcn99/react", from: original, to: expected }]);
    expect((await readWorkspaceConfig(root))?.repos[0]?.forkSourceOwner).toBeUndefined();
    const applied = await reorganizeWorkspace(root, "categorized", { getRepo });
    expect(applied.moved).toEqual(preview.moved);
    expect(existsSync(path.join(root, expected, ".git"))).toBe(true);
    expect(readFileSync(path.join(root, expected, "local.txt"), "utf8")).toBe("local work");
    const config = await readWorkspaceConfig(root);
    expect(config?.repos[0]).toMatchObject({ relativePath: expected, forkSourceOwner: "meta" });
    expect(config?.aliases?.react).toBe(expected);
    expect((await reorganizeWorkspace(root, "categorized", { dryRun: true })).moved).toEqual([]);
  });

  test("scan recognizes local forks and groups them by the upstream organization or user", async () => {
    const root = tempDir("rt-reorg-fork-scan-");
    const checkouts = [
      ["react", "sametcn99/forks/react", "sametcn99/forks/meta/react"],
      ["widget", "manual/widget", "sametcn99/forks/maintainer/widget"],
      ["tool", "sametcn99/forks/other-org/tool", "sametcn99/forks/other-org/tool"],
      ["unknown", "sametcn99/forks/unknown", "sametcn99/forks/unknown"],
    ] as const;
    for (const [name, relativePath] of checkouts) {
      const dir = path.join(root, relativePath);
      mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", dir], { stdio: "ignore" });
      execFileSync("git", [
        "-C",
        dir,
        "remote",
        "add",
        "origin",
        `https://github.com/sametcn99/${name}.git`,
      ]);
      writeFileSync(path.join(dir, "local.txt"), name);
    }
    const getRepo = async (owner: string, name: string) => {
      if (name === "unknown" || name === "tool") throw new Error("not available");
      return {
        owner,
        name,
        isFork: true,
        isArchived: false,
        isPrivate: false,
        forkSourceOwner: name === "react" ? "meta" : "maintainer",
        description: null,
        language: null,
        updatedAt: null,
        httpsUrl: "",
        sshUrl: "",
      };
    };
    const opts = { scan: true, getRepo };
    const preview = await reorganizeWorkspace(root, "categorized", { ...opts, dryRun: true });
    expect(preview.moved).toEqual(
      expect.arrayContaining(
        checkouts.slice(0, 2).map(([name, from, to]) => ({ key: `sametcn99/${name}`, from, to })),
      ),
    );
    expect(preview.moved).toHaveLength(2);
    expect(existsSync(path.join(root, "sametcn99/forks/react/.git"))).toBe(true);

    const result = await reorganizeWorkspace(root, "categorized", opts);
    expect(result.moved).toEqual(preview.moved);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toContainEqual({
      key: "sametcn99/unknown",
      reason: "fork source owner unavailable",
    });
    const config = await readWorkspaceConfig(root);
    for (const [name, , relativePath] of checkouts) {
      expect(existsSync(path.join(root, relativePath, ".git"))).toBe(true);
      expect(readFileSync(path.join(root, relativePath, "local.txt"), "utf8")).toBe(name);
      expect(config?.repos.find((entry) => entry.name === name)).toMatchObject({
        category: "forks",
        relativePath,
      });
    }
    expect(config?.repos.find((entry) => entry.name === "tool")?.forkSourceOwner).toBe("other-org");
    expect(config?.repos.find((entry) => entry.name === "react")?.forkSourceOwner).toBe("meta");
  });

  test("resume registers a discovered fork whose checkout was already moved", async () => {
    const root = tempDir("rt-reorg-resume-fork-");
    const to = "sametcn99/forks/meta/react";
    mkdirSync(path.join(root, to), { recursive: true });
    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "categorized",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "sametcn99/react",
          status: "done",
          from: "sametcn99/forks/react",
          to,
          forkSourceOwner: "meta",
          adopted: {
            ...makeEntry("sametcn99", "react", to),
            category: "forks",
            forkSourceOwner: "meta",
          },
        },
      ],
    });
    const result = await reorganizeWorkspace(root, undefined, { resume: true });
    expect(result.moved).toHaveLength(1);
    expect((await readWorkspaceConfig(root))?.repos).toMatchObject([
      { relativePath: to, category: "forks", forkSourceOwner: "meta" },
    ]);
  });

  test("C11: dry-run plans moves without touching disk or creating journal", async () => {
    const { root } = await createReorgFixture();
    const diskBefore = snapshotDirectory(root);

    const result = await reorganizeWorkspace(root, "categorized", { dryRun: true });

    expect(result.moved.length).toBeGreaterThan(0);
    expect(existsSync(reorganizeJournalPath(root))).toBe(false);

    // Verify disk remains completely identical before and after dry-run (M2)
    const diskAfter = snapshotDirectory(root);
    expect(diskAfter).toEqual(diskBefore);

    // Config preset remains untouched
    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.preset).toBe("flat-by-owner");
  });

  test("C12: journal lifecycle tracks pending, done, and cleans up at end", async () => {
    const { root } = await createReorgFixture();
    let observedPending = false;
    let observedDone = false;
    let moveCount = 0;

    const customMoveDir = (src: string, dest: string) => {
      const jBefore = readReorganizeJournal(root);
      if (jBefore?.moves.some((m) => m.status === "pending")) {
        observedPending = true;
      }
      if (moveCount > 0 && jBefore?.moves.some((m) => m.status === "done")) {
        observedDone = true;
      }
      moveCount++;
      moveDir(src, dest);
    };

    const result = await reorganizeWorkspace(root, "categorized", {
      moveDirImpl: customMoveDir,
    });

    expect(result.moved.length).toBe(3);
    expect(result.failed.length).toBe(0);

    expect(observedPending).toBe(true);
    expect(observedDone).toBe(true);

    // Verify journal was deleted after atomic workspace update
    expect(existsSync(reorganizeJournalPath(root))).toBe(false);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.preset).toBe("categorized");
    expect(cfg?.repos.find((r) => r.name === "api")?.relativePath).toBe("acme/source/api");
  });

  test("C13: collision detection when target already exists on disk", async () => {
    const { root } = await createReorgFixture();

    // Create foreign directory on disk at destination "acme/source/api"
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    writeFileSync(path.join(root, "acme", "source", "api", "foreign.txt"), "foreign", "utf8");

    const result = await reorganizeWorkspace(root, "categorized");

    const coll = result.collisions.find((c) => c.key === "acme/api");
    expect(coll).toBeDefined();
    expect(coll?.target).toBe("acme/source/api");
    expect(coll?.occupiedBy).toBe("(on disk)");

    // Source must NOT be moved over collision
    expect(existsSync(path.join(root, "acme", "api", "README.md"))).toBe(true);
    expect(readFileSync(path.join(root, "acme", "source", "api", "foreign.txt"), "utf8")).toBe(
      "foreign",
    );
  });

  test("collision detection when target occupied by another tracked repo", async () => {
    const root = tempDir("repotruck-coll-repo-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [
        makeEntry("acme", "api", "acme/api", true),
        // repo2 is already at acme/source/api
        makeEntry("acme", "other", "acme/source/api", true),
      ],
    };
    mkdirSync(path.join(root, "acme", "api"), { recursive: true });
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    await writeWorkspaceConfig(root, config);

    const result = await reorganizeWorkspace(root, "categorized");
    const coll = result.collisions.find((c) => c.key === "acme/api");
    expect(coll).toBeDefined();
    expect(coll?.occupiedBy).toBe("acme/other");
  });

  test("C14: partial failure records failed repo and keeps it at original path", async () => {
    const { root } = await createReorgFixture();

    // Custom moveDir that fails on acme/web
    const customMoveDir = (src: string, dest: string) => {
      if (src.includes("web")) {
        throw new Error("Simulated permission denied on web");
      }
      moveDir(src, dest);
    };

    const result = await reorganizeWorkspace(root, "categorized", {
      moveDirImpl: customMoveDir,
    });

    expect(result.failed.some((f) => f.key === "acme/web")).toBe(true);
    expect(result.moved.some((m) => m.key === "acme/api")).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.repos.find((r) => r.name === "web")?.relativePath).toBe("acme/web");
    expect(cfg?.repos.find((r) => r.name === "api")?.relativePath).toBe("acme/source/api");
  });

  test("C15: resume performs reconcile-only, updates completed, leaves pending at source", async () => {
    const { root } = await createReorgFixture();

    // Move acme/api to destination manually (simulating completed move)
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    writeFileSync(path.join(root, "acme", "source", "api", "README.md"), "done", "utf8");
    rmSync(path.join(root, "acme", "api"), { recursive: true, force: true });

    // Leave acme/web at source "acme/web" (simulating pending move)
    // Write interrupted journal
    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "categorized",
      timestamp: new Date().toISOString(),
      moves: [
        { key: "acme/api", from: "acme/api", to: "acme/source/api", status: "done" },
        { key: "acme/web", from: "acme/web", to: "acme/source/web", status: "pending" },
      ],
    });

    const result = await reorganizeWorkspace(root, undefined, { resume: true });

    expect(result.moved.some((m) => m.key === "acme/api")).toBe(true);
    expect(result.skipped.some((s) => s.key === "acme/web")).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    // Completed move updated in config
    expect(cfg?.repos.find((r) => r.name === "api")?.relativePath).toBe("acme/source/api");
    // Pending move remains at original source
    expect(cfg?.repos.find((r) => r.name === "web")?.relativePath).toBe("acme/web");
    // Preset NOT changed on resume
    expect(cfg?.preset).toBe("flat-by-owner");

    // Journal deleted
    expect(existsSync(reorganizeJournalPath(root))).toBe(false);
  });

  test("C16: hermetic --scan discovers untracked repo and adopts into inventory", async () => {
    const { root } = await createReorgFixture();

    // Create untracked local repository with git remote hermetically
    const scannedPath = path.join(root, "untracked", "scanned-repo");
    mkdirSync(scannedPath, { recursive: true });
    writeFileSync(path.join(scannedPath, "index.ts"), "export const x = 1;", "utf8");

    execFileSync("git", ["init", scannedPath], { stdio: "ignore" });
    execFileSync(
      "git",
      ["-C", scannedPath, "remote", "add", "origin", "https://github.com/acme/scanned-repo.git"],
      { stdio: "ignore" },
    );

    const result = await reorganizeWorkspace(root, "categorized", { scan: true });
    expect(result.moved.some((m) => m.key === "acme/scanned-repo")).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    const scannedEntry = cfg?.repos.find((r) => r.name === "scanned-repo");
    expect(scannedEntry).toBeDefined();
    expect(scannedEntry?.owner).toBe("acme");
    expect(scannedEntry?.relativePath).toBe("acme/source/scanned-repo");
  });

  test("C17: alias tracking updates aliases pointing to moved repositories", async () => {
    const { root, config } = await createReorgFixture();
    await writeWorkspaceConfig(root, {
      ...config,
      aliases: {
        apiService: "acme/api",
        webFrontend: "acme/web",
      },
    });

    const result = await reorganizeWorkspace(root, "categorized");
    expect(result.moved.length).toBe(3);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.aliases?.apiService).toBe("acme/source/api");
    expect(cfg?.aliases?.webFrontend).toBe("acme/source/web");
  });

  test("disk scanning moves an existing checkout from its actual path without cloning", async () => {
    const { root, config } = await createReorgFixture();
    await writeWorkspaceConfig(root, { ...config, aliases: { api: "acme/api" } });
    const actual = path.join(root, "manual", "api-copy");
    moveDir(path.join(root, "acme", "api"), actual);
    execFileSync("git", ["init", actual], { stdio: "ignore" });
    execFileSync("git", [
      "-C",
      actual,
      "remote",
      "add",
      "origin",
      "https://github.com/acme/api.git",
    ]);
    writeFileSync(path.join(actual, "local-only.txt"), "work in progress");

    const preview = await reorganizeWorkspace(root, "categorized", { scan: true, dryRun: true });
    expect(preview.moved).toContainEqual({
      key: "acme/api",
      from: "manual/api-copy",
      to: "acme/source/api",
    });
    expect(existsSync(actual)).toBe(true);
    await reorganizeWorkspace(root, "categorized", { scan: true });
    expect(existsSync(actual)).toBe(false);
    expect(existsSync(path.join(root, "acme/source/api/.git"))).toBe(true);
    expect(readFileSync(path.join(root, "acme/source/api/local-only.txt"), "utf8")).toBe(
      "work in progress",
    );
    expect((await readWorkspaceConfig(root))?.aliases).toEqual({ api: "acme/source/api" });
  });

  test("C18: --keep-custom preserves custom repos in place", async () => {
    const { root, config } = await createReorgFixture();
    // Mark acme/api as custom
    await writeWorkspaceConfig(root, {
      ...config,
      repos: config.repos.map((r) => (r.name === "api" ? { ...r, custom: true } : r)),
    });

    const result = await reorganizeWorkspace(root, "categorized", { keepCustom: true });
    expect(result.skipped.some((s) => s.key === "acme/api")).toBe(true);
    expect(result.moved.some((m) => m.key === "acme/web")).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.repos.find((r) => r.name === "api")?.relativePath).toBe("acme/api");
    expect(cfg?.repos.find((r) => r.name === "api")?.custom).toBe(true);
  });

  test("C19: case-only reorganization executes via two-phase move without false collisions", async () => {
    const root = tempDir("repotruck-reorg-case-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [makeEntry("acme", "api", "ACME/API", true)],
    };
    mkdirSync(path.join(root, "ACME", "API"), { recursive: true });
    writeFileSync(path.join(root, "ACME", "API", "README.md"), "test", "utf8");
    await writeWorkspaceConfig(root, config);

    // Reorganize to flat-by-owner, which targets "acme/api"
    const result = await reorganizeWorkspace(root, "flat-by-owner");

    expect(result.collisions).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.moved.some((m) => m.key === "acme/api")).toBe(true);
    expect(existsSync(path.join(root, "acme", "api", "README.md"))).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg!.repos[0]!.relativePath).toBe("acme/api");
  });

  test("C29: rejects normal reorganize when an unfinished journal already exists", async () => {
    const { root } = await createReorgFixture();
    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [],
    });

    expect(reorganizeWorkspace(root, "categorized")).rejects.toThrow(
      "unfinished reorganize in progress",
    );
  });

  test("C30: case-only interrupted move with tmpPath on disk is rolled back to source", async () => {
    const root = tempDir("repotruck-c30-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [makeEntry("acme", "api", "acme/api", true)],
    };
    // tmp directory on disk
    const tmpRel = "acme/api.tmp-crash123";
    mkdirSync(path.join(root, "acme", "api.tmp-crash123"), { recursive: true });
    writeFileSync(path.join(root, "acme", "api.tmp-crash123", "data.txt"), "c30 data", "utf8");
    await writeWorkspaceConfig(root, config);

    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/api",
          from: "acme/api",
          to: "acme/API",
          tmpPath: tmpRel,
          status: "pending",
        },
      ],
    });

    const result = await reorganizeWorkspace(root, undefined, { resume: true });
    expect(result.skipped.some((s) => s.key === "acme/api")).toBe(true);

    // tmpPath safely rolled back to from ("acme/api")
    expect(existsSync(path.join(root, "acme", "api", "data.txt"))).toBe(true);
    expect(existsSync(path.join(root, "acme", "api.tmp-crash123"))).toBe(false);

    // Config must have original path, NOT tmpPath and NOT destination
    const cfg = await readWorkspaceConfig(root);
    expect(cfg!.repos[0]!.relativePath).toBe("acme/api");
    expect(existsSync(reorganizeJournalPath(root))).toBe(false);
  });

  test("C31: corrupt journal throws clean actionable error", async () => {
    const { root } = await createReorgFixture();
    const jPath = reorganizeJournalPath(root);
    mkdirSync(path.dirname(jPath), { recursive: true });
    writeFileSync(jPath, "{ broken json", "utf8");

    expect(reorganizeWorkspace(root, undefined, { resume: true })).rejects.toThrow(
      "corrupt reorganize journal",
    );
  });

  test("F1: case-only interrupted move in window (a) (tmpPath in journal, rename not started, disk at from)", async () => {
    const root = tempDir("repotruck-f1-window-a-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [makeEntry("acme", "api", "acme/api", true)],
    };
    mkdirSync(path.join(root, "acme", "api"), { recursive: true });
    writeFileSync(path.join(root, "acme", "api", "data.txt"), "api content", "utf8");
    await writeWorkspaceConfig(root, config);

    // In window (a), tmpPath was written to journal, but phase 1 rename never executed.
    // Disk has "acme/api", no tmpPath exists on disk.
    const tmpRel = "acme/api.tmp-window-a-crash";
    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/api",
          from: "acme/api",
          to: "acme/API",
          tmpPath: tmpRel,
          status: "pending",
        },
      ],
    });

    const result = await reorganizeWorkspace(root, undefined, { resume: true });

    // Must be skipped (pending move left at source), NOT marked as moved!
    expect(result.skipped.some((s) => s.key === "acme/api")).toBe(true);
    expect(result.moved.length).toBe(0);

    // Config must remain at from ("acme/api"), NOT target ("acme/API")
    const cfg = await readWorkspaceConfig(root);
    expect(cfg!.repos[0]!.relativePath).toBe("acme/api");

    // Disk remains at from
    expect(existsSync(path.join(root, "acme", "api", "data.txt"))).toBe(true);
  });

  test("F2: case-only reorganize phase 2 failure rolls back tmp to source", async () => {
    const root = tempDir("repotruck-f2-phase2-fail-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [makeEntry("acme", "api", "ACME/API", true)],
    };
    mkdirSync(path.join(root, "ACME", "API"), { recursive: true });
    writeFileSync(path.join(root, "ACME", "API", "data.txt"), "f2 content", "utf8");
    await writeWorkspaceConfig(root, config);

    let phase = 0;
    const customMoveDir = (src: string, dest: string) => {
      phase++;
      if (phase === 2) {
        throw new Error("Simulated permission denied on phase 2 destination");
      }
      moveDir(src, dest);
    };

    const result = await reorganizeWorkspace(root, "flat-by-owner", {
      moveDirImpl: customMoveDir,
    });

    expect(result.failed.some((f) => f.key === "acme/api")).toBe(true);

    // Rollback restored files to source path
    expect(existsSync(path.join(root, "ACME", "API", "data.txt"))).toBe(true);

    // Config still points to source path
    const cfg = await readWorkspaceConfig(root);
    expect(cfg!.repos[0]!.relativePath).toBe("ACME/API");
  });

  test("M3: resume updates aliases for completed moves", async () => {
    const { root, config } = await createReorgFixture();
    await writeWorkspaceConfig(root, {
      ...config,
      aliases: {
        myApi: "acme/api",
      },
    });

    // Manually move acme/api to destination "acme/source/api"
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    writeFileSync(path.join(root, "acme", "source", "api", "README.md"), "done", "utf8");
    rmSync(path.join(root, "acme", "api"), { recursive: true, force: true });

    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "categorized",
      timestamp: new Date().toISOString(),
      moves: [{ key: "acme/api", from: "acme/api", to: "acme/source/api", status: "done" }],
    });

    const result = await reorganizeWorkspace(root, undefined, { resume: true });
    expect(result.moved.some((m) => m.key === "acme/api")).toBe(true);

    const cfg = await readWorkspaceConfig(root);
    expect(cfg?.aliases?.myApi).toBe("acme/source/api");
  });

  test("M4: resume records failure when rollback of in-flight tmpPath fails", async () => {
    const root = tempDir("repotruck-m4-fail-");
    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "flat-by-owner",
      lastSync: null,
      repos: [makeEntry("acme", "api", "acme/api", true)],
    };
    mkdirSync(path.join(root, "acme", "api.tmp-stuck"), { recursive: true });
    await writeWorkspaceConfig(root, config);

    writeReorganizeJournalAtomically(root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/api",
          from: "acme/api",
          to: "acme/API",
          tmpPath: "acme/api.tmp-stuck",
          status: "pending",
        },
      ],
    });

    const failingMoveDir = () => {
      throw new Error("EACCES: rollback permission denied");
    };

    const result = await reorganizeWorkspace(root, undefined, {
      resume: true,
      moveDirImpl: failingMoveDir,
    });

    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.key).toBe("acme/api");
    expect(result.failed[0]?.message).toContain("failed to roll back");
  });

  test("edge cases: missing preset, missing source, already at target, missing journal", async () => {
    const { root } = await createReorgFixture();

    // 1. Missing preset without resume
    expect(reorganizeWorkspace(root, undefined)).rejects.toThrow("preset is required");

    // 2. Resume when no journal exists
    deleteReorganizeJournal(root);
    expect(reorganizeWorkspace(root, undefined, { resume: true })).rejects.toThrow(
      "no unfinished reorganize journal found",
    );

    // 3. Source not on disk
    rmSync(path.join(root, "acme", "api"), { recursive: true, force: true });
    const resultMissingSrc = await reorganizeWorkspace(root, "categorized");
    expect(
      resultMissingSrc.failed.some((f) => f.key === "acme/api" && f.message === "not on disk"),
    ).toBe(true);

    // 4. Already at target
    const resultSame = await reorganizeWorkspace(root, "categorized");
    expect(resultSame.skipped.some((s) => s.reason === "already at target")).toBe(true);
  });
});
