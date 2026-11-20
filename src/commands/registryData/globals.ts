import type { CommandSpec } from "../registryTypes.ts";
import { f } from "../registryTypes.ts";

/** Registry section: globals. Split out of registry.ts for the size budget. */
export const GLOBAL_COMMANDS: readonly CommandSpec[] = [
  // ---- global flags -------------------------------------------------------
  {
    id: "__globals__",
    path: "(global flags)",
    title: "Global flags",
    group: "Global",
    summary: "Program-level options inherited by every command",
    args: [],
    surface: { kind: "view", view: "settings" },
    requires: [],
    flags: [
      f("--dir", "path", "workspace root override", "workspace switcher (w)", { short: "-d" }),
      f("--concurrency", "int", "global concurrency limit", "task steppers + settings", {
        short: "-c",
        default: "3",
      }),
      f("--verbose", "bool", "detailed diagnostic logging", "Settings toggle + expandable output"),
      f("--no-color", "bool", "disable terminal colors", "NO_COLOR (already honored)"),
    ],
  },
];
