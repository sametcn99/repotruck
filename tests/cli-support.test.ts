import { describe, expect, test } from "bun:test";
import {
  formatWorkspaceLine,
  isAtLeast,
  parseSyncScope,
  tuiRuntimeError,
} from "../src/cliSupport.ts";
import { detectSshAvailability } from "../src/services/cloner.ts";

describe("isAtLeast", () => {
  test("compares semver-ish version strings", () => {
    expect(isAtLeast("1.4.2", [1, 3, 14])).toBe(true);
    expect(isAtLeast("1.3.14", [1, 3, 14])).toBe(true);
    expect(isAtLeast("1.3.9", [1, 3, 14])).toBe(false);
    expect(isAtLeast("2.0.0", [1, 3, 14])).toBe(true);
    expect(isAtLeast("26.2.0", [26, 4, 0])).toBe(false);
    expect(isAtLeast("26.4.0", [26, 4, 0])).toBe(true);
    expect(isAtLeast("27.0.1", [26, 4, 0])).toBe(true);
  });

  test("rejects garbage versions", () => {
    expect(isAtLeast("", [1, 0, 0])).toBe(false);
    expect(isAtLeast("abc", [1, 0, 0])).toBe(false);
  });
});

describe("tuiRuntimeError", () => {
  test("accepts Bun 1.3.14 and newer", () => {
    expect(tuiRuntimeError("1.3.14", null)).toBeNull();
    expect(tuiRuntimeError("1.4.2", null)).toBeNull();
  });

  test("rejects older Bun with an upgrade message", () => {
    const message = tuiRuntimeError("1.2.0", null);
    expect(message).not.toBeNull();
    expect(message!).toContain("Bun 1.3.14");
  });

  test("rejects Node 26.2 with a Bun suggestion", () => {
    const message = tuiRuntimeError(null, "26.2.0");
    expect(message).not.toBeNull();
    expect(message!).toContain("Bun");
    expect(message!).toContain("26.4");
  });

  test("accepts Node 26.4 and newer", () => {
    expect(tuiRuntimeError(null, "26.4.0")).toBeNull();
    expect(tuiRuntimeError(null, "27.1.0")).toBeNull();
  });
});

describe("parseSyncScope", () => {
  test("accepts user, all, and org:<name>", () => {
    expect(parseSyncScope("user")).toEqual({ kind: "user" });
    expect(parseSyncScope("all")).toEqual({ kind: "all" });
    expect(parseSyncScope("org:acme")).toEqual({ kind: "org", org: "acme" });
  });

  test("rejects garbage", () => {
    expect(parseSyncScope("bogus")).toBeNull();
    expect(parseSyncScope("org:")).toBeNull();
    expect(parseSyncScope("")).toBeNull();
    expect(parseSyncScope("org")).toBeNull();
  });
});

describe("formatWorkspaceLine", () => {
  test("renders English fields with missing marker", () => {
    const line = formatWorkspaceLine({
      path: "C:\\ws",
      preset: "categorized",
      lastSync: null,
      repoCount: 3,
      lastUsed: "2026-10-23T00:00:00.000Z",
      missing: true,
    });
    expect(line).toContain("C:\\ws");
    expect(line).toContain("preset categorized");
    expect(line).toContain("3 repositories");
    expect(line).toContain("last sync: never");
    expect(line).toContain("(missing)");
  });

  test("omits the missing marker for existing workspaces", () => {
    const line = formatWorkspaceLine({
      path: "/tmp/ws",
      preset: "flat-by-owner",
      lastSync: "2026-10-23T10:00:00.000Z",
      repoCount: 0,
      lastUsed: "2026-10-23T11:00:00.000Z",
      missing: false,
    });
    expect(line.includes("(missing)")).toBe(false);
    expect(line).toContain("last sync: 2026-10-23T10:00:00.000Z");
  });
});

describe("detectSshAvailability cache guard (carry-over N1)", () => {
  test("injected probe results are never cached", async () => {
    let probeResult = true;
    const probe = async (): Promise<boolean> => probeResult;
    const deps = {
      homeDir: "/nonexistent-repotruck-home",
      readHomeSshDir: async (): Promise<string[]> => ["id_ed25519"],
      runProbe: probe,
    };
    const first = await detectSshAvailability(deps);
    expect(first).toBe(true);
    probeResult = false;
    const second = await detectSshAvailability(deps);
    expect(second).toBe(false);
    probeResult = true;
    const third = await detectSshAvailability(deps);
    expect(third).toBe(true);
  });

  test("injected no-key home dirs skip the probe entirely", async () => {
    let probeRan = false;
    const result = await detectSshAvailability({
      homeDir: "/nonexistent-repotruck-home",
      readHomeSshDir: async (): Promise<string[]> => [],
      runProbe: async (): Promise<boolean> => {
        probeRan = true;
        return true;
      },
    });
    expect(result).toBe(false);
    expect(probeRan).toBe(false);
  });

  test("REPOTRUCK_NO_SSH short-circuits without probing", async () => {
    let probeRan = false;
    const result = await detectSshAvailability({
      env: { REPOTRUCK_NO_SSH: "1" },
      homeDir: "/nonexistent-repotruck-home",
      readHomeSshDir: async (): Promise<string[]> => ["id_ed25519"],
      runProbe: async (): Promise<boolean> => {
        probeRan = true;
        return true;
      },
    });
    expect(result).toBe(false);
    expect(probeRan).toBe(false);
  });
});
