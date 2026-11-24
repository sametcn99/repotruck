// [E72] Sensitivity checks for the approved scenario catalogue.
// Small, targeted behavioral mutants in disposable copies. Never edit the checkout.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, ".."),
  evidence =
    process.env.REPOTRUCK_MUTATION_RESULTS_DIR ??
    mkdtempSync(path.join(tmpdir(), "repotruck-mutants-"));
mkdirSync(evidence, { recursive: true });
const mutants = [
  {
    id: "outside-symlink",
    file: "src/services/workspacePaths.ts",
    from: "const base = path.resolve(root);",
    to: "return path.join(root, ...segments); const base = path.resolve(root);",
    test: "E01",
  },
  {
    id: "trash-age-forwarding",
    file: "src/components/store/StoreDataPages.ts",
    from: 'this.runWorkspaceMaintenance("trash-empty", { olderThanDays })',
    to: 'this.runWorkspaceMaintenance("trash-empty")',
    test: "E02",
  },
  {
    id: "restore-result-phase",
    file: "src/components/store/StoreDataPages.ts",
    from: 'result.ok ? "DONE" : "FAILED"',
    to: '"DONE"',
    test: "E05",
  },
  {
    id: "case-sensitive-glob",
    file: "src/services/filters.ts",
    from: 'new RegExp(re, "i")',
    to: "new RegExp(re)",
    test: "E08",
  },
  {
    id: "snapshot-collision",
    file: "src/services/backups.ts",
    from: "await readFile(target);",
    to: "await readFile(target); break;",
    test: "E10",
  },
  {
    id: "chunk-decoder",
    file: "src/services/runner.ts",
    from: 'child.stdout?.setEncoding("utf8");',
    to: "",
    test: "E11",
  },

  {
    id: "sdk-header-shape",
    file: "src/services/rateLimit.ts",
    from: "record.response?.headers ?? record.headers",
    to: "record.headers",
    test: "E04",
  },
  {
    id: "stale-request-owner",
    file: "src/components/store/operations.ts",
    from: "this.requests.get(key) === request && this.currentRoot() === request.root",
    to: "true",
    test: "E07",
  },
  {
    id: "missing-coverage-input",
    file: "scripts/lib/coverage.ts",
    from: 'if (records.length === 0) throw new Error("coverage report is empty");',
    to: "if (records.length === 0) return [];",
    test: "E09",
  },
  {
    id: "unchecked-about-content",
    file: "src/services/about.ts",
    from: "https://github.com/sametcn99/repotruck",
    to: "https://example.invalid",
    test: "E73",
  },
  {
    id: "same-metadata-cache",
    file: "src/services/codeSearch.ts",
    from: "cached.hash === hash",
    to: "true",
    test: "E50",
  },
];
const results: Array<{ id: string; killed: boolean; exitCode: number }> = [];
for (const mutant of mutants) {
  const directory = mkdtempSync(path.join(tmpdir(), "repotruck-mutation-"));
  try {
    for (const name of [
      "src",
      "tests",
      "scripts",
      "package.json",
      "tsconfig.json",
      "bunfig.toml",
      "vendor",
    ])
      cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
    symlinkSync(
      path.join(root, "node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const file = path.join(directory, mutant.file),
      original = readFileSync(file, "utf8");
    if (!original.includes(mutant.from)) throw new Error(`${mutant.id}: mutation target drifted`);
    writeFileSync(file, original.replace(mutant.from, mutant.to));
    const fileName =
      mutant.test === "E50"
        ? "tests/hardening-search.test.ts"
        : "tests/hardening-regressions.test.ts";
    const result = Bun.spawnSync([process.execPath, "test", fileName, "-t", mutant.test], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    });
    const log = result.stdout.toString() + result.stderr.toString();
    writeFileSync(path.join(evidence, `${mutant.id}.log`), log);
    const killed =
      result.exitCode !== 0 && /\(fail\)/.test(log) && !log.includes("Cannot find module");
    results.push({ id: mutant.id, killed, exitCode: result.exitCode });
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
writeFileSync(path.join(evidence, "summary.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(
  JSON.stringify({
    killed: results.filter((result) => result.killed).length,
    total: results.length,
    evidence,
  }),
);
if (results.some((result) => !result.killed)) process.exitCode = 1;
