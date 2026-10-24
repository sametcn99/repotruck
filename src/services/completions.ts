export type SupportedShell = "bash" | "zsh" | "fish" | "powershell";

export interface CompletionOption {
  flags: string;
  long?: string;
  short?: string;
  description?: string;
}

export interface CompletionCommand {
  name: string;
  description?: string;
  options: CompletionOption[];
  subcommands?: CompletionCommand[];
}

/**
 * Flag-value completion topics: a flag named here has its value completed
 * from the static list in STATIC_TOPIC_VALUES or, when absent there, from
 * `repotruck __complete <topic>` at completion time.
 */
export const FLAG_VALUE_TOPICS: Record<string, string> = {
  "--preset": "presets",
  "-p": "presets",
  "--kind": "kinds",
  "--lang": "langs",
  "--scope": "scopes",
  "--divergence": "divergence",
};

/** Topics whose candidate list is static (no `__complete` subprocess needed). */
export const STATIC_TOPIC_VALUES: Record<string, string> = {
  scopes: "user all org:",
  divergence: "fail rebase reset skip",
  kinds: "function class interface type enum method const",
  langs: "ts tsx js py go rs",
};

export function isStaticTopic(topic: string): boolean {
  return STATIC_TOPIC_VALUES[topic] !== undefined;
}

export function isSupportedShell(value: string): value is SupportedShell {
  return value === "bash" || value === "zsh" || value === "fish" || value === "powershell";
}

function escapeShellDescription(desc?: string): string {
  if (!desc) return "";
  return desc
    .replace(/['":\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function commandOptions(cmd: CompletionCommand): string {
  return cmd.options
    .map((o) => o.long ?? o.short ?? "")
    .filter((flag) => flag.length > 0)
    .join(" ");
}

export function buildBashCompletions(commands: readonly CompletionCommand[]): string {
  const commandNames = commands.map((c) => c.name).join(" ");
  const caseBranches: string[] = [];
  const flagValueBranches: string[] = [];

  for (const cmd of commands) {
    const opts = commandOptions(cmd);
    const subs = (cmd.subcommands ?? []).map((s) => s.name).join(" ");
    const lines: string[] = [];
    if (subs.length > 0) {
      lines.push(
        "      if [ $cword -eq 2 ]; then",
        `        COMPREPLY=( $(compgen -W "${subs}" -- "$cur") )`,
        "        return 0",
        "      fi",
      );
    }
    if (opts.length > 0) {
      lines.push(`      COMPREPLY=( $(compgen -W "${opts}" -- "$cur") )`);
      lines.push("      return 0");
    }
    if (lines.length > 0) {
      caseBranches.push(`    ${cmd.name})\n${lines.join("\n")}\n      ;;`);
    }
  }

  for (const [flag, topic] of Object.entries(FLAG_VALUE_TOPICS)) {
    const words = STATIC_TOPIC_VALUES[topic];
    const candidates =
      words !== undefined ? `"${words}"` : `"$(repotruck __complete ${topic} 2>/dev/null)"`;
    flagValueBranches.push(
      `  if [[ "$prev" == "${flag}" ]]; then`,
      `    COMPREPLY=( $(compgen -W ${candidates} -- "$cur") )`,
      "    return 0",
      "  fi",
    );
  }

  const lines = [
    "_repotruck() {",
    "  local cur prev words cword",
    "  _init_completion 2>/dev/null || {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash completion needs the literal ${COMP_*} placeholders
    '    cur="${COMP_WORDS[COMP_CWORD]}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash completion needs the literal ${COMP_*} placeholders
    '    prev="${COMP_WORDS[COMP_CWORD-1]}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash completion needs the literal ${COMP_*} placeholders
    '    words=("${COMP_WORDS[@]}")',
    "    cword=$COMP_CWORD",
    "  }",
    "",
    `  local commands="${commandNames}"`,
    "",
    "  if [ $cword -eq 1 ]; then",
    '    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )',
    "    return 0",
    "  fi",
    "",
    ...flagValueBranches,
    "",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash completion needs the literal ${words[...]} placeholder
    '  case "${words[1]}" in',
    ...caseBranches,
    "    *)",
    "      ;;",
    "  esac",
    "}",
    "complete -F _repotruck repotruck",
    "# source this in ~/.bashrc",
  ];

  return lines.join("\n");
}

export function buildZshCompletions(commands: readonly CompletionCommand[]): string {
  const commandLines: string[] = [];
  const actionCases: string[] = [];
  const topicsUsed = new Set<string>();

  for (const cmd of commands) {
    const desc = escapeShellDescription(cmd.description) || cmd.name;
    commandLines.push(`    '${cmd.name}:${desc}'`);

    const optArgs = cmd.options
      .map((o) => {
        const flag = o.long ?? o.short;
        if (!flag) return "";
        const topic = FLAG_VALUE_TOPICS[flag];
        const optDesc = escapeShellDescription(o.description);
        if (topic !== undefined) {
          topicsUsed.add(topic);
          const words = STATIC_TOPIC_VALUES[topic];
          const action = words !== undefined ? `(${words})` : `->${topic}`;
          return `'${flag}[${optDesc}]:value:${action}'`;
        }
        return `'${flag}[${optDesc}]'`;
      })
      .filter((s) => s.length > 0);

    const subArgs = (cmd.subcommands ?? [])
      .map((sub) => `'${sub.name}:${escapeShellDescription(sub.description) || sub.name}'`)
      .join(" ");

    const parts: string[] = [];
    if (subArgs.length > 0) {
      parts.push(`'1: subcommand:(${subArgs})'`);
    }
    if (optArgs.length > 0) {
      parts.push(`_arguments -s ${optArgs.join(" ")}`);
    }
    if (parts.length > 0) {
      actionCases.push(`    (${cmd.name})\n      ${parts.join("\n      ")} ;;\n`);
    }
  }

  const dynamicHelper = (topic: string): string[] => [
    `    (${topic})`,
    `      local -a values`,
    `      values=( \${=$(repotruck __complete ${topic} 2>/dev/null)} )`,
    `      _describe '${topic}' values`,
    `      ;;`,
  ];

  const lines = [
    "#compdef repotruck",
    "",
    "_repotruck() {",
    '  local curcontext="$curcontext" state line',
    "  typeset -A opt_args",
    "",
    "  _arguments -C \\",
    "    '1: :->command' \\",
    "    '*: :->args'",
    "",
    "  case $state in",
    "    (command)",
    "      local -a subcommands",
    "      subcommands=(",
    ...commandLines,
    "      )",
    "      _describe 'command' subcommands",
    "      ;;",
    "    (args)",
    "      case $line[1] in",
    ...actionCases,
    "      esac",
    "      ;;",
    ...[...topicsUsed].filter((topic) => !isStaticTopic(topic)).flatMap(dynamicHelper),
    "  esac",
    "}",
    "",
    '_repotruck "$@"',
    "# source this in ~/.zshrc (or drop into a fpath dir)",
  ];

  return lines.join("\n");
}

export function buildFishCompletions(commands: readonly CompletionCommand[]): string {
  const dynamicTopics = new Set<string>();
  for (const cmd of commands) {
    for (const opt of cmd.options) {
      const topic = opt.long !== undefined ? FLAG_VALUE_TOPICS[opt.long] : undefined;
      if (topic !== undefined && !isStaticTopic(topic)) {
        dynamicTopics.add(topic);
      }
    }
  }
  const lines: string[] = [
    "# Fish completions for repotruck",
    "complete -c repotruck -f",
    "",
    ...[...dynamicTopics].flatMap((topic) => [
      `function __repotruck_complete_${topic.replace(/-/g, "_")}`,
      `    repotruck __complete ${topic} 2>/dev/null | tr -s '[:space:]' ' '`,
      "end",
      "",
    ]),
  ];

  for (const cmd of commands) {
    const desc = escapeShellDescription(cmd.description);
    lines.push(`complete -c repotruck -n "__fish_use_subcommand" -a "${cmd.name}" -d "${desc}"`);

    for (const opt of cmd.options) {
      const optDesc = escapeShellDescription(opt.description);
      let line = `complete -c repotruck -n "__fish_seen_subcommand_from ${cmd.name}"`;
      if (opt.short) {
        line += ` -s ${opt.short.replace(/^-+/, "")}`;
      }
      if (opt.long) {
        line += ` -l ${opt.long.replace(/^-+/, "")}`;
      }
      if (optDesc.length > 0) {
        line += ` -d "${optDesc}"`;
      }
      lines.push(line);
      const topic = opt.long !== undefined ? FLAG_VALUE_TOPICS[opt.long] : undefined;
      if (topic === undefined) continue;
      const staticWords = STATIC_TOPIC_VALUES[topic];
      const value =
        staticWords !== undefined
          ? `"${staticWords}"`
          : `"(__repotruck_complete_${topic.replace(/-/g, "_")})"`;
      lines.push(
        `complete -c repotruck -n "__fish_seen_subcommand_from ${cmd.name}" -l ${opt.long!.replace(/^-+/, "")} -a ${value}`,
      );
    }

    for (const sub of cmd.subcommands ?? []) {
      const subDesc = escapeShellDescription(sub.description);
      const allSubs = (cmd.subcommands ?? []).map((s) => s.name).join(" ");
      lines.push(
        `complete -c repotruck -n "__fish_seen_subcommand_from ${cmd.name}; and not __fish_seen_subcommand_from ${allSubs}" -a "${sub.name}" -d "${subDesc}"`,
      );
    }
  }

  lines.push("# save as ~/.config/fish/completions/repotruck.fish");
  return lines.join("\n");
}

export function buildPowerShellCompletions(commands: readonly CompletionCommand[]): string {
  const topNames = commands.map((c) => c.name);
  const subcommandMap: string[] = [];
  for (const cmd of commands) {
    if ((cmd.subcommands ?? []).length > 0) {
      const subs = cmd.subcommands!.map((s) => `'${s.name}'`).join(", ");
      subcommandMap.push(`      '${cmd.name}' = @(${subs})`);
    }
  }
  const flagTopicMap = Object.entries(FLAG_VALUE_TOPICS)
    .map(([flag, topic]) => `      '${flag}' = '${topic}'`)
    .join("\n");
  const staticValues = Object.entries(STATIC_TOPIC_VALUES)
    .map(([topic, words]) => `      '${topic}' = '${words}'`)
    .join("\n");

  return [
    "# PowerShell completions for repotruck",
    "# Save as repotruck.ps1 and dot-source it from your $PROFILE:",
    "#   . /path/to/repotruck.ps1",
    "Register-ArgumentCompleter -CommandName 'repotruck' -ScriptBlock {",
    "    param($wordToComplete, $commandAst, $cursorPosition)",
    "",
    "    $elements = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })",
    `    $topCommands = @('${topNames.join("', '")}')`,
    "    $subcommands = @{",
    ...subcommandMap,
    "    }",
    "    $flagTopics = @{",
    flagTopicMap,
    "    }",
    "    $staticValues = @{",
    staticValues,
    "    }",
    "",
    "    function Complete-With([string[]]$candidates) {",
    '        $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
    "            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
    "        }",
    "    }",
    "",
    "    # Completing a flag value: the token before the cursor is a known flag",
    "    if ($elements.Count -ge 2) {",
    "        $prev = $elements[-2]",
    "        if ($flagTopics.ContainsKey($prev)) {",
    "            $topic = $flagTopics[$prev]",
    "            if ($staticValues.ContainsKey($topic)) {",
    "                return Complete-With ($staticValues[$topic] -split ' ')",
    "            }",
    "            $candidates = (repotruck __complete $topic 2>$null) -split '\\s+' | Where-Object { $_ }",
    "            return Complete-With $candidates",
    "        }",
    "    }",
    "",
    "    # Completing a subcommand of a parent command (e.g. repotruck alias <TAB>)",
    "    $positional = @($elements | Where-Object { $_ -notmatch '^-' })",
    "    if ($positional.Count -eq 1 -and $subcommands.ContainsKey($positional[0])) {",
    "        return Complete-With $subcommands[$positional[0]]",
    "    }",
    "",
    "    # Completing the top-level command",
    "    return Complete-With $topCommands",
    "}",
  ].join("\n");
}

export function buildCompletions(
  shell: SupportedShell,
  commands: readonly CompletionCommand[],
): string {
  if (shell === "bash") return buildBashCompletions(commands);
  if (shell === "zsh") return buildZshCompletions(commands);
  if (shell === "fish") return buildFishCompletions(commands);
  if (shell === "powershell") return buildPowerShellCompletions(commands);
  throw new Error(`unsupported shell: ${shell} (expected bash, zsh, fish, powershell)`);
}
