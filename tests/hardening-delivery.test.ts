import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { checkWorkflowPolicy } from "../scripts/lib/workflowPolicy.ts";
import { tuiRuntimeError } from "../src/cliSupport.ts";

describe("release and validation policy", () => {
  test("[E65] advertised TUI minimum versions reject immediately below and accept exact boundary", () => {
    expect(tuiRuntimeError("1.3.13", "26.3.9")).toContain("1.3.14");
    expect(tuiRuntimeError("1.3.14", "20.0.0")).toBeNull();
    expect(tuiRuntimeError(undefined, "26.3.9")).toContain("26.4");
    expect(tuiRuntimeError(undefined, "26.4.0")).toBeNull();
    expect(tuiRuntimeError(undefined, "26.4.0", false)).toContain("--experimental-ffi");
  });
  test("[E70] website test runner fails when the selected test set is empty", () => {
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        ["node_modules/vitest/vitest.mjs", "run", "__there_are_no_tests_here__"],
        { cwd: path.resolve(import.meta.dir, "../website"), stdio: "pipe", timeout: 20000 },
      );
    } catch (error) {
      status = (error as { status: number }).status;
    }
    expect(status).toBe(1);
  }, 25000);
  test("[E71] YAML policy checks semantic nesting and rejects disconnected gates or credential drift", () => {
    const ci = readFileSync(path.resolve(import.meta.dir, "../.github/workflows/ci.yml"), "utf8"),
      release = readFileSync(
        path.resolve(import.meta.dir, "../.github/workflows/release.yml"),
        "utf8",
      );
    expect(checkWorkflowPolicy(ci, release)).toEqual([]);
    const disconnected = parse(release);
    delete disconnected.jobs.publish.needs;
    expect(checkWorkflowPolicy(ci, stringify(disconnected))).toContain("publish must depend on CI");
    const credential = parse(release);
    credential.jobs.publish.steps.find(
      (step: { run?: string }) => step.run?.includes("npm publish"),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentionally invalid GitHub Actions expression
    ).env.NODE_AUTH_TOKEN = "${{ secrets.DIFFERENT_TOKEN }}";
    expect(checkWorkflowPolicy(ci, stringify(credential))).toContain(
      "publish must use the configured scoped npm credential",
    );
    const unpinned = parse(ci);
    unpinned.jobs.ci.steps[0].uses = "actions/checkout@main";
    expect(
      checkWorkflowPolicy(stringify(unpinned), release).some((error) =>
        error.includes("not pinned"),
      ),
    ).toBe(true);
  });
});
