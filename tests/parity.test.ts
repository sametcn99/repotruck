import { describe, expect, test } from "bun:test";
import { program } from "../src/cli/index.ts";
import { REGISTRY, REGISTRY_BY_PATH, registryFlagCount } from "../src/commands/registry.ts";

/**
 * CLI ↔ registry parity. Warning mode while the TUI surfaces land: every
 * gap is printed so drift is visible in CI logs, and the test only fails
 * on structural problems (duplicate ids/paths). t19 flips the gaps to hard
 * failures.
 */

interface CommanderOption {
  long?: string | (() => string | undefined);
  short?: string | (() => string | undefined);
}

function longOf(option: CommanderOption): string | null {
  const long = typeof option.long === "function" ? option.long() : option.long;
  if (long === undefined) return null;
  return long.split(" ")[0] ?? null;
}

interface CommanderCommand {
  name: string | (() => string);
  commands: CommanderCommand[] | (() => CommanderCommand[]);
  options: CommanderOption[] | (() => CommanderOption[]);
  hidden?: boolean | (() => boolean | undefined);
  _hidden?: boolean;
}

function listOf<T>(value: T[] | (() => T[])): T[] {
  return typeof value === "function" ? value() : value;
}

function nameOf(command: CommanderCommand): string {
  return typeof command.name === "function" ? command.name() : command.name;
}

function isHidden(command: CommanderCommand): boolean {
  if (typeof command.hidden === "function") return command.hidden() === true;
  if (typeof command.hidden === "boolean") return command.hidden;
  return command._hidden === true;
}

function walkCommands(
  command: CommanderCommand,
  prefix: string,
  out: { path: string; flags: string[] }[],
): void {
  for (const sub of listOf(command.commands)) {
    if (isHidden(sub)) continue;
    const path = prefix.length === 0 ? nameOf(sub) : `${prefix} ${nameOf(sub)}`;
    const flags = listOf(sub.options)
      .map(longOf)
      .filter((flag): flag is string => flag !== null && flag !== "--help" && flag !== "-h");
    out.push({ path, flags });
    walkCommands(sub, path, out);
  }
}

describe("registry structure", () => {
  test("ids and paths are unique", () => {
    const ids = REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = REGISTRY.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("flag inventory is substantial (full CLI surface)", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(34);
    expect(registryFlagCount()).toBeGreaterThanOrEqual(100);
  });
});

describe("CLI ↔ registry parity (warning mode)", () => {
  test("every CLI command and flag has a registry entry", () => {
    process.env.REPOTRUCK_NO_PARSE = "1";
    const cliCommands: { path: string; flags: string[] }[] = [];
    walkCommands(program as unknown as CommanderCommand, "", cliCommands);
    // Program-level options belong to the __globals__ entry.
    const cliGlobals = listOf((program as unknown as CommanderCommand).options)
      .map(longOf)
      .filter((flag): flag is string => flag !== null && !flag.startsWith("-h"));

    expect(cliCommands.length).toBeGreaterThanOrEqual(30);

    const gaps: string[] = [];
    const globals = REGISTRY_BY_PATH.get("(global flags)");
    // --dir is the workspace-root override: the TUI covers it session-wide
    // via the workspace switcher (w) and Settings, not per form. --version
    // is program meta like --help.
    const globalFallback = new Set(["--dir"]);
    const skipFlags = new Set(["--version", "-V"]);
    for (const cli of cliCommands) {
      const spec = REGISTRY_BY_PATH.get(cli.path);
      if (spec === undefined) {
        gaps.push(`command missing from registry: ${cli.path}`);
        continue;
      }
      for (const flag of cli.flags) {
        if (skipFlags.has(flag)) continue;
        const covered =
          spec.flags.some((entry) => entry.flag === flag) ||
          (globalFallback.has(flag) &&
            Boolean(globals?.flags.some((entry) => entry.flag === flag)));
        if (!covered) {
          gaps.push(`flag missing from registry: ${cli.path} ${flag}`);
        }
      }
    }
    if (globals !== undefined) {
      for (const flag of cliGlobals) {
        if (skipFlags.has(flag)) continue;
        if (!globals.flags.some((entry) => entry.flag === flag)) {
          gaps.push(`global flag missing from registry: ${flag}`);
        }
      }
    }

    if (gaps.length > 0) {
      // t19: parity is a hard guarantee — a CLI command or flag without a
      // registry entry (and therefore without a TUI surface binding) fails
      // CI instead of warning.
      throw new Error(
        `[parity] ${gaps.length} gap(s) between CLI and registry:\n  ${gaps.join("\n  ")}`,
      );
    }
    // Structural sanity: every CLI flag must be covered somewhere.
    for (const cli of cliCommands) {
      const spec = REGISTRY_BY_PATH.get(cli.path);
      if (spec === undefined) continue;
      const uncovered = cli.flags.filter(
        (flag) =>
          !skipFlags.has(flag) &&
          !spec.flags.some((entry) => entry.flag === flag) &&
          !globalFallback.has(flag),
      );
      if (uncovered.length > 0) {
        throw new Error(`registry entry for ${cli.path} misses flags: ${uncovered.join(" ")}`);
      }
    }
  });

  test("registry does not drift ahead of the CLI", () => {
    const cliCommands: { path: string; flags: string[] }[] = [];
    walkCommands(program as unknown as CommanderCommand, "", cliCommands);
    const cliPaths = new Set(cliCommands.map((cli) => cli.path));
    for (const spec of REGISTRY) {
      if (spec.id === "__globals__") continue;
      if (!cliPaths.has(spec.path)) {
        throw new Error(`registry entry "${spec.path}" does not exist in the CLI tree`);
      }
    }
  });
});

describe("palette registry bridge", () => {
  test("registry items merge into the palette and dispatch cmd: ids", async () => {
    const { buildRegistryPaletteItems } = await import("../src/components/store/omnibar.ts");
    const uiIds = new Set(["sync", "clone", "create", "scan", "theme"]);
    const items = buildRegistryPaletteItems(uiIds);
    const ids = items.map((item) => item.id);
    // root commands with UI twins are deduplicated, subcommands kept
    expect(ids).not.toContain("cmd:sync");
    expect(ids).not.toContain("cmd:clone");
    expect(ids).toContain("cmd:sync.resolve");
    expect(ids).toContain("cmd:status");
    expect(ids).toContain("cmd:trash.empty");
    expect(ids).toContain("cmd:config");
  });
});

describe("registry dispatch", () => {
  test("cmd: ids navigate views and log planned tickets", () => {
    const { Store } =
      require("../src/components/store.ts") as typeof import("../src/components/store.ts");
    const { executeRegistryCommand } =
      require("../src/components/store/modalWorkflows.ts") as typeof import("../src/components/store/modalWorkflows.ts");
    const store = new Store("/tmp/parity-dispatch-root");
    const before = store.getSnapshot().statuses.length;
    // flag-bearing commands open the command form first (t04)
    executeRegistryCommand(store, "status");
    expect(store.getSnapshot().modal?.type).toBe("commandForm");
    store.closeModal();
    // no-flag view commands navigate directly
    executeRegistryCommand(store, "trash");
    expect(store.getSnapshot().view).toBe("trash");
    executeRegistryCommand(store, "auth.logout");
    expect(store.getSnapshot().statuses.length).toBe(before + 1);
    expect(store.getSnapshot().statuses.at(-1)?.message).toContain("t10");
    executeRegistryCommand(store, "__nonexistent__");
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("FAILED");
  });
});
