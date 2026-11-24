import type { Command } from "commander";
import { formatAbout } from "../../services/about.ts";

export function register(program: Command): void {
  program
    .command("about")
    .description("Show a short description and the GitHub project link.")
    .action(() => {
      process.stdout.write(formatAbout());
    });
  program.option("--about", "Show a short description and the GitHub project link");
}
