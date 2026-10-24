import { describe, expect, test } from "bun:test";
import { type DoctorDeps, runDoctor } from "../src/services/doctor.ts";

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
});
