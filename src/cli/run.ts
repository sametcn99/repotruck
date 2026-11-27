import { detectTuiRuntimeError } from "../cliSupport.ts";
import { formatAbout } from "../services/about.ts";
import { firstErrorLine } from "../services/cloner.ts";
import { program } from "./index.ts";
import { CliExit } from "./shared.ts";

export async function runCli(loadTui: () => Promise<unknown>): Promise<void> {
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
    try {
      await loadTui();
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
}
