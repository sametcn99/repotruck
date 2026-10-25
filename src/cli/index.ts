import { program } from "commander";
import { readVersion } from "../services/version.ts";
import { register as registerAlias } from "./commands/alias.ts";
import { register as registerAuth } from "./commands/auth.ts";
import { register as registerBackup } from "./commands/backup.ts";
import { register as registerClone } from "./commands/clone.ts";
import { register as registerCompletions } from "./commands/completions.ts";
import { register as registerConfig } from "./commands/config.ts";
import { register as registerCreate } from "./commands/create.ts";
import { register as registerDoctor } from "./commands/doctor.ts";
import { register as registerInstructions } from "./commands/instructions.ts";
import { register as registerLifecycle } from "./commands/lifecycle.ts";
import { register as registerMcp } from "./commands/mcp.ts";
import { register as registerOpen } from "./commands/open.ts";
import { register as registerPreset } from "./commands/preset.ts";
import { register as registerReorganize } from "./commands/reorganize.ts";
import { register as registerRoot } from "./commands/root.ts";
import { register as registerRun } from "./commands/run.ts";
import { register as registerSearchCode } from "./commands/searchCode.ts";
import { register as registerStats } from "./commands/stats.ts";
import { register as registerStatus } from "./commands/status.ts";
import { register as registerSync } from "./commands/sync.ts";
import { register as registerUpdate } from "./commands/update.ts";
import { register as registerWorkspaces } from "./commands/workspaces.ts";
import { createCliContext } from "./shared.ts";

const ctx = createCliContext();

program
  .name("repotruck")
  .description("Clone and mirror your GitHub repositories into organized local directory layouts.")
  .version(await readVersion())
  .option("-c, --concurrency <number>", "Maximum concurrent git operations (default 3)")
  .option("--verbose", "Show verbose diagnostic warnings and command outputs")
  .option("--no-color", "Disable colors");

program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts<{ concurrency?: string; verbose?: boolean; noColor?: boolean }>();
  if (opts.verbose || process.env.REPOTRUCK_VERBOSE === "1") {
    process.env.REPOTRUCK_VERBOSE = "1";
  }
  if (opts.noColor) {
    process.env.NO_COLOR = "1";
  }
});

registerClone(program, ctx);
registerCreate(program, ctx);
registerSync(program, ctx);
registerReorganize(program, ctx);
registerLifecycle(program, ctx);
registerStatus(program, ctx);
registerWorkspaces(program, ctx);
registerConfig(program, ctx);
registerUpdate(program, ctx);
registerRoot(program, ctx);
registerOpen(program, ctx);
registerAlias(program, ctx);
registerAuth(program, ctx);
registerDoctor(program, ctx);
registerStats(program, ctx);
registerCompletions(program, ctx);
registerSearchCode(program, ctx);
registerRun(program, ctx);
registerPreset(program, ctx);
registerBackup(program, ctx);
registerInstructions(program, ctx);
registerMcp(program, ctx);

export { program };
