import { readdirSync } from "node:fs";
import path from "node:path";

export interface CoverageRecord {
  file: string;
  LF: number;
  LH: number;
  FNF: number;
  FNH: number;
}
const COUNTERS = ["LF", "LH", "FNF", "FNH"] as const;

export function parseCoverage(text: string): CoverageRecord[] {
  const records: CoverageRecord[] = [];
  const files = new Set<string>();
  let current: Partial<CoverageRecord> | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("SF:")) {
      if (current) throw new Error("unterminated coverage record");
      const file = line
        .slice(3)
        .replace(/\\/g, "/")
        .replace(/^.*?\/src\//, "src/");
      if (!file) throw new Error("coverage file is empty");
      current = { file };
    } else if (line === "end_of_record") {
      if (!current || COUNTERS.some((key) => current?.[key] === undefined))
        throw new Error("incomplete coverage record");
      const record = current as CoverageRecord;
      if (record.LH > record.LF || record.FNH > record.FNF)
        throw new Error("coverage hits exceed totals");
      if (files.has(record.file)) throw new Error(`duplicate coverage file: ${record.file}`);
      files.add(record.file);
      records.push(record);
      current = null;
    } else {
      for (const key of COUNTERS) {
        if (!line.startsWith(`${key}:`)) continue;
        const raw = line.slice(key.length + 1);
        if (
          !current ||
          current[key] !== undefined ||
          !/^\d+$/.test(raw) ||
          !Number.isSafeInteger(Number(raw))
        ) {
          throw new Error(`invalid coverage counter: ${line}`);
        }
        current[key] = Number(raw);
      }
    }
  }
  if (current) throw new Error("unterminated coverage record");
  if (records.length === 0) throw new Error("coverage report is empty");
  return records;
}

export function sourceInventory(root: string): string[] {
  return readdirSync(path.join(root, "src"), { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => `src/${file.replace(/\\/g, "/")}`)
    .sort();
}

export function aggregateCoverage(records: CoverageRecord[], expectedFiles?: readonly string[]) {
  const sources = records.filter((record) => record.file.startsWith("src/"));
  if (sources.length === 0) throw new Error("coverage report contains no source files");
  if (expectedFiles) {
    const observed = new Set(sources.map((record) => record.file));
    const missing = expectedFiles.filter((file) => file !== "src/index.tsx" && !observed.has(file));
    if (missing.length) throw new Error(`source files absent from coverage: ${missing.join(", ")}`);
  }
  const included = sources.filter(
    (record) => record.file !== "src/cli.ts" && !record.file.startsWith("src/cli/"),
  );
  const summarize = (items: CoverageRecord[]) => {
    const total = items.reduce(
      (sum, row) => ({
        LF: sum.LF + row.LF,
        LH: sum.LH + row.LH,
        FNF: sum.FNF + row.FNF,
        FNH: sum.FNH + row.FNH,
      }),
      { LF: 0, LH: 0, FNF: 0, FNH: 0 },
    );
    if (total.LF === 0 || total.FNF === 0) throw new Error("coverage has an empty denominator");
    return {
      ...total,
      lines: (100 * total.LH) / total.LF,
      functions: (100 * total.FNH) / total.FNF,
    };
  };
  const tui = sources.filter((record) => record.file.startsWith("src/components/"));
  return {
    aggregate: summarize(included),
    cli: sources.some((r) => !included.includes(r))
      ? summarize(sources.filter((r) => !included.includes(r)))
      : null,
    tui: summarize(tui),
    files: sources.length,
  };
}

export function assertCoveragePolicy(report: ReturnType<typeof aggregateCoverage>): void {
  if (report.aggregate.lines < 85 || report.aggregate.functions < 75)
    throw new Error("aggregate coverage below threshold");
  if (report.tui.functions < 80) throw new Error("TUI function coverage below 80%");
}
