import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sanitizeSegment } from "../src/presets/index.ts";
import { archiveRepository, deleteRepository } from "../src/services/lifecycle.ts";
import { moveDir, moveRepository } from "../src/services/mover.ts";
import { reorganizeWorkspace } from "../src/services/reorganizer.ts";
import { emptyTrash, listTrashEntries, restoreTrashEntry } from "../src/services/trash.ts";
import { workspacePath } from "../src/services/workspacePaths.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { inventoryEntry, remoteRepo, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const savedConfig = process.env.REPOTRUCK_CONFIG_DIR;
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  return f;
}
afterEach(() => {
  if (savedConfig === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = savedConfig;
  for (const f of fixtures.splice(0)) f.cleanup();
});
const fsError = (code: string) => Object.assign(new Error(code), { code });

describe("filesystem failure contracts", () => {
  test("[E12] exact target is a no-op; descendant and occupied ancestor do not move user data", async () => {
    const f = fixture();
    await f.save();
    expect((await moveRepository(f.root, f.config, "acme/api", "acme/source/api")).message).toBe(
      "already there",
    );
    expect((await moveRepository(f.root, f.config, "acme/api", "acme/source/api/child")).ok).toBe(
      false,
    );
    expect((await moveRepository(f.root, f.config, "acme/api", "acme/source")).ok).toBe(false);
    expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
  });

  test("[E13] EXDEV copy success followed by rm failure retains both copies and reports their locations", () => {
    const f = fixture();
    const dest = path.join(f.root, "destination");
    expect(() =>
      moveDir(f.repoDir, dest, {
        renameSync: () => {
          throw fsError("EXDEV");
        },
        rmSync: () => {
          throw fsError("EPERM");
        },
      }),
    ).toThrow("both copies retained");
    expect(readFileSync(path.join(dest, "sentinel.txt"), "utf8")).toBe("user data\n");
    expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
  });

  test("[E14] failed cross-device copy and cleanup preserve the source and unrelated neighbour", () => {
    const f = fixture();
    const dest = path.join(f.root, "destination");
    const neighbour = path.join(f.root, "neighbour");
    mkdirSync(neighbour);
    writeFileSync(path.join(neighbour, "keep"), "untouched");
    expect(() =>
      moveDir(f.repoDir, dest, {
        renameSync: () => {
          throw fsError("EXDEV");
        },
        cpSync: () => {
          mkdirSync(dest);
          writeFileSync(path.join(dest, "partial"), "partial");
          throw fsError("ENOSPC");
        },
        rmSync: () => {
          throw fsError("EPERM");
        },
      }),
    ).toThrow("partial copy remains");
    expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
    expect(readFileSync(path.join(neighbour, "keep"), "utf8")).toBe("untouched");
    expect(existsSync(path.join(dest, "partial"))).toBe(true);
  });

  test.each([1, 2])(
    "[E15] case-only phase %s failure leaves source and aliases intact",
    async (phase) => {
      const f = fixture();
      f.config.aliases = { api: "acme/source/api" };
      await f.save();
      let calls = 0;
      const result = await moveRepository(f.root, f.config, "acme/api", "acme/source/API", {
        moveDirImpl: (src, dest) => {
          if (++calls === phase) throw fsError("EBUSY");
          moveDir(src, dest);
        },
      });
      expect(result.ok).toBe(false);
      expect(existsSync(f.repoDir)).toBe(true);
      expect((await readWorkspaceConfig(f.root, f.env))?.aliases).toEqual(f.config.aliases);
      expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
    },
  );

  test("[E16] sanitized and normalized names collide before a destructive reorganization", async () => {
    const f = fixture();
    expect(sanitizeSegment("CON")).toBe("_CON");
    expect(sanitizeSegment("nul.txt")).toBe("_nul.txt");
    expect(sanitizeSegment("é")).toBe(sanitizeSegment("e\u0301"));
    f.config.repos = [inventoryEntry("one"), { ...inventoryEntry("two"), name: "api." }];
    mkdirSync(path.join(f.root, "one"));
    mkdirSync(path.join(f.root, "two"));
    writeFileSync(path.join(f.root, "one/file"), "one");
    writeFileSync(path.join(f.root, "two/file"), "two");
    await f.save();
    const result = await reorganizeWorkspace(f.root, "flat", { dryRun: true, env: f.env });
    expect(result.collisions.length).toBe(1);
    expect(result.moved.length).toBe(1);
    expect(readFileSync(path.join(f.root, "one/file"), "utf8")).toBe("one");
    expect(readFileSync(path.join(f.root, "two/file"), "utf8")).toBe("two");
  });

  test.each([
    "",
    ".",
    "..",
    "../outside",
    "/",
    "\\outside",
    "C:\\outside",
    "\\\\server\\share",
    "a/../b",
    "a\\..\\b",
  ])("[E17] malformed inventory path %s never reaches deletion", async (relativePath) => {
    const f = fixture();
    const config = { ...f.config, repos: [inventoryEntry(relativePath)] };
    let called = false;
    expect(() => workspacePath(f.root, relativePath)).toThrow();
    const result = await deleteRepository(
      f.root,
      config,
      "acme/api",
      {
        yes: true,
        rmImpl: () => {
          called = true;
        },
      },
      f.env,
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    expect((await moveRepository(f.root, config, "acme/api", "safe/dest")).ok).toBe(false);
    let archived = false;
    expect(
      (
        await archiveRepository(
          f.root,
          config,
          "acme/api",
          {
            getRepo: async () => remoteRepo,
            archiveRepo: async () => {
              archived = true;
              return remoteRepo;
            },
          },
          {},
          f.env,
        )
      ).ok,
    ).toBe(false);
    expect(archived).toBe(false);
    expect((await restoreTrashEntry(f.root, relativePath)).ok).toBe(false);
    expect(existsSync(f.repoDir)).toBe(true);
  });

  test("[E18] a moved checkout survives an inventory write failure with an actionable recovery path", async () => {
    const f = fixture();
    await f.save();
    const result = await moveRepository(f.root, f.config, "acme/api", "relocated/api", {
      updateWorkspaceImpl: async () => {
        throw fsError("ENOSPC");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("inventory save failed");
    expect(result.message).toContain("doctor --fix");
    expect(readFileSync(path.join(f.root, "relocated/api/sentinel.txt"), "utf8")).toBe(
      "user data\n",
    );
    expect((await readWorkspaceConfig(f.root, f.env))?.repos[0]?.relativePath).toBe(
      "acme/source/api",
    );
  });

  test("[E19] archive retries the physical move without losing aliases or custom metadata", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.repos[0]!.custom = true;
    await f.save();
    const github = {
      getRepo: async () => remoteRepo,
      archiveRepo: async () => ({ ...remoteRepo, isArchived: true }),
    };
    expect(
      (
        await archiveRepository(
          f.root,
          f.config,
          "acme/api",
          github,
          {
            moveImpl: () => {
              throw fsError("EBUSY");
            },
          },
          f.env,
        )
      ).ok,
    ).toBe(false);
    const partial = (await readWorkspaceConfig(f.root, f.env))!;
    expect(partial.repos[0]?.category).toBe("archived");
    expect(partial.repos[0]?.relativePath).toBe("acme/source/api");
    expect((await archiveRepository(f.root, partial, "acme/api", github, {}, f.env)).ok).toBe(true);
    const final = (await readWorkspaceConfig(f.root, f.env))!;
    expect(final.aliases?.api).toBe("acme/archived/api");
    expect(final.repos[0]?.custom).toBe(true);
    expect(readFileSync(path.join(f.root, "acme/archived/api/sentinel.txt"), "utf8")).toBe(
      "user data\n",
    );
  });

  test("[E20] delete refusal and rm failure preserve aliases, pins, profiles and unrelated repos", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    f.config.profiles = { one: ["acme/api", "other/lib"] };
    f.config.repos.push({ ...inventoryEntry("other/lib"), owner: "other", name: "lib" });
    await f.save();
    const before = JSON.stringify(await readWorkspaceConfig(f.root, f.env));
    expect((await deleteRepository(f.root, f.config, "api", {}, f.env)).ok).toBe(false);
    expect(
      (
        await deleteRepository(
          f.root,
          f.config,
          "api",
          {
            yes: true,
            rmImpl: () => {
              throw fsError("EPERM");
            },
          },
          f.env,
        )
      ).ok,
    ).toBe(false);
    expect(JSON.stringify(await readWorkspaceConfig(f.root, f.env))).toBe(before);
    expect((await deleteRepository(f.root, f.config, "api", { yes: true }, f.env)).ok).toBe(true);
    const after = (await readWorkspaceConfig(f.root, f.env))!;
    expect(after.aliases).toEqual({});
    expect(after.pinned).toEqual([]);
    expect(after.profiles?.one).toEqual(["other/lib"]);
    expect(after.repos[0]?.owner).toBe("other");
  });

  test("[E21] an occupied trash timestamp never overwrites the prior recoverable copy", async () => {
    const f = fixture();
    await f.save();
    const stamp = Date.now();
    const now = Date.now;
    const old = path.join(f.root, ".repotruck/trash", `acme-api-${stamp}`);
    mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, "old.txt"), "old");
    Date.now = () => stamp;
    try {
      const result = await deleteRepository(
        f.root,
        f.config,
        "acme/api",
        { yes: true, trash: true },
        f.env,
      );
      expect(result.ok).toBe(true);
      expect(result.trashPath).not.toBe(old);
      expect(readFileSync(path.join(old, "old.txt"), "utf8")).toBe("old");
      expect(listTrashEntries(f.root).length).toBe(2);
      expect(emptyTrash(f.root, { now: stamp, olderThanDays: 1 }).removed).toEqual([]);
    } finally {
      Date.now = now;
    }
  });
});
