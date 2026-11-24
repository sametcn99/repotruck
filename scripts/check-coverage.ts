// Validate source inventory and counters before enforcing aggregate 85/75.
// CLI coverage is reported separately; index.tsx has real PTY acceptance tests.
// Preserve first-run failures instead of automatically retrying the full suite.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  aggregateCoverage,
  assertCoveragePolicy,
  parseCoverage,
  sourceInventory,
} from "./lib/coverage.ts";

const covDir = process.env.REPOTRUCK_TEST_RESULTS_DIR
  ? path.resolve(process.env.REPOTRUCK_TEST_RESULTS_DIR)
  : mkdtempSync(path.join(tmpdir(), "rt-cov-"));
const testConfigDir = mkdtempSync(path.join(tmpdir(), "repotruck-test-config-"));
mkdirSync(covDir, { recursive: true });
console.log(`check-coverage: evidence retained in ${covDir}`);
const result = Bun.spawnSync(
  [
    process.execPath,
    "test",
    "--parallel=1",
    "--coverage",
    "--coverage-reporter=lcov",
    "--coverage-dir",
    covDir,
    "--reporter=junit",
    "--reporter-outfile",
    path.join(covDir, "tests.xml"),
  ],
  {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      REPOTRUCK_CONFIG_DIR: testConfigDir,
      REPOTRUCK_TEST_CONFIG_DIR: testConfigDir,
    },
  },
);
rmSync(testConfigDir, { recursive: true, force: true });
const runnerLog = result.stdout.toString() + result.stderr.toString();
writeFileSync(path.join(covDir, "runner.log"), runnerLog);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.exitCode !== 0) {
  console.error("check-coverage: test run failed; the first failure is preserved, no retry");
  process.exitCode = result.exitCode ?? 1;
} else {
  try {
    const report = aggregateCoverage(
      parseCoverage(await Bun.file(path.join(covDir, "lcov.info")).text()),
      sourceInventory(process.cwd()),
    );
    writeFileSync(path.join(covDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `check-coverage: aggregate funcs ${report.aggregate.functions.toFixed(2)}% (>= 75%), lines ${report.aggregate.lines.toFixed(2)}% (>= 85%)`,
    );
    if (report.cli)
      console.log(
        `check-coverage: CLI funcs ${report.cli.functions.toFixed(2)}%, lines ${report.cli.lines.toFixed(2)}% (subprocess coverage additional)`,
      );
    console.log(
      `check-coverage: TUI funcs ${report.tui.functions.toFixed(2)}% (>= 80%), lines ${report.tui.lines.toFixed(2)}% (reported)`,
    );
    assertCoveragePolicy(report);
    if (
      /not wrapped in act|act.*was not awaited|overlapping act|flushSync was called inside/i.test(
        runnerLog,
      )
    )
      throw new Error(
        "unexpected React test warnings; fix the act boundary before accepting coverage",
      );
    console.log("check-coverage: PASS");
  } catch (error) {
    console.error(
      `check-coverage: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
