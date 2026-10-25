import { describe, expect, test } from "bun:test";
import path from "node:path";
import { runDoctor } from "../src/services/doctor.ts";
import { GRAMMAR_FILES } from "../src/services/grammarStore.ts";

describe("doctor > grammars check (Sprint 05b)", () => {
  const dummyAuthProbe = async () => ({
    ok: true,
    method: "env" as const,
    tokenSource: "env" as const,
  });

  const dummyWhich = async (cmd: string) => {
    if (cmd === "git") return "/usr/bin/git";
    if (cmd === "gh") return "/usr/bin/gh";
    return null;
  };

  const dummyExec = async () => ({ stdout: "git version 2.40.0" });
  const dummyReadEntries = async () => [];

  test("reports ok when all 6 grammars are cached", async () => {
    const mockCache = path.resolve("/mock/cache/grammars");
    const cachedFiles = new Set(Object.values(GRAMMAR_FILES).map((f) => path.join(mockCache, f)));

    const result = await runDoctor({
      probeAuthImpl: dummyAuthProbe,
      whichImpl: dummyWhich,
      execImpl: dummyExec,
      readEntriesImpl: dummyReadEntries,
      grammarCacheDirImpl: () => mockCache,
      existsSyncImpl: (p: string) => cachedFiles.has(p),
    });

    expect(result.ok).toBe(true);
    const grammarCheck = result.checks.find((c) => c.check === "grammars");
    expect(grammarCheck).toBeDefined();
    expect(grammarCheck?.status).toBe("ok");
    expect(grammarCheck?.detail).toBe("6/6 grammars cached");
  });

  test("reports warn when partial grammars are cached", async () => {
    const mockCache = path.resolve("/mock/cache/grammars");
    // Only cache 2 grammars (ts and python)
    const cachedFiles = new Set([
      path.join(mockCache, GRAMMAR_FILES.ts),
      path.join(mockCache, GRAMMAR_FILES.python),
    ]);

    const result = await runDoctor({
      probeAuthImpl: dummyAuthProbe,
      whichImpl: dummyWhich,
      execImpl: dummyExec,
      readEntriesImpl: dummyReadEntries,
      grammarCacheDirImpl: () => mockCache,
      existsSyncImpl: (p: string) => cachedFiles.has(p),
    });

    expect(result.ok).toBe(true);
    const grammarCheck = result.checks.find((c) => c.check === "grammars");
    expect(grammarCheck).toBeDefined();
    expect(grammarCheck?.status).toBe("warn");
    expect(grammarCheck?.detail).toBe("2/6 grammars cached");
    expect(grammarCheck?.suggestion).toContain("repotruck search-code");
  });

  test("reports warn when 0 grammars are cached", async () => {
    const mockCache = path.resolve("/mock/cache/grammars");

    const result = await runDoctor({
      probeAuthImpl: dummyAuthProbe,
      whichImpl: dummyWhich,
      execImpl: dummyExec,
      readEntriesImpl: dummyReadEntries,
      grammarCacheDirImpl: () => mockCache,
      existsSyncImpl: () => false,
    });

    expect(result.ok).toBe(true);
    const grammarCheck = result.checks.find((c) => c.check === "grammars");
    expect(grammarCheck).toBeDefined();
    expect(grammarCheck?.status).toBe("warn");
    expect(grammarCheck?.detail).toBe("0/6 grammars cached");
    expect(grammarCheck?.suggestion).toContain("REPOTRUCK_GRAMMARS_DIR");
  });

  test("respects REPOTRUCK_GRAMMARS_DIR environment variable override", async () => {
    const customDir = path.resolve(path.join(process.cwd(), "custom-grammars"));
    const checkedPaths: string[] = [];

    await runDoctor({
      env: { REPOTRUCK_GRAMMARS_DIR: customDir },
      probeAuthImpl: dummyAuthProbe,
      whichImpl: dummyWhich,
      execImpl: dummyExec,
      readEntriesImpl: dummyReadEntries,
      existsSyncImpl: (p: string) => {
        checkedPaths.push(p);
        return false;
      },
    });

    expect(checkedPaths.some((p) => p.startsWith(customDir))).toBe(true);
  });
});
