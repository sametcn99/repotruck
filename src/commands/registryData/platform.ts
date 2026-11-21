import type { CommandSpec } from "../registryTypes.ts";
import { f, jsonFlag } from "../registryTypes.ts";

/** Registry section: platform. Split out of registry.ts for the size budget. */
export const PLATFORM_COMMANDS: readonly CommandSpec[] = [
  // ---- platform -----------------------------------------------------------
  {
    id: "auth.login",
    path: "auth login",
    title: "Login",
    group: "Platform",
    summary: "Authenticate via the OAuth device flow",
    args: [],
    surface: { kind: "modal", modal: "deviceFlow" },
    requires: ["auth"],
    flags: [
      f(
        "--base-url",
        "url",
        "GitHub Enterprise endpoint (persisted)",
        "Settings › connection field",
      ),
    ],
  },
  {
    id: "auth.logout",
    path: "auth logout",
    title: "Logout",
    group: "Platform",
    summary: "Log out of cached credentials",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [],
  },
  {
    id: "auth.status",
    path: "auth status",
    title: "Auth status",
    group: "Platform",
    summary: "Show the current authentication method",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [jsonFlag("status as JSON copy")],
  },
  {
    id: "doctor",
    path: "doctor",
    title: "Doctor",
    group: "Platform",
    summary: "Health checks for git, gh, token and workspace",
    args: [],
    surface: { kind: "action", action: "runHealthDoctorFix" },
    requires: [],
    flags: [
      f(
        "--fix",
        "bool",
        "apply inventory repairs, recover unfinished moves, and offer login",
        "F · review Doctor fixes",
      ),
      f(
        "--dir",
        "path",
        "check and fix inventory in this workspace",
        "active workspace in the Health panel",
      ),
      jsonFlag("checks as JSON copy"),
    ],
  },
  {
    id: "stats",
    path: "stats",
    title: "Stats & health",
    group: "Platform",
    summary: "Language, category, disk and health scorecard",
    args: [],
    surface: { kind: "view", view: "stats" },
    requires: ["workspace"],
    flags: [
      f("--health", "bool", "workspace health scorecard and grade", "scorecard section"),
      jsonFlag("stats as JSON copy"),
    ],
  },
  {
    id: "completions",
    path: "completions",
    title: "Shell completions",
    group: "Platform",
    summary: "Generate shell completion scripts",
    args: [{ name: "shell", required: true, summary: "bash | zsh | fish | powershell" }],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [],
  },
];
