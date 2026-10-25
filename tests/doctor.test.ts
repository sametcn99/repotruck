import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import { type DoctorDeps, fixDoctor, runDoctor } from "../src/services/doctor.ts";
import {
  type ReorganizeJournal,
  reorganizeJournalPath,
  writeReorganizeJournalAtomically,
} from "../src/services/reorganizer.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const healthyBaseDeps = {
  whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
  execImpl: async (cmd: string) => ({ stdout: `${cmd} version 2.40.0` }),
  probeAuthImpl: async () => ({ method: "cached" as const }),
};

async function createTestWorkspace(name: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), `repotruck-doctor-${name}-`));
  const config: RepotruckConfig = {
    version: 1,
    root: dir,
    preset: "categorized",
    lastSync: null,
    repos: [
      {
        owner: "acme",
        name: "tool",
        category: "source",
        relativePath: "acme/tool",
        internal: true,
        language: null,
        updatedAt: null,
      },
    ],
  };
  mkdirSync(path.join(dir, "acme", "tool"), { recursive: true });
  writeFileSync(path.join(dir, "acme", "tool", "main.ts"), "console.log(1);", "utf8");
  await writeWorkspaceConfig(dir, config);
  return dir;
}

describe("doctor diagnostic checks", () => {
  test("all healthy returns ok result", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
      execImpl: async (cmd: string) => ({ stdout: `${cmd} version 2.40.0` }),
      probeAuthImpl: async () => ({ method: "env" }),
      readEntriesImpl: async () => [
        {
          version: 1,
          root: "/workspace/one",
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
      existsSyncImpl: () => true,
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(true);
    expect(result.checks.length).toBe(5);
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
  });

  test("missing git results in failure with suggestion", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => (cmd === "git" ? null : `/usr/bin/${cmd}`),
      execImpl: async () => ({ stdout: "ok" }),
      probeAuthImpl: async () => ({ method: "cached" }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => true,
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(false);
    const gitCheck = result.checks.find((c) => c.check === "git");
    expect(gitCheck?.status).toBe("fail");
    expect(gitCheck?.suggestion).toContain("install git");
  });

  test("missing gh results in warning (not failure)", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => (cmd === "gh" ? null : `/usr/bin/${cmd}`),
      execImpl: async () => ({ stdout: "git version 2.40.0" }),
      probeAuthImpl: async () => ({ method: "cached" }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => true,
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(true);
    const ghCheck = result.checks.find((c) => c.check === "gh");
    expect(ghCheck?.status).toBe("warn");
  });

  test("unauthenticated results in failure", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
      execImpl: async () => ({ stdout: "git version 2.40.0" }),
      probeAuthImpl: async () => ({ method: "none" }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => true,
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(false);
    const tokenCheck = result.checks.find((c) => c.check === "token");
    expect(tokenCheck?.status).toBe("fail");
  });

  test("corrupt central store results in failure", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
      execImpl: async () => ({ stdout: "git version 2.40.0" }),
      probeAuthImpl: async () => ({ method: "cached" }),
      readEntriesImpl: async () => {
        throw new Error("malformed JSON in repotruck.json");
      },
      existsSyncImpl: () => true,
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(false);
    const configCheck = result.checks.find((c) => c.check === "config");
    expect(configCheck?.status).toBe("fail");
    expect(configCheck?.suggestion).toContain("repotruck.json.bak");
  });

  test("missing workspace root on disk results in warning", async () => {
    const deps: DoctorDeps = {
      whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
      execImpl: async () => ({ stdout: "git version 2.40.0" }),
      probeAuthImpl: async () => ({ method: "cached" }),
      readEntriesImpl: async () => [
        {
          version: 1,
          root: "/workspace/nonexistent",
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
      existsSyncImpl: (p: string) => !p.includes("nonexistent"),
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(true);
    const diskCheck = result.checks.find((c) => c.check === "disk");
    expect(diskCheck?.status).toBe("warn");
  });

  test("leftover journal produces reorganize failure check (C20)", async () => {
    const root = await createTestWorkspace("c20");
    const journal: ReorganizeJournal = {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/tool",
          from: "acme/tool",
          to: "acme/source/tool",
          status: "pending",
        },
      ],
    };
    writeReorganizeJournalAtomically(root, journal);

    const deps: DoctorDeps = {
      ...healthyBaseDeps,
      readEntriesImpl: async () => [
        {
          version: 1,
          root,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(false);
    const reorgCheck = result.checks.find((c) => c.check === "reorganize");
    expect(reorgCheck).toBeDefined();
    expect(reorgCheck?.status).toBe("fail");
    expect(reorgCheck?.detail).toBe(`unfinished reorganize in progress: ${root}`);
    expect(reorgCheck?.suggestion).toContain("repotruck reorganize --resume");
    expect(reorgCheck?.suggestion).toContain("repotruck doctor --fix");
  });

  test("doctor --fix reconciles leftover journal and clears error (C21)", async () => {
    const root = await createTestWorkspace("c21");
    mkdirSync(path.join(root, "acme", "source", "tool"), { recursive: true });
    writeFileSync(path.join(root, "acme", "source", "tool", "main.ts"), "done", "utf8");
    rmSync(path.join(root, "acme", "tool"), { recursive: true, force: true });

    const journal: ReorganizeJournal = {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [
        {
          key: "acme/tool",
          from: "acme/tool",
          to: "acme/source/tool",
          status: "done",
        },
      ],
    };
    writeReorganizeJournalAtomically(root, journal);

    const deps: DoctorDeps = {
      ...healthyBaseDeps,
      readEntriesImpl: async () => [
        {
          version: 1,
          root,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
    };

    const result = await fixDoctor(deps);
    expect(result.ok).toBe(true);
    expect(result.checks.some((c) => c.check === "reorganize")).toBe(false);
    expect(existsSync(reorganizeJournalPath(root))).toBe(false);

    const saved = await readWorkspaceConfig(root);
    expect(saved?.repos.find((r) => r.name === "tool")?.relativePath).toBe("acme/source/tool");
  });

  test("corrupt journal produces failure check with repair suggestion (C31)", async () => {
    const root = await createTestWorkspace("c31");
    const jPath = reorganizeJournalPath(root);
    mkdirSync(path.dirname(jPath), { recursive: true });
    writeFileSync(jPath, "{ bad json", "utf8");

    const deps: DoctorDeps = {
      ...healthyBaseDeps,
      readEntriesImpl: async () => [
        {
          version: 1,
          root,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
    };

    const result = await runDoctor(deps);
    expect(result.ok).toBe(false);
    const reorgCheck = result.checks.find((c) => c.check === "reorganize");
    expect(reorgCheck?.status).toBe("fail");
    expect(reorgCheck?.detail).toBe(`corrupt reorganize journal in ${root}`);
    expect(reorgCheck?.suggestion).toContain("repair or delete");
  });

  test("doctor --fix reconciles multiple workspaces with leftover journals (C33)", async () => {
    const root1 = await createTestWorkspace("c33-ws1");
    const root2 = await createTestWorkspace("c33-ws2");

    mkdirSync(path.join(root1, "acme", "source", "tool"), { recursive: true });
    writeFileSync(path.join(root1, "acme", "source", "tool", "main.ts"), "done1", "utf8");
    rmSync(path.join(root1, "acme", "tool"), { recursive: true, force: true });
    writeReorganizeJournalAtomically(root1, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [{ key: "acme/tool", from: "acme/tool", to: "acme/source/tool", status: "done" }],
    });

    writeReorganizeJournalAtomically(root2, {
      version: 1,
      preset: "flat-by-owner",
      timestamp: new Date().toISOString(),
      moves: [{ key: "acme/tool", from: "acme/tool", to: "acme/source/tool", status: "pending" }],
    });

    const deps: DoctorDeps = {
      ...healthyBaseDeps,
      readEntriesImpl: async () => [
        {
          version: 1,
          root: root1,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
        {
          version: 1,
          root: root2,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [],
        },
      ],
    };

    const result = await fixDoctor(deps);
    expect(result.ok).toBe(true);
    expect(existsSync(reorganizeJournalPath(root1))).toBe(false);
    expect(existsSync(reorganizeJournalPath(root2))).toBe(false);

    const saved1 = await readWorkspaceConfig(root1);
    expect(saved1?.repos.find((r) => r.name === "tool")?.relativePath).toBe("acme/source/tool");

    const saved2 = await readWorkspaceConfig(root2);
    expect(saved2?.repos.find((r) => r.name === "tool")?.relativePath).toBe("acme/tool");
  });
});
