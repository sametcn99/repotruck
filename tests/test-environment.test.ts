import { afterAll, afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testConfigDir } from "./helpers/test-environment.ts";

const testRoot = mkdtempSync(path.join(tmpdir(), "repotruck-test-environment-proof-"));
const sentinelDir =
  process.env.REPOTRUCK_TEST_ENV_SENTINEL ?? path.join(testRoot, "user-config-sentinel");
const sentinel = path.join(sentinelDir, "sentinel.json");
const childReport =
  process.env.REPOTRUCK_TEST_ENV_REPORT ?? path.join(testRoot, "child-config-path.txt");
const probe = process.env.REPOTRUCK_TEST_ENV_PROBE;
let probeConfigDir = "";
let removeConfigAfterTest = false;

if (!probe && process.env.REPOTRUCK_TEST_CONFIG_REPORT)
  writeFileSync(process.env.REPOTRUCK_TEST_CONFIG_REPORT, testConfigDir);

if (probe === "failing-child") {
  afterAll(() => {
    if (probeConfigDir) rmSync(probeConfigDir, { recursive: true, force: true });
    rmSync(testRoot, { recursive: true, force: true });
  });
  test("intentional child failure writes only to bootstrap config", () => {
    const actual = process.env.REPOTRUCK_CONFIG_DIR!;
    if (actual === sentinelDir) throw new Error("test bootstrap did not replace sentinel config");
    probeConfigDir = actual;
    writeFileSync(path.join(actual, "probe.json"), JSON.stringify({ touched: true }));
    writeFileSync(childReport, actual);
    throw new Error("intentional failure proves isolation survives test failure");
  });
} else if (probe === "explicit-fixture") {
  afterAll(() => rmSync(testRoot, { recursive: true, force: true }));
  test("child preload preserves an explicit config fixture", () => {
    const fixtureDir = process.env.REPOTRUCK_TEST_ENV_FIXTURE!;
    expect(process.env.REPOTRUCK_CONFIG_DIR).toBe(fixtureDir);
    writeFileSync(path.join(fixtureDir, "fixture.json"), JSON.stringify({ preserved: true }));
  });
} else {
  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.REPOTRUCK_CONFIG_DIR;
  });
  afterEach(() => {
    if (!removeConfigAfterTest) return;
    delete process.env.REPOTRUCK_CONFIG_DIR;
    removeConfigAfterTest = false;
  });

  test("direct Bun test bootstrap owns the default Repotruck config directory", () => {
    expect(process.env.REPOTRUCK_CONFIG_DIR).toBe(testConfigDir);
    expect(path.dirname(testConfigDir)).toBe(path.resolve(tmpdir()));
    expect(path.basename(testConfigDir)).toMatch(/^repotruck-test-config-/);
  });

  test("a teardown may delete config env without exposing user defaults", () => {
    removeConfigAfterTest = true;
    expect(process.env.REPOTRUCK_CONFIG_DIR).toBe(testConfigDir);
  });

  test("the next test restores the task-owned config after teardown deletion", () => {
    expect(process.env.REPOTRUCK_CONFIG_DIR).toBe(testConfigDir);
  });

  test("failed Bun child cannot write to a user-config sentinel", () => {
    const original = JSON.stringify({ keep: "untouched" });
    mkdirSync(sentinelDir, { recursive: true });
    writeFileSync(sentinel, original);
    const env = { ...process.env };
    delete env.REPOTRUCK_TEST_CONFIG_DIR;
    delete env.REPOTRUCK_TEST_CONFIG_OWNER_PID;
    env.REPOTRUCK_CONFIG_DIR = sentinelDir;
    env.REPOTRUCK_TEST_ENV_PROBE = "failing-child";
    env.REPOTRUCK_TEST_ENV_SENTINEL = sentinelDir;
    env.REPOTRUCK_TEST_ENV_REPORT = childReport;

    const result = spawnSync(process.execPath, ["test", "tests/test-environment.test.ts"], {
      cwd: path.resolve(import.meta.dir, ".."),
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    const report = existsSync(childReport) ? readFileSync(childReport, "utf8") : "";
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "intentional failure proves isolation survives test failure",
    );
    expect(path.basename(report).startsWith("repotruck-test-config-")).toBe(true);
    expect(path.dirname(report)).toBe(path.resolve(tmpdir()));
    expect(existsSync(report)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe(original);
    expect(existsSync(path.join(sentinelDir, "probe.json"))).toBe(false);
  }, 25_000);

  test("child preload preserves explicit config fixture env", () => {
    const fixtureDir = path.join(testRoot, "explicit-fixture-config");
    mkdirSync(fixtureDir, { recursive: true });
    const env = {
      ...process.env,
      REPOTRUCK_CONFIG_DIR: fixtureDir,
      REPOTRUCK_TEST_ENV_PROBE: "explicit-fixture",
      REPOTRUCK_TEST_ENV_FIXTURE: fixtureDir,
    };
    const result = spawnSync(process.execPath, ["test", "tests/test-environment.test.ts"], {
      cwd: path.resolve(import.meta.dir, ".."),
      env,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(fixtureDir, "fixture.json"))).toBe(true);
  }, 25_000);
}
