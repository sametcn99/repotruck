/**
 * Docs drift check: the CLI command tree (src/cli.ts) is the single source of
 * truth for the command surface. This script imports the commander program
 * without running it and verifies that the hand-curated documentation keeps
 * up with it:
 *
 *   website/src/components/CommandReference.ts — every top-level CLI
 *      command is documented, every documented command exists, and every
 *      non-help flag on the CLI (including flags inherited by parent-command
 *      docs from their subcommands) is documented by long name. Flags listed
 *      in GLOBAL_FLAGS are shared and not required per command.
 *
 * Run with `bun run docs:check`; CI fails when documentation drifts.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { program } from "commander";

process.env.REPOTRUCK_NO_PARSE = "1";
await import("../src/cli.ts");

interface CliCommandInfo {
  name: string;
  flags: Set<string>;
  /** Long flags accepted anywhere under this command (own + subcommands). */
  familyFlags: Set<string>;
  subcommands: string[];
}

const IGNORED_FLAGS = new Set(["--help", "--version"]);

function longFlagsOf(cmd: { options: { long?: string }[] }): string[] {
  return cmd.options
    .map((opt) => opt.long)
    .filter((flag): flag is string => flag !== undefined && !IGNORED_FLAGS.has(flag))
    .map((flag) => flag.toLowerCase());
}

function collectCommands(): CliCommandInfo[] {
  return program.commands
    .filter((cmd) => cmd.name() !== "__complete" && cmd.name() !== "help")
    .map((cmd) => {
      const subs = cmd.commands.filter((sub) => sub.name() !== "help");
      const familyFlags = new Set<string>(longFlagsOf(cmd));
      for (const sub of subs) {
        for (const flag of longFlagsOf(sub)) familyFlags.add(flag);
      }
      return {
        name: cmd.name(),
        flags: new Set(longFlagsOf(cmd)),
        familyFlags,
        subcommands: subs.map((sub) => sub.name()),
      };
    });
}

function docLongFlags(flag: string): string[] {
  return [...flag.matchAll(/--[a-z][a-z0-9-]*/gi)].map((match) => match[0]!.toLowerCase());
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const cliCommands = collectCommands();
  const cliNames = new Set(cliCommands.map((cmd) => cmd.name));

  const websitePath = path.join(
    import.meta.dir,
    "..",
    "website",
    "src",
    "components",
    "CommandReference.ts",
  );
  // Import the real data module so renames cannot silently pass.
  const { COMMAND_GROUPS, GLOBAL_FLAGS } = (await import(pathToFileURL(websitePath).href)) as {
    COMMAND_GROUPS: Array<{
      commands: Array<{
        name: string;
        summary: string;
        usage: string;
        examples: readonly string[];
        flags?: readonly { flag: string }[];
      }>;
    }>;
    GLOBAL_FLAGS: readonly { flag: string }[];
  };
  const globalFlags = new Set(GLOBAL_FLAGS.flatMap((entry) => docLongFlags(entry.flag)));

  interface DocEntry {
    name: string;
    flags: Set<string>;
    text: string;
  }
  const documented = new Map<string, DocEntry>();
  for (const group of COMMAND_GROUPS) {
    for (const command of group.commands) {
      documented.set(command.name, {
        name: command.name,
        flags: new Set((command.flags ?? []).flatMap((entry) => docLongFlags(entry.flag))),
        text: JSON.stringify(command),
      });
    }
  }

  for (const cmd of cliCommands) {
    const doc = documented.get(cmd.name);
    if (doc === undefined) {
      problems.push(
        `website: command "repotruck ${cmd.name}" is not documented in CommandReference.ts`,
      );
      continue;
    }
    for (const flag of cmd.flags) {
      const covered = doc.flags.has(flag) || globalFlags.has(flag);
      if (!covered) {
        problems.push(`website: "repotruck ${cmd.name}" is missing flag ${flag}`);
      }
    }
    for (const flag of doc.flags) {
      // Parent-command docs may cover their subcommands' flags.
      if (!cmd.familyFlags.has(flag) && !globalFlags.has(flag)) {
        problems.push(`website: "repotruck ${cmd.name}" documents unknown flag ${flag}`);
      }
    }
    for (const sub of cmd.subcommands) {
      if (!doc.text.includes(sub)) {
        problems.push(`website: "repotruck ${cmd.name}" never mentions its subcommand "${sub}"`);
      }
    }
  }
  for (const name of documented.keys()) {
    if (!cliNames.has(name)) {
      problems.push(`website: CommandReference.ts documents unknown command "repotruck ${name}"`);
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `documentation drifted from the CLI surface:\n${problems.map((p) => `- ${p}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `docs in sync: ${cliCommands.length} commands verified against CommandReference.ts\n`,
  );
}

await main();
