import { describe, expect, test } from "bun:test";
import {
  buildBashCompletions,
  buildCompletions,
  buildFishCompletions,
  buildPowerShellCompletions,
  buildZshCompletions,
  type CompletionCommand,
  isSupportedShell,
} from "../src/services/completions.ts";

describe("shell completions generator (CO1-CO4, T3'')", () => {
  const sampleCommands: CompletionCommand[] = [
    {
      name: "sync",
      description: "Bulk clone and update",
      options: [
        { flags: "-s, --scope <scope>", long: "--scope", short: "-s", description: "sync scope" },
        { flags: "--json", long: "--json", description: "output as JSON" },
      ],
    },
    {
      name: "auth",
      description: "Manage GitHub auth",
      options: [{ flags: "--base-url <url>", long: "--base-url", description: "GHE URL" }],
    },
  ];

  test("isSupportedShell validates supported shells", () => {
    expect(isSupportedShell("bash")).toBe(true);
    expect(isSupportedShell("zsh")).toBe(true);
    expect(isSupportedShell("fish")).toBe(true);
    expect(isSupportedShell("powershell")).toBe(true);
    expect(isSupportedShell("csh")).toBe(false);
  });

  test("buildBashCompletions includes commands, flags, and tail comment", () => {
    const script = buildBashCompletions(sampleCommands);
    expect(script).toContain('local commands="sync auth"');
    expect(script).toContain("--scope");
    expect(script).toContain("--json");
    expect(script).toContain("complete -F _repotruck repotruck");
    expect(script.trimEnd().endsWith("# source this in ~/.bashrc")).toBe(true);
  });

  test("buildZshCompletions includes subcommands, options, and tail comment", () => {
    const script = buildZshCompletions(sampleCommands);
    expect(script).toContain("#compdef repotruck");
    expect(script).toContain("'sync:Bulk clone and update'");
    expect(script).toContain("'--scope[sync scope]:value:(user all org:)'");
    expect(script.trimEnd().endsWith("# source this in ~/.zshrc (or drop into a fpath dir)")).toBe(
      true,
    );
  });

  test("buildFishCompletions includes subcommands, options, and tail comment", () => {
    const script = buildFishCompletions(sampleCommands);
    expect(script).toContain("# Fish completions for repotruck");
    expect(script).toContain('complete -c repotruck -n "__fish_use_subcommand" -a "sync"');
    expect(script).toContain("__fish_seen_subcommand_from sync");
    expect(script.trimEnd().endsWith("# save as ~/.config/fish/completions/repotruck.fish")).toBe(
      true,
    );
  });

  test("buildCompletions delegates correctly and rejects unsupported shells", () => {
    expect(buildCompletions("bash", sampleCommands)).toContain("# source this in ~/.bashrc");
    expect(buildCompletions("zsh", sampleCommands)).toContain("# source this in ~/.zshrc");
    expect(buildCompletions("fish", sampleCommands)).toContain(
      "# save as ~/.config/fish/completions/repotruck.fish",
    );
    expect(buildCompletions("powershell", sampleCommands)).toContain(
      "Register-ArgumentCompleter -CommandName 'repotruck'",
    );
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    expect(() => buildCompletions("csh" as any, sampleCommands)).toThrow("unsupported shell");
  });

  test("nested subcommands and dynamic flag values are completed", () => {
    const withSubs: CompletionCommand[] = [
      {
        name: "reorganize",
        options: [
          { flags: "-p, --preset <id>", long: "--preset", short: "-p", description: "preset" },
        ],
        subcommands: [],
      },
      {
        name: "alias",
        description: "aliases",
        options: [],
        subcommands: [
          { name: "set", description: "set one", options: [] },
          { name: "remove", description: "remove one", options: [] },
        ],
      },
    ];
    const bash = buildBashCompletions(withSubs);
    expect(bash).toContain('compgen -W "set remove"');
    expect(bash).toContain("$(repotruck __complete presets 2>/dev/null)");
    expect(bash).toContain('compgen -W "user all org:"');
    const zsh = buildZshCompletions(withSubs);
    expect(zsh).toContain("(presets)");
    expect(zsh).toContain("set:set one");
    const pwsh = buildPowerShellCompletions(withSubs);
    expect(pwsh).toContain("'alias' = @('set', 'remove')");
    expect(pwsh).toContain("'--preset' = 'presets'");
  });
});
