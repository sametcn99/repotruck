import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  escapeArgument,
  escapeCommand,
  isCmdShim,
  quoteForShell,
  ShellQuoteError,
} from "../src/services/shellQuote.ts";

describe("shellQuote unit tests & golden values", () => {
  test("C1: ShellQuoteError is an Error with name and detailed message", () => {
    const err = new ShellQuoteError(
      'Argument at index 2 contains carriage return or newline which cannot be safely escaped for cmd.exe: "foo\\nbar"',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ShellQuoteError");
    expect(err.message).toContain("index 2");
    expect(err.message).toContain('"foo\\nbar"');
  });

  test("C2-C4, m5: Windows rejects \\r, \\n, and \\r\\n in args and command token", () => {
    // Command token rejection
    expect(() => quoteForShell("cmd\r", ["arg"], "win32")).toThrow(ShellQuoteError);
    expect(() => quoteForShell("cmd\n", ["arg"], "win32")).toThrow(ShellQuoteError);
    expect(() => quoteForShell("cmd\r\n", ["arg"], "win32")).toThrow(ShellQuoteError);

    // Arg rejection with actionable message
    expect(() => quoteForShell("cmd", ["safe", "bad\rvalue"], "win32")).toThrowError(
      /Argument at index 1 contains carriage return or newline/,
    );
    expect(() => quoteForShell("cmd", ["bad\nvalue"], "win32")).toThrowError(
      /Argument at index 0 contains carriage return or newline/,
    );
    expect(() => quoteForShell("cmd", ["bad\r\nvalue"], "win32")).toThrow(ShellQuoteError);
  });

  test("C5: POSIX accepts \\r and \\n and quotes them safely", () => {
    expect(quoteForShell("cmd", ["foo\rbar"], "linux")).toBe("cmd 'foo\rbar'");
    expect(quoteForShell("cmd", ["foo\nbar"], "linux")).toBe("cmd 'foo\nbar'");
    expect(quoteForShell("cmd", ["arg\r\n"], "linux")).toBe("cmd 'arg\r\n'");
  });

  test("C6, C7, M4: Exact-string golden values for win32 and cmdShim", () => {
    // 1. empty string
    expect(quoteForShell("cmd", [""], "win32")).toBe('cmd ^"^"');
    // 2. & meta char
    expect(quoteForShell("cmd", ["a&b"], "win32")).toBe('cmd ^"a^&b^"');
    // 3. %VAR%
    expect(quoteForShell("cmd", ["%PATH%"], "win32")).toBe('cmd ^"^%PATH^%^"');
    // 4. trailing backslash
    expect(quoteForShell("cmd", ["a\\"], "win32")).toBe('cmd ^"a\\\\^"');
    // 5. quote inside
    expect(quoteForShell("cmd", ['a"b'], "win32")).toBe('cmd ^"a\\^"b^"');
    // 6. cmdShim double escape
    expect(quoteForShell("cmd", ["a&b"], { platform: "win32", cmdShim: true })).toBe(
      'cmd ^^^"a^^^&b^^^"',
    );
    // 7. !x!
    expect(quoteForShell("cmd", ["!x!"], "win32")).toBe('cmd ^"^!x^!^"');
    // 8. caret
    expect(quoteForShell("cmd", ["^"], "win32")).toBe('cmd ^"^^^"');
    // 9. G1: space is a meta char and gets escaped
    expect(quoteForShell("cmd", ["hello world"], "win32")).toBe('cmd ^"hello^ world^"');
    // 10. parentheses
    expect(quoteForShell("cmd", ["(a)"], "win32")).toBe('cmd ^"^(a^)^"');
    // 11. semicolons and commas
    expect(quoteForShell("cmd", ["a;b,c"], "win32")).toBe('cmd ^"a^;b^,c^"');
    // 12. redirection < >
    expect(quoteForShell("cmd", ["<input>"], "win32")).toBe('cmd ^"^<input^>^"');
    // 13. pipe |
    expect(quoteForShell("cmd", ["|pipe"], "win32")).toBe('cmd ^"^|pipe^"');
    // 14. wildcards * ?
    expect(quoteForShell("cmd", ["*?"], "win32")).toBe('cmd ^"^*^?^"');
    // 15. POSIX cmdShim is a no-op (m6, C9)
    expect(quoteForShell("cmd", ["a&b"], { platform: "linux", cmdShim: true })).toBe("cmd 'a&b'");
    // 16. Command token meta escaping (C8, B3)
    expect(quoteForShell("foo&bar", ["arg"], "win32")).toBe('foo^&bar ^"arg^"');
    expect(escapeCommand("foo&bar")).toBe("foo^&bar");
    // Backslash followed by quote in arg
    expect(escapeArgument('foo\\"bar')).toBe('^"foo\\\\\\^"bar^"');

    // F1 backslash sequence golden assertions (Condition 3):
    expect(quoteForShell("cmd", ["\\\\"], "win32")).toBe('cmd ^"\\\\\\\\^"');
    expect(quoteForShell("cmd", ["a\\\\"], "win32")).toBe('cmd ^"a\\\\\\\\^"');
    expect(quoteForShell("cmd", ["\\\\\\\\"], "win32")).toBe('cmd ^"\\\\\\\\\\\\\\\\^"');
    expect(quoteForShell("cmd", ["C:\\\\dir\\\\\\\\"], "win32")).toBe(
      'cmd ^"C:\\\\dir\\\\\\\\\\\\\\\\^"',
    );
    expect(quoteForShell("cmd", ['a\\\\"b'], "win32")).toBe('cmd ^"a\\\\\\\\\\^"b^"');
  });

  test("C10, C11: backward compatible signatures and options", () => {
    // 3rd arg as string platform
    expect(quoteForShell("echo", ["hello"], "win32")).toBe('echo ^"hello^"');
    expect(quoteForShell("echo", ["hello"], "linux")).toBe("echo hello");
    expect(quoteForShell("echo", ["hello world"], "linux")).toBe("echo 'hello world'");
    expect(quoteForShell("", [], "linux")).toBe("''");

    // 3rd arg as options object
    expect(quoteForShell("echo", ["hello"], { platform: "win32" })).toBe('echo ^"hello^"');
    expect(quoteForShell("echo", ["hello"], { platform: "linux" })).toBe("echo hello");
    expect(quoteForShell("echo", ["a b"], { platform: "win32", cmdShim: false })).toBe(
      'echo ^"a^ b^"',
    );

    // Default platform (process.platform)
    const def = quoteForShell("node", ["test"]);
    expect(typeof def).toBe("string");
    expect(def.length).toBeGreaterThan(0);
  });

  test("isCmdShim detects .cmd and .bat files case-insensitively", () => {
    expect(isCmdShim("npm.cmd")).toBe(true);
    expect(isCmdShim("run.BAT")).toBe(true);
    expect(isCmdShim("C:\\tools\\script.CMD")).toBe(true);
    expect(isCmdShim("node.exe")).toBe(false);
    expect(isCmdShim("bun")).toBe(false);
    expect(isCmdShim("npm")).toBe(false);
  });
});

describe("Round-trip execution tests", () => {
  const isWin = process.platform === "win32";
  const tmpBase = path.join(os.tmpdir(), `rt-shell-quote-${process.pid}-${randomUUID()}`);
  const spacedDir = path.join(tmpBase, "path with spaces");
  const echoScriptPath = path.join(tmpBase, "echo-argv.js");
  const echoSpacedScriptPath = path.join(spacedDir, "echo-argv.js");
  const shimPath = path.join(tmpBase, "test-shim.cmd");
  const spacedShimPath = path.join(spacedDir, "test-shim.cmd");

  beforeAll(async () => {
    await mkdir(tmpBase, { recursive: true });
    await mkdir(spacedDir, { recursive: true });

    // Helper script that outputs process.argv.slice(2) as JSON
    const echoContent = "console.log(JSON.stringify(process.argv.slice(2)));\n";
    await writeFile(echoScriptPath, echoContent, "utf8");
    await writeFile(echoSpacedScriptPath, echoContent, "utf8");

    if (isWin) {
      // Full npm cmd-shim template (g3)
      const shimContent = [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        "  SET PATHEXT=%PATHEXT:;.JS;=;%",
        ")",
        "",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\echo-argv.js" %*',
        "",
      ].join("\r\n");
      await writeFile(shimPath, shimContent, "utf8");
      await writeFile(spacedShimPath, shimContent, "utf8");
    }
  });

  afterAll(async () => {
    try {
      await rm(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on temp dir
    }
  });

  function runInProductionHarness(
    commandLine: string,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(commandLine, {
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ exitCode: code, stdout, stderr }));
    });
  }

  // 18-element challenging matrix + F1 backslash sequence extensions (M1, F1 Condition 2)
  const roundTripMatrix: readonly string[] = [
    "",
    "hello world",
    process.env.PATH ? "%PATH%" : "%SYSTEMROOT%",
    "%RT_UNDEFINED_XYZ%",
    "!x!",
    "^",
    "^^",
    "&",
    "&&",
    "|",
    "<",
    ">",
    "'",
    '"',
    'a"b',
    "a\\",
    "\\\\",
    "a\\\\",
    "\\\\\\\\",
    "C:\\\\dir\\\\\\\\",
    'a\\\\"b',
    "(foo)",
    "[bar]",
    ";",
    ",",
    "*",
    "?",
    "çığşöü_🚀",
    "A".repeat(5000),
    "C:\\Program Files\\Node\\",
  ];

  test.skipIf(!isWin)(
    "C12: Windows direct spawn round-trip preserves all cases through production harness",
    async () => {
      for (const arg of roundTripMatrix) {
        const quoted = quoteForShell("node", [echoScriptPath, arg]);
        const outcome = await runInProductionHarness(quoted);
        expect(outcome.exitCode).toBe(0);
        const parsed = JSON.parse(outcome.stdout.trim());
        expect(parsed).toEqual([arg]);
      }

      // Also verify multiple arguments passed in one invocation
      const multiArgs = [
        "first with spaces",
        "%PATH%",
        "semi;colon",
        "pipe|amp&",
        "!delayed!",
        "emoji_🚀",
        "\\\\",
        'a\\\\"b',
      ];
      const multiQuoted = quoteForShell("node", [echoScriptPath, ...multiArgs]);
      const multiOutcome = await runInProductionHarness(multiQuoted);
      expect(multiOutcome.exitCode).toBe(0);
      const multiParsed = JSON.parse(multiOutcome.stdout.trim());
      expect(multiParsed).toEqual(multiArgs);
    },
    30_000,
  );

  test.skipIf(!isWin)(
    "C13: Windows full npm .cmd shim round-trip preserves all cases with cmdShim: true",
    async () => {
      for (const arg of roundTripMatrix) {
        const quoted = quoteForShell(shimPath, [arg], { cmdShim: true });
        const outcome = await runInProductionHarness(quoted);
        expect(outcome.exitCode).toBe(0);
        const parsed = JSON.parse(outcome.stdout.trim());
        expect(parsed).toEqual([arg]);
      }
    },
    30_000,
  );

  test.skipIf(!isWin)(
    "C14: Spaced directory script and .cmd shim round-trip succeeds",
    async () => {
      // 1. Direct node script in directory with spaces
      const quotedScript = quoteForShell("node", [
        echoSpacedScriptPath,
        "arg with spaces",
        "%PATH%",
        "!x!",
        "\\\\",
        'a\\\\"b',
      ]);
      const outcomeScript = await runInProductionHarness(quotedScript);
      expect(outcomeScript.exitCode).toBe(0);
      expect(JSON.parse(outcomeScript.stdout.trim())).toEqual([
        "arg with spaces",
        "%PATH%",
        "!x!",
        "\\\\",
        'a\\\\"b',
      ]);

      // 2. .cmd shim in directory with spaces
      const quotedShim = quoteForShell(
        spacedShimPath,
        ["spaced arg", "^caret^", "pipe|test", "\\\\", 'a\\\\"b'],
        {
          cmdShim: true,
        },
      );
      const outcomeShim = await runInProductionHarness(quotedShim);
      expect(outcomeShim.exitCode).toBe(0);
      expect(JSON.parse(outcomeShim.stdout.trim())).toEqual([
        "spaced arg",
        "^caret^",
        "pipe|test",
        "\\\\",
        'a\\\\"b',
      ]);
    },
    15_000,
  );

  test.skipIf(isWin)(
    "POSIX round-trip: sh -c preserves arguments including multi-line newlines",
    async () => {
      const posixMatrix = [
        "",
        "hello world",
        "%PATH%",
        "!x!",
        "^",
        "&",
        "|",
        "<",
        ">",
        "'",
        '"',
        'a"b',
        "a\\",
        "\\\\",
        "a\\\\",
        "\\\\\\\\",
        'a\\\\"b',
        "(foo)",
        ";",
        ",",
        "*",
        "?",
        "çığşöü_🚀",
        "A".repeat(5000),
        "multi\nline\nargument\nwith\rnewlines",
      ];
      for (const arg of posixMatrix) {
        const quoted = quoteForShell("node", [echoScriptPath, arg], "linux");
        const outcome = await runInProductionHarness(quoted);
        expect(outcome.exitCode).toBe(0);
        const parsed = JSON.parse(outcome.stdout.trim());
        expect(parsed).toEqual([arg]);
      }
    },
  );
});
