import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type RepotruckConfig, readAgentsMd } from "../src/services/config.ts";
import { moveDir, moveRepository, validateMoveDestination } from "../src/services/mover.ts";
import { reorganizeWorkspace } from "../src/services/reorganizer.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
let configDir: string;
let savedConfigDir: string | undefined;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configDir = tempDir("repotruck-move-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
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

function entry(
  owner: string,
  name: string,
  relativePath: string,
  internal: boolean,
  custom?: boolean,
) {
  return {
    owner,
    name,
    category: "source" as const,
    relativePath,
    internal,
    language: null,
    updatedAt: null,
    ...(custom !== undefined ? { custom } : {}),
  };
}

async function makeMoveWorkspace(): Promise<{ root: string; config: RepotruckConfig }> {
  const root = tempDir("repotruck-move-ws-");
  const config: RepotruckConfig = {
    version: 1,
    root,
    preset: "categorized",
    lastSync: null,
    repos: [
      entry("acme", "api", "acme/source/api", true),
      entry("blocker", "lib", "blocked/lib", true),
    ],
  };
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  writeFileSync(path.join(root, "acme", "source", "api", "README.md"), "demo", "utf8");
  mkdirSync(path.join(root, "blocked", "lib"), { recursive: true });
  writeFileSync(path.join(root, "blocked", "lib", "lib.rs"), "demo", "utf8");
  await writeWorkspaceConfig(root, config);
  return { root, config };
}

describe("moveDir EXDEV fallback and error handling", () => {
  test("falls back to cpSync + rmSync on EXDEV (C8)", () => {
    const root = tempDir("repotruck-exdev-c8-");
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "file.txt"), "hello exdev", "utf8");

    let renameCalled = false;
    const exdevError = new Error("Cross-device link") as Error & { code: string };
    exdevError.code = "EXDEV";

    moveDir(src, dest, {
      renameSync: () => {
        renameCalled = true;
        throw exdevError;
      },
    });

    expect(renameCalled).toBe(true);
    expect(existsSync(src)).toBe(false);
    expect(existsSync(path.join(dest, "file.txt"))).toBe(true);
    expect(readFileSync(path.join(dest, "file.txt"), "utf8")).toBe("hello exdev");
  });

  test("cleans up destination and preserves source on EXDEV copy failure (C9)", () => {
    const root = tempDir("repotruck-exdev-c9-");
    const src = path.join(root, "src");
    const dest = path.join(root, "dest");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "file.txt"), "intact", "utf8");

    const exdevError = new Error("Cross-device link") as Error & { code: string };
    exdevError.code = "EXDEV";

    expect(() => {
      moveDir(src, dest, {
        renameSync: () => {
          throw exdevError;
        },
        cpSync: (_s, d) => {
          mkdirSync(d as string, { recursive: true });
          writeFileSync(path.join(d as string, "corrupt.tmp"), "partial", "utf8");
          throw new Error("Disk full");
        },
      });
    }).toThrow("Disk full");

    expect(existsSync(dest)).toBe(false);
    expect(existsSync(src)).toBe(true);
    expect(readFileSync(path.join(src, "file.txt"), "utf8")).toBe("intact");
  });

  test("cleans up newly created empty parent directories on EXDEV failure (C32)", () => {
    const root = tempDir("repotruck-exdev-c32-");
    const src = path.join(root, "src");
    const dest = path.join(root, "new-parent", "nested-parent", "dest");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "file.txt"), "intact", "utf8");

    const exdevError = new Error("Cross-device link") as Error & { code: string };
    exdevError.code = "EXDEV";

    expect(() => {
      moveDir(src, dest, {
        renameSync: () => {
          throw exdevError;
        },
        cpSync: () => {
          throw new Error("Copy error midway");
        },
      });
    }).toThrow("Copy error midway");

    expect(existsSync(dest)).toBe(false);
    expect(existsSync(path.join(root, "new-parent", "nested-parent"))).toBe(false);
    expect(existsSync(path.join(root, "new-parent"))).toBe(false);
    expect(existsSync(src)).toBe(true);
  });
});

describe("validateMoveDestination", () => {
  test("accepts and cleans a plain posix-relative path", () => {
    expect(validateMoveDestination("acme/source/api")).toEqual(["acme", "source", "api"]);
  });

  test("sanitizes illegal characters per segment", () => {
    expect(validateMoveDestination("Acme:Co/repo?")).toEqual(["Acme-Co", "repo-"]);
  });

  test("rejects absolute paths", () => {
    expect(validateMoveDestination("/etc/passwd")).toBeNull();
    expect(validateMoveDestination("C:\\dev\\x")).toBeNull();
  });

  test("rejects drive letters", () => {
    expect(validateMoveDestination("C:relpath")).toBeNull();
  });

  test("rejects .. segments", () => {
    expect(validateMoveDestination("acme/../secret")).toBeNull();
    expect(validateMoveDestination("..\\escape")).toBeNull();
  });

  test("rejects empty and dot-only paths", () => {
    expect(validateMoveDestination("")).toBeNull();
    expect(validateMoveDestination(".")).toBeNull();
    expect(validateMoveDestination("./x")).toBeNull();
  });
});

describe("moveRepository", () => {
  test("moves the directory, rewrites inventory and AGENTS.md, sets custom", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "acme/api", "acme/moved/api");
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(false);
    expect(existsSync(path.join(root, "acme", "moved", "api", "README.md"))).toBe(true);
    const saved = await readWorkspaceConfig(root);
    expect(saved).not.toBeNull();
    const movedEntry = saved!.repos.find((item) => item.name === "api");
    expect(movedEntry!.relativePath).toBe("acme/moved/api");
    expect(movedEntry!.custom).toBe(true);
    expect(movedEntry!.internal).toBe(true);
    const agents = await readAgentsMd(root);
    expect(agents).toContain("acme/moved/api");
    expect(agents).not.toContain("acme/source/api");
  });

  test("fails when the target is tracked by another repository", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "acme/api", "blocked/lib");
    expect(result.ok).toBe(false);
    expect(existsSync(path.join(root, "acme", "source", "api", "README.md"))).toBe(true);
  });

  test("fails when the target exists on disk but is untracked", async () => {
    const { root, config } = await makeMoveWorkspace();
    mkdirSync(path.join(root, "random"));
    const result = await moveRepository(root, config, "acme/api", "random");
    expect(result.ok).toBe(false);
    expect(existsSync(path.join(root, "acme", "source", "api", "README.md"))).toBe(true);
  });

  test("no-op success when the repository is already at the target", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "acme/api", "acme/source/api");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("already there");
    expect(existsSync(path.join(root, "acme", "source", "api", "README.md"))).toBe(true);
  });

  test("fails for untracked keys", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "ghost/repo", "somewhere/else");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not tracked by repotruck");
  });

  test("fails when the source directory is missing on disk", async () => {
    const { root, config } = await makeMoveWorkspace();
    const withGhost: RepotruckConfig = {
      ...config,
      repos: [...config.repos, entry("ghost", "gone", "ghost/gone", true)],
    };
    const result = await moveRepository(root, withGhost, "ghost/gone", "ghost/elsewhere");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not on disk");
  });

  test("performs case-only rename via two-phase move (C10)", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "acme/api", "acme/source/API");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("moved to acme/source/API");

    const saved = await readWorkspaceConfig(root);
    expect(saved).not.toBeNull();
    const movedEntry = saved!.repos.find((item) => item.name === "api");
    expect(movedEntry!.relativePath).toBe("acme/source/API");
    expect(movedEntry!.custom).toBe(true);
    expect(existsSync(path.join(root, "acme", "source", "API", "README.md"))).toBe(true);
  });

  test("rolls back tempDir to sourceDir when phase 2 fails in case-only rename (F2)", async () => {
    const { root, config } = await makeMoveWorkspace();
    let phase = 0;
    const customMoveDir = (src: string, dest: string) => {
      phase++;
      if (phase === 2) {
        throw new Error("Simulated phase 2 destination failure");
      }
      moveDir(src, dest);
    };

    const result = await moveRepository(root, config, "acme/api", "acme/source/API", {
      moveDirImpl: customMoveDir,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed to move repository to acme/source/API");

    // Source must remain intact at original location
    expect(existsSync(path.join(root, "acme", "source", "api", "README.md"))).toBe(true);

    // Config must not have changed
    const saved = await readWorkspaceConfig(root);
    const repoEntry = saved!.repos.find((item) => item.name === "api");
    expect(repoEntry!.relativePath).toBe("acme/source/api");
  });

  test("fails with invalid repository key", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "invalid-key-no-slash", "dest");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("invalid repository key");
  });

  test("fails with invalid destination path", async () => {
    const { root, config } = await makeMoveWorkspace();
    const result = await moveRepository(root, config, "acme/api", "../outside");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("invalid destination path");
  });

  test("fails when moveDir throws on normal move", async () => {
    const { root, config } = await makeMoveWorkspace();
    const customMoveDir = () => {
      throw new Error("Simulated moveDir failure");
    };
    const result = await moveRepository(root, config, "acme/api", "acme/new/api", {
      moveDirImpl: customMoveDir,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "failed to move repository to acme/new/api: Simulated moveDir failure",
    );
  });

  test("fails when phase 1 fails in case-only rename", async () => {
    const { root, config } = await makeMoveWorkspace();
    const customMoveDir = () => {
      throw new Error("Phase 1 temp failure");
    };
    const result = await moveRepository(root, config, "acme/api", "acme/source/API", {
      moveDirImpl: customMoveDir,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "failed to move repository to acme/source/API: Phase 1 temp failure",
    );
  });

  test("fails and reports rollback failure when both phase 2 and rollback fail in case-only rename", async () => {
    const { root, config } = await makeMoveWorkspace();
    let phase = 0;
    const customMoveDir = () => {
      phase++;
      if (phase === 1) return;
      if (phase === 2) throw new Error("Phase 2 fail");
      throw new Error("Rollback fail");
    };
    const result = await moveRepository(root, config, "acme/api", "acme/source/API", {
      moveDirImpl: customMoveDir,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      "phase 2 failed (Phase 2 fail); rollback failed (Rollback fail)",
    );
  });

  test("updates aliases when repository is moved", async () => {
    const { root, config } = await makeMoveWorkspace();
    await writeWorkspaceConfig(root, {
      ...config,
      aliases: {
        myTool: "acme/source/api",
      },
    });
    const result = await moveRepository(root, config, "acme/api", "acme/renamed/api");
    expect(result.ok).toBe(true);

    const saved = await readWorkspaceConfig(root);
    expect(saved?.aliases?.myTool).toBe("acme/renamed/api");
  });
});

async function makeReorganizeWorkspace(): Promise<{ root: string; config: RepotruckConfig }> {
  const root = tempDir("repotruck-reorg-ws-");
  const config: RepotruckConfig = {
    version: 1,
    root,
    preset: "flat-by-owner",
    lastSync: null,
    repos: [
      entry("acme", "api", "acme/api", true, true),
      entry("acme", "web", "acme/web", true),
      entry("octo", "lib", "community/octo/lib", false),
      entry("dave", "tools", "dave/source/tools", true),
    ],
  };
  for (const rel of ["acme/api", "acme/web", "community/octo/lib", "dave/source/tools"]) {
    mkdirSync(path.join(root, ...rel.split("/")), { recursive: true });
    writeFileSync(path.join(root, ...rel.split("/"), "file.txt"), "demo", "utf8");
  }
  await writeWorkspaceConfig(root, config);
  return { root, config };
}

describe("reorganizeWorkspace keepCustom planning", () => {
  test("keepCustom skips custom entries and refiles the rest", async () => {
    const { root, config } = await makeReorganizeWorkspace();
    const result = await reorganizeWorkspace(root, "categorized", { keepCustom: true });
    expect(result.moved.map((move) => move.key).sort()).toEqual(["acme/web", "octo/lib"]);
    const skippedApi = result.skipped.find((skip) => skip.key === "acme/api");
    expect(skippedApi).toBeDefined();
    const skippedTools = result.skipped.find((skip) => skip.key === "dave/tools");
    expect(skippedTools).toBeDefined();
    expect(result.collisions).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(existsSync(path.join(root, "acme", "api", "file.txt"))).toBe(true);
    expect(existsSync(path.join(root, "acme", "source", "web", "file.txt"))).toBe(true);
    expect(existsSync(path.join(root, "acme", "web", "file.txt"))).toBe(false);
    const saved = await readWorkspaceConfig(root);
    expect(saved!.preset).toBe("categorized");
    const apiEntry = saved!.repos.find((item) => item.name === "api");
    expect(apiEntry!.relativePath).toBe("acme/api");
    expect(apiEntry!.custom).toBe(true);
    expect(config.preset).toBe("flat-by-owner");
  });

  test("dryRun plans only and touches nothing", async () => {
    const { root } = await makeReorganizeWorkspace();
    const result = await reorganizeWorkspace(root, "categorized", { dryRun: true });
    expect(result.moved.map((move) => move.key).sort()).toEqual([
      "acme/api",
      "acme/web",
      "octo/lib",
    ]);
    expect(existsSync(path.join(root, "acme", "api", "file.txt"))).toBe(true);
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(false);
    const saved = await readWorkspaceConfig(root);
    expect(saved!.preset).toBe("flat-by-owner");
  });

  test("default refiles custom entries and clears the flag", async () => {
    const { root } = await makeReorganizeWorkspace();
    const result = await reorganizeWorkspace(root, "categorized");
    expect(result.moved.map((move) => move.key).sort()).toEqual([
      "acme/api",
      "acme/web",
      "octo/lib",
    ]);
    const saved = await readWorkspaceConfig(root);
    const apiEntry = saved!.repos.find((item) => item.name === "api");
    expect(apiEntry!.relativePath).toBe("acme/source/api");
    expect(apiEntry!.custom).toBe(false);
    expect(saved!.preset).toBe("categorized");
    const agents = await readAgentsMd(root);
    expect(agents).toContain("acme/source/api");
    expect(agents).toContain("community/octo/source/lib");
  });
});
