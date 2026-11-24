import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  buildCodeIndex,
  codeIndexPath,
  MAX_INDEXED_FILE_BYTES,
  searchCode,
  walkSourceFiles,
} from "../src/services/codeSearch.ts";
import { workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
const options = (f: ReturnType<typeof fixture>) => ({
  root: f.root,
  config: f.config,
  offline: true,
});

describe("search freshness, parsing and resource bounds", () => {
  test("[E50] content replacement with identical size and mtime cannot reuse stale symbols", async () => {
    const f = fixture(),
      file = path.join(f.repoDir, "main.ts");
    writeFileSync(file, "export function before() {}\n");
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(file, fixed, fixed);
    const first = await searchCode({ ...options(f), pattern: "before" });
    expect(first.matches.length).toBe(1);
    const old = statSync(file);
    writeFileSync(file, "export function afterr() {}\n");
    utimesSync(file, old.atime, old.mtime);
    expect(statSync(file).mtimeMs).toBe(old.mtimeMs);
    const next = await searchCode({ ...options(f), pattern: "afterr" });
    expect(next.matches[0]?.name).toBe("afterr");
    expect(next.index.filesReused).toBe(0);
    expect((await searchCode({ ...options(f), pattern: "before" })).matches).toEqual([]);
  });

  test("[E51] concurrent rebuilds serialize and leave a valid, reusable complete index", async () => {
    const f = fixture();
    for (let i = 0; i < 8; i++)
      writeFileSync(path.join(f.repoDir, `${i}.ts`), `export const symbol${i} = ${i};`);
    const results = await Promise.all(Array.from({ length: 4 }, () => buildCodeIndex(options(f))));
    for (const result of results) expect(result.index.files.length).toBe(8);
    expect(JSON.parse(readFileSync(codeIndexPath(f.root), "utf8")).files.length).toBe(8);
    expect((await buildCodeIndex(options(f))).stats.filesReused).toBe(8);
  });

  test("[E51] two processes preserve both repository/language symbol sets and leave no temporary index", async () => {
    const f = fixture();
    f.config.repos.push({
      ...f.config.repos[0]!,
      owner: "other",
      name: "rust",
      relativePath: "other/source/rust",
    });
    mkdirSync(path.join(f.root, "other/source/rust"), { recursive: true });
    writeFileSync(path.join(f.repoDir, "a.ts"), "export function alpha() {}");
    writeFileSync(path.join(f.root, "other/source/rust/b.rs"), "pub fn beta() {}");
    const code = `import {buildCodeIndex} from ${JSON.stringify(path.resolve("src/services/codeSearch.ts"))}; const result=await buildCodeIndex(JSON.parse(process.env.INDEX_OPTIONS)); console.log(result.index.files.length);`;
    const children = [0, 1].map(() =>
      Bun.spawn([process.execPath, "-e", code], {
        env: { ...process.env, ...f.env, INDEX_OPTIONS: JSON.stringify(options(f)) },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    for (const child of children) {
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(stderr).toBe("");
    }
    const indexed = JSON.parse(readFileSync(codeIndexPath(f.root), "utf8"));
    expect(
      indexed.files
        .flatMap((file: { symbols: Array<{ name: string }> }) =>
          file.symbols.map((symbol) => symbol.name),
        )
        .sort(),
    ).toEqual(["alpha", "beta"]);
    await expect(
      (await import("node:fs/promises"))
        .readdir(path.join(f.root, ".repotruck"))
        .then((files) => files.filter((name) => name.includes(".tmp-"))),
    ).resolves.toEqual([]);
  });

  test("[E52] six real vendored grammars produce meaningful names, kinds and export visibility", async () => {
    const f = fixture();
    const corpus = {
      "main.ts": "export interface Contract {}\nexport function typed() {}\nclass Hidden {}",
      "view.tsx": "export function Widget() { return <div/> }",
      "main.js": "export function script() {}",
      "main.py":
        "class PythonClass:\n  pass\ndef python_function():\n  return 1\ndef _private():\n  pass\n",
      "main.go": "package main\ntype GoType struct {}\nfunc Exported() {}\nfunc hidden() {}\n",
      "main.rs": "pub struct RustType {}\npub fn rust_function() {}\nfn internal() {}",
    };
    for (const [name, source] of Object.entries(corpus))
      writeFileSync(path.join(f.repoDir, name), source);
    const built = await buildCodeIndex(options(f));
    expect(built.index.grammars).toEqual(["go", "js", "python", "rust", "ts", "tsx"]);
    const symbols = built.index.files.flatMap((file) => file.symbols);
    for (const name of [
      "Contract",
      "typed",
      "Widget",
      "script",
      "PythonClass",
      "python_function",
      "GoType",
      "Exported",
      "RustType",
      "rust_function",
    ])
      expect(symbols.find((symbol) => symbol.name === name)?.exported).toBe(true);
    for (const name of ["Hidden", "_private", "hidden", "internal"])
      expect(symbols.find((symbol) => symbol.name === name)?.exported).toBe(false);
    expect(symbols.find((symbol) => symbol.name === "GoType")?.kind).toBe("type");
    expect(symbols.find((symbol) => symbol.name === "PythonClass")?.kind).toBe("class");
  });

  test("[E53] malformed syntax is recoverable while binary and invalid UTF-8 are excluded", async () => {
    const f = fixture();
    writeFileSync(
      path.join(f.repoDir, "bom.ts"),
      "\ufeffexport function unicode() {\r\n return 'ş🙂';\r\n}\r\n",
    );
    writeFileSync(
      path.join(f.repoDir, "broken.ts"),
      "export function recoverable() {}\nconst broken = (",
    );
    writeFileSync(path.join(f.repoDir, "binary.ts"), Buffer.from([0, 255, 100]));
    writeFileSync(path.join(f.repoDir, "invalid.ts"), Buffer.from([255, 254, 100]));
    const result = await buildCodeIndex(options(f));
    expect(result.index.files.map((file) => path.basename(file.path)).sort()).toEqual([
      "bom.ts",
      "broken.ts",
    ]);
    expect(
      result.index.files.flatMap((file) => file.symbols.map((symbol) => symbol.name)),
    ).toContain("recoverable");
    expect((await searchCode({ ...options(f), text: true, pattern: "ş🙂" })).matches.length).toBe(
      1,
    );
  });

  test("[E54] exactly 1 MiB is searchable, larger files skip, invalid numeric limits reject", async () => {
    const f = fixture();
    for (const delta of [-1, 0, 1])
      writeFileSync(
        path.join(f.repoDir, `${delta}.txt`),
        "needle".padEnd(MAX_INDEXED_FILE_BYTES + delta, " "),
      );
    const result = await searchCode({ ...options(f), text: true, pattern: "needle" });
    expect(result.matches.length).toBe(2);
    expect(result.index.filesSkippedLarge).toBe(1);
    for (const limit of [0, -1, NaN, Infinity, 0.5])
      await expect(
        searchCode({ ...options(f), text: true, pattern: "needle", limit }),
      ).rejects.toThrow("positive integer");
  });

  test("[E55] Git includes tracked ignored files; fallback applies nested rules and negations", async () => {
    const f = fixture();
    const git = simpleGit(f.repoDir);
    await git.init();
    mkdirSync(path.join(f.repoDir, "src"));
    writeFileSync(path.join(f.repoDir, ".gitignore"), "*.log\n");
    writeFileSync(path.join(f.repoDir, "src/.gitignore"), "*.tmp\n!keep.tmp\n");
    for (const name of [
      "src/drop.tmp",
      "src/keep.tmp",
      "tracked.log",
      "ignored.log",
      "src/main.ts",
    ])
      writeFileSync(path.join(f.repoDir, name), "data");
    await git.add(["-f", "tracked.log"]);
    const tracked = (await walkSourceFiles(f.repoDir)).map((file) => file.relPath);
    expect(tracked).toContain("tracked.log");
    expect(tracked).not.toContain("ignored.log");
    expect(tracked).not.toContain("src/drop.tmp");
    expect(tracked).toContain("src/keep.tmp");
    const fallback = (await walkSourceFiles(f.repoDir, { useGit: false })).map(
      (file) => file.relPath,
    );
    expect(fallback).not.toContain("src/drop.tmp");
    expect(fallback).toContain("src/keep.tmp");
    expect(fallback).not.toContain("tracked.log");
  });

  test("[E56] tracked symlink and fallback never read source outside the repository", async () => {
    const f = fixture();
    const outside = path.join(f.base, "outside.ts");
    writeFileSync(outside, "export const externalSecret = 1;");
    symlinkSync(
      outside,
      path.join(f.repoDir, "external.ts"),
      process.platform === "win32" ? "file" : undefined,
    );
    await simpleGit(f.repoDir).init();
    await simpleGit(f.repoDir).add("external.ts");
    for (const useGit of [true, false])
      expect(
        (await walkSourceFiles(f.repoDir, { useGit })).some(
          (file) => file.relPath === "external.ts",
        ),
      ).toBe(false);
    expect(
      (await searchCode({ ...options(f), text: true, pattern: "externalSecret" })).matches,
    ).toEqual([]);
  });

  test("[E57] catastrophic regex times out while the main event loop remains responsive", async () => {
    const f = fixture();
    writeFileSync(path.join(f.repoDir, "attack.txt"), `${"a".repeat(100000)}!`);
    let heartbeat = false;
    const timer = setTimeout(() => {
      heartbeat = true;
    }, 20);
    const started = Date.now();
    try {
      const result = await searchCode({
        ...options(f),
        text: true,
        regex: true,
        pattern: "(a+)+$",
      }).catch((error) => {
        expect(error.message).toContain("execution limit");
        return null;
      });
      if (result)
        expect(result.matches.some((match) => match.path.endsWith("attack.txt"))).toBe(false);
      expect(heartbeat).toBe(true);
      expect(Date.now() - started).toBeLessThan(2500);
    } finally {
      clearTimeout(timer);
    }
    await expect(
      searchCode({ ...options(f), text: true, regex: true, pattern: "[" }),
    ).rejects.toThrow("invalid regex");
    expect(
      (await searchCode({ ...options(f), text: true, regex: true, pattern: "a+!" })).matches.length,
    ).toBe(1);
  });
});
