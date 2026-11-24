// CLI entry point. The command tree lives in ./cli/index.ts; this file keeps
// the default (TUI) action and the parse guard so import.meta.url-based TUI
// resolution and REPOTRUCK_NO_PARSE introspection keep working unchanged.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { program } from "./cli/index.ts";
import { CliExit } from "./cli/shared.ts";
import { detectTuiRuntimeError } from "./cliSupport.ts";
import { formatAbout } from "./services/about.ts";
import { firstErrorLine } from "./services/cloner.ts";

program.action(async () => {
  if (program.opts<{ about?: boolean }>().about) {
    process.stdout.write(formatAbout());
    return;
  }
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(
      "the interactive interface requires a TTY; run repotruck inside an interactive terminal, or use a subcommand such as sync, clone, move, reorganize, create, or workspaces\n",
    );
    process.exitCode = 1;
    return;
  }
  const runtimeProblem = detectTuiRuntimeError();
  if (runtimeProblem !== null) {
    process.stderr.write(
      `${runtimeProblem}\nThe headless subcommands still work: repotruck sync, status, clone, move, reorganize, create, workspaces, or run repotruck --help\n`,
    );
    process.exitCode = 1;
    return;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  let tuiEntry: string | null = null;
  for (const candidate of ["index.tsx", "index.js"]) {
    const candidatePath = path.join(here, candidate);
    if (existsSync(candidatePath)) {
      tuiEntry = candidatePath;
      break;
    }
  }
  if (tuiEntry === null) {
    process.stderr.write(
      "the interactive interface is not available: the TUI module is missing. Build first: bun install && bun run build\nuse the headless subcommands instead (sync, clone, move, reorganize, create, workspaces)\n",
    );
    process.exitCode = 1;
    return;
  }
  try {
    await import(pathToFileURL(tuiEntry).href);
  } catch (error) {
    process.stderr.write(
      `the interactive interface is not available: ${firstErrorLine(error)}\nuse the headless subcommands instead (sync, clone, move, reorganize, create, workspaces)\n`,
    );
    process.exitCode = 1;
  }
});

// Docs tooling imports this module to introspect the command tree without
// running the CLI; REPOTRUCK_NO_PARSE skips the parse step for that case.
if (process.env.REPOTRUCK_NO_PARSE !== "1") {
  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof CliExit) {
      process.exitCode = error.code;
    } else {
      throw error;
    }
  }
  // Let stdio drain naturally. Long-lived MCP/watch commands retain their own
  // handles and must never be terminated by a command-wide exit timer.
}
