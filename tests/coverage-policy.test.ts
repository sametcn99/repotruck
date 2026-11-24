import { expect, test } from "bun:test";
import { aggregateCoverage, assertCoveragePolicy, parseCoverage } from "../scripts/lib/coverage.ts";

function coverageRecord(file: string, functions: number, covered: number): string {
  return [
    `SF:${file}`,
    "LF:100",
    "LH:100",
    `FNF:${functions}`,
    `FNH:${covered}`,
    "end_of_record",
    "",
  ].join("\n");
}

function report(tuiFunctionsCovered: number) {
  // The non-TUI source makes aggregate coverage pass even when TUI is below
  // its independent boundary. CLI remains a separate report as before.
  const lcov = [
    coverageRecord("src/components/Screen.tsx", 1000, tuiFunctionsCovered),
    coverageRecord("src/services/covered.ts", 1000, 1000),
    coverageRecord("src/cli.ts", 50, 50),
  ].join("");
  return aggregateCoverage(parseCoverage(lcov));
}

test("TUI function coverage rejects 79.9% while aggregate coverage passes", () => {
  const result = report(799);
  expect(result.aggregate.functions).toBeGreaterThanOrEqual(75);
  expect(result.aggregate.lines).toBeGreaterThanOrEqual(85);
  expect(result.tui.functions).toBeCloseTo(79.9, 8);
  expect(result.cli?.functions).toBe(100);
  expect(() => assertCoveragePolicy(result)).toThrow("TUI function coverage below 80%");
});

test("TUI function coverage accepts the exact 80% boundary", () => {
  const result = report(800);
  expect(result.aggregate.functions).toBeGreaterThanOrEqual(75);
  expect(result.tui.functions).toBe(80);
  expect(() => assertCoveragePolicy(result)).not.toThrow();
});

test("TUI denominator stays strict for absent, empty, or malformed LCOV", () => {
  expect(() => aggregateCoverage(parseCoverage(""))).toThrow("empty");
  expect(() =>
    aggregateCoverage(parseCoverage(coverageRecord("src/services/a.ts", 10, 10)), [
      "src/services/a.ts",
      "src/components/missing.tsx",
    ]),
  ).toThrow("source files absent from coverage");
  expect(() => parseCoverage("SF:src/components/A.tsx\nLF:10\nend_of_record\n")).toThrow(
    "incomplete coverage record",
  );
});
