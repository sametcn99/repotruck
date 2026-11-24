import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { moveDir } from "../src/services/mover.ts";
import {
  reorganizeJournalPath,
  reorganizeWorkspace,
  writeReorganizeJournalAtomically,
} from "../src/services/reorganizer.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];

function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  return f;
}

afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function treeHash(root: string): string {
  const entries: Array<[string, string]> = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) entries.push([relativePath, readFileSync(fullPath, "utf8")]);
    }
  };
  visit(root);
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

describe("reorganize resume acceptance", () => {
  test("pending move refuses an unrelated destination and preserves workspace state", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    await f.save();

    const targetRel = "acme/api";
    const target = path.join(f.root, targetRel);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "README.md"), "unrelated user data\n");
    const journal = {
      version: 1 as const,
      preset: "flat-by-owner" as const,
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/api",
          from: "acme/source/api",
          to: targetRel,
          status: "pending" as const,
        },
      ],
    };
    writeReorganizeJournalAtomically(f.root, journal);
    const journalPath = reorganizeJournalPath(f.root);
    const journalBefore = readFileSync(journalPath, "utf8");
    const sourceHashBefore = treeHash(f.repoDir);
    const targetHashBefore = treeHash(target);

    const result = await reorganizeWorkspace(f.root, undefined, { resume: true, env: f.env });

    expect(result.moved).toEqual([]);
    expect(result.collisions).toEqual([
      { key: "acme/api", target: targetRel, occupiedBy: "(on disk)" },
    ]);
    expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
    expect(readFileSync(path.join(target, "README.md"), "utf8")).toBe("unrelated user data\n");
    expect(treeHash(f.repoDir)).toBe(sourceHashBefore);
    expect(treeHash(target)).toBe(targetHashBefore);
    expect(existsSync(f.repoDir)).toBe(true);

    const persisted = await readWorkspaceConfig(f.root, f.env);
    expect(persisted?.repos[0]?.relativePath).toBe("acme/source/api");
    expect(persisted?.aliases).toEqual({ api: "acme/source/api" });
    expect(persisted?.pinned).toEqual(["acme/api"]);
    expect(existsSync(journalPath)).toBe(true);
    expect(readFileSync(journalPath, "utf8")).toBe(journalBefore);
  });

  test("pending move resumes after a completed rename using the recorded checkout identity", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    await f.save();

    let interrupted = false;
    const interruptedResult = await reorganizeWorkspace(f.root, "flat-by-owner", {
      env: f.env,
      moveDirImpl: (source, destination) => {
        moveDir(source, destination);
        if (!interrupted) {
          interrupted = true;
          throw new Error("simulated crash after physical move");
        }
      },
    });
    expect(interruptedResult.failed).toHaveLength(1);
    expect(interruptedResult.moved).toEqual([]);

    const target = path.join(f.root, "acme", "api");
    expect(existsSync(f.repoDir)).toBe(false);
    expect(readFileSync(path.join(target, "sentinel.txt"), "utf8")).toBe("user data\n");
    expect(existsSync(reorganizeJournalPath(f.root))).toBe(true);

    const resumed = await reorganizeWorkspace(f.root, undefined, { resume: true, env: f.env });
    expect(resumed.moved).toEqual([{ key: "acme/api", from: "acme/source/api", to: "acme/api" }]);
    expect(resumed.collisions).toEqual([]);
    const persisted = await readWorkspaceConfig(f.root, f.env);
    expect(persisted?.repos[0]?.relativePath).toBe("acme/api");
    expect(persisted?.aliases).toEqual({ api: "acme/api" });
    expect(persisted?.pinned).toEqual(["acme/api"]);
    expect(existsSync(reorganizeJournalPath(f.root))).toBe(false);
  });

  test("done journal resumes a completed copy with a different destination identity", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    await f.save();
    const sourceStat = lstatSync(f.repoDir, { bigint: true });
    const sourceIdentity = {
      dev: sourceStat.dev.toString(),
      ino: sourceStat.ino.toString(),
      birthtimeNs: sourceStat.birthtimeNs.toString(),
    };

    const targetRel = "acme/api";
    const target = path.join(f.root, targetRel);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "sentinel.txt"), "copied checkout\n");
    const targetStat = lstatSync(target, { bigint: true });
    expect(`${targetStat.dev}:${targetStat.ino}:${targetStat.birthtimeNs}`).not.toBe(
      `${sourceStat.dev}:${sourceStat.ino}:${sourceStat.birthtimeNs}`,
    );
    rmSync(f.repoDir, { recursive: true, force: true });
    writeReorganizeJournalAtomically(f.root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/api",
          from: "acme/source/api",
          to: targetRel,
          status: "done",
          sourceIdentity,
        },
      ],
    });

    const result = await reorganizeWorkspace(f.root, undefined, { resume: true, env: f.env });

    expect(result.moved).toEqual([{ key: "acme/api", from: "acme/source/api", to: targetRel }]);
    expect(result.collisions).toEqual([]);
    const persisted = await readWorkspaceConfig(f.root, f.env);
    expect(persisted?.repos[0]?.relativePath).toBe(targetRel);
    expect(persisted?.aliases).toEqual({ api: targetRel });
    expect(persisted?.pinned).toEqual(["acme/api"]);
    expect(readFileSync(path.join(target, "sentinel.txt"), "utf8")).toBe("copied checkout\n");
    expect(existsSync(reorganizeJournalPath(f.root))).toBe(false);
  });

  test("pending move with absent source and unproven destination stays ambiguous", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    await f.save();

    const targetRel = "acme/api";
    const target = path.join(f.root, targetRel);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "README.md"), "unrelated user data\n");
    rmSync(f.repoDir, { recursive: true, force: true });
    writeReorganizeJournalAtomically(f.root, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [{ key: "acme/api", from: "acme/source/api", to: targetRel, status: "pending" }],
    });
    const journalPath = reorganizeJournalPath(f.root);
    const journalBefore = readFileSync(journalPath, "utf8");

    const result = await reorganizeWorkspace(f.root, undefined, { resume: true, env: f.env });

    expect(result.moved).toEqual([]);
    expect(result.collisions).toEqual([
      { key: "acme/api", target: targetRel, occupiedBy: "(on disk)" },
    ]);
    const persisted = await readWorkspaceConfig(f.root, f.env);
    expect(persisted?.repos[0]?.relativePath).toBe("acme/source/api");
    expect(persisted?.aliases).toEqual({ api: "acme/source/api" });
    expect(persisted?.pinned).toEqual(["acme/api"]);
    expect(readFileSync(path.join(target, "README.md"), "utf8")).toBe("unrelated user data\n");
    expect(existsSync(journalPath)).toBe(true);
    expect(readFileSync(journalPath, "utf8")).toBe(journalBefore);
  });
});
