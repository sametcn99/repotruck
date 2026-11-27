import type { CommandSpec } from "../registryTypes.ts";
import { f, jsonFlag } from "../registryTypes.ts";

/** Registry section: settings. Split out of registry.ts for the size budget. */
export const SETTINGS_COMMANDS: readonly CommandSpec[] = [
  // ---- settings & agents --------------------------------------------------
  {
    id: "config",
    path: "config",
    title: "Settings",
    group: "Settings",
    summary: "Read and write repotruck settings",
    args: [
      { name: "action", required: true, summary: "get | set | unset | list" },
      { name: "key", required: false, summary: "settings key" },
      { name: "value", required: false, summary: "value (set)" },
    ],
    surface: { kind: "view", view: "settings" },
    requires: [],
    flags: [],
  },
  {
    id: "update",
    path: "update",
    title: "Self-update",
    group: "Settings",
    summary: "Check for a newer release or update a global package install",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [
      f("--check", "bool", "check without installing", "update notification"),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "mcp",
    path: "mcp",
    title: "MCP server",
    group: "Settings",
    summary: "Serve the workspace as an MCP server (stdio or HTTP)",
    args: [],
    surface: { kind: "view", view: "agents" },
    requires: [],
    flags: [
      f("--http", "bool", "Streamable HTTP instead of stdio", "mode selector"),
      f("--port", "int", "HTTP port", "stepper", { default: "3000" }),
      f("--host", "string", "bind address (non-localhost needs --token)", "field", {
        default: "127.0.0.1",
      }),
      f("--token", "string", "required bearer token", "generate + show"),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
    ],
  },
];
