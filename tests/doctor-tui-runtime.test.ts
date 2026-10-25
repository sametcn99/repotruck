import { describe, expect, test } from "bun:test";
import { runDoctor } from "../src/services/doctor.ts";

describe("doctor TUI runtime check (Sprint 8a)", () => {
  test("reports a warning when the dashboard runtime is insufficient", async () => {
    const result = await runDoctor({
      env: {},
      tuiRuntimeImpl: () => "The interactive interface requires Node.js >= 26.4 or newer.",
      whichImpl: async () => "/usr/bin/git",
      execImpl: async () => ({ stdout: "git version 2.0" }),
      probeAuthImpl: async () => ({ method: "env" as const }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => false,
    });
    const check = result.checks.find((c) => c.check === "tui-runtime");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("interactive interface");
    expect(check?.suggestion).toContain("headless");
    // A warning must not fail the doctor run.
    expect(result.ok).toBe(true);
  });

  test("stays silent when the dashboard runtime is fine", async () => {
    const result = await runDoctor({
      env: {},
      tuiRuntimeImpl: () => null,
      whichImpl: async () => "/usr/bin/git",
      execImpl: async () => ({ stdout: "git version 2.0" }),
      probeAuthImpl: async () => ({ method: "env" as const }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => false,
    });
    expect(result.checks.some((c) => c.check === "tui-runtime")).toBe(false);
  });
});
