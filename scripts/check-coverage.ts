// Aggregate coverage gate for CI.
//
// bun's `coverageThreshold` in bunfig.toml is enforced PER FILE (any file below
// the threshold fails the run), which does not match this repo's intent: the
// maturity plan sets AGGREGATE thresholds (lines >= 85%, functions >= 75%).
//
// This script runs the full suite with coverage, parses the lcov report, and
// enforces the aggregate thresholds over the in-process instrumentable layers.
//
// Documented scope exclusion (Sapma #3): the CLI adapter layer (`src/cli.ts`,
// `src/cli/**`) is exercised end-to-end by `tests/cli-runtime.test.ts` and
// `tests/cli-exit.test.ts`, which spawn the CLI as a SUBPROCESS — bun's
// coverage cannot instrument child processes, so those files would count as
// uncovered despite passing black-box tests. They are excluded from the
// aggregate; every other layer under src/ is included.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LINES_THRESHOLD = 0.85;
const FUNCS_THRESHOLD = 0.75;

const covDir = mkdtempSync(path.join(tmpdir(), "rt-cov-"));
try {
  // Known-flaky timing tests (updater throttle window, dashboard render smoke)
  // fail intermittently under the slower coverage run while passing in plain
  // runs; a single retry separates that flakiness from real failures.
  let result: ReturnType<typeof Bun.spawnSync>;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = Bun.spawnSync(
      ["bun", "test", "--coverage", "--coverage-reporter=lcov", "--coverage-dir", covDir],
      { stdout: "inherit", stderr: "inherit" },
    );
    if (result.exitCode === 0) break;
    if (attempt === 2) {
      console.error(`check-coverage: test run failed twice (exit code ${result.exitCode})`);
      process.exit(result.exitCode ?? 1);
    }
    console.error("check-coverage: test run failed once — retrying (known flaky timing tests)");
  }

  const lcovPath = path.join(covDir, "lcov.info");
  const lcov = await Bun.file(lcovPath).text();

  let totalLines = 0;
  let coveredLines = 0;
  let totalFuncs = 0;
  let coveredFuncs = 0;
  let currentFile = "";
  let excludedFile = false;
  let excludedLines = 0;

  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3).replace(/\\/g, "/");
      const rel = currentFile.replace(/^.*?((?:^|\/)src\/)/, "src/");
      excludedFile = /^src\/cli\.ts$/.test(rel) || rel.startsWith("src/cli/");
    } else if (line.startsWith("LF:")) {
      if (excludedFile) excludedLines += Number(line.slice(3));
      else totalLines += Number(line.slice(3));
    } else if (line.startsWith("LH:")) {
      if (!excludedFile) coveredLines += Number(line.slice(3));
    } else if (line.startsWith("FNF:")) {
      if (!excludedFile) totalFuncs += Number(line.slice(4));
    } else if (line.startsWith("FNH:")) {
      if (!excludedFile) coveredFuncs += Number(line.slice(4));
    }
  }

  const linesPct = totalLines > 0 ? (coveredLines / totalLines) * 100 : 100;
  const funcsPct = totalFuncs > 0 ? (coveredFuncs / totalFuncs) * 100 : 100;

  console.log(
    `check-coverage: aggregate (excl. CLI adapter layer, ${excludedLines} subprocess-tested lines) ` +
      `funcs ${funcsPct.toFixed(2)}% (>= ${(FUNCS_THRESHOLD * 100).toFixed(0)}%), ` +
      `lines ${linesPct.toFixed(2)}% (>= ${(LINES_THRESHOLD * 100).toFixed(0)}%)`,
  );

  if (linesPct < LINES_THRESHOLD * 100 || funcsPct < FUNCS_THRESHOLD * 100) {
    console.error("check-coverage: FAIL — aggregate coverage below threshold");
    process.exit(1);
  }

  console.log("check-coverage: PASS");
} finally {
  rmSync(covDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
