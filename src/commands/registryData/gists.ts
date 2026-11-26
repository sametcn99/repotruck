import { type ArgSpec, type CommandSpec, type FlagSpec, f, jsonFlag } from "../registryTypes.ts";

const ref: ArgSpec = { name: "ref", required: true, summary: "Gist ID or URL" };
const description = f("--description", "string", "Gist description", "description field");
const files = f("--file", "list", "UTF-8 files to add or replace", "multiline file editor");

export const GIST_COMMANDS: readonly CommandSpec[] = [
  {
    id: "gist",
    path: "gist",
    title: "Gists",
    group: "Workspace",
    summary: "Browse, clone, and manage GitHub Gists",
    args: [],
    flags: [],
    surface: { kind: "view", view: "gists" },
    requires: [],
  },
  gist(
    "list",
    "List account and tracked Gists",
    [],
    [f("--tracked", "bool", "list the tracked inventory offline", "local inventory")],
  ),
  gist(
    "show",
    "Inspect a Gist and its remote files",
    [ref],
    [f("--file", "string", "print one text file", "file details")],
  ),
  gist("clone", "Clone or update a Gist by ID or URL", [ref]),
  gist("sync", "Sync selected Gists or the account and tracked Gists", [
    { name: "refs", required: false, summary: "Gist IDs or URLs (variadic)" },
  ]),
  gist("open", "Open a local Gist in an editor or agent app", [
    ref,
    { name: "app", required: true, summary: "editor or app name" },
  ]),
  gist(
    "create",
    "Create a GitHub Gist with one or more files",
    [],
    [
      files,
      description,
      f("--public", "bool", "publish publicly (default: secret)", "visibility picker"),
    ],
  ),
  gist(
    "edit",
    "Edit remote Gist files and metadata",
    [ref],
    [
      files,
      description,
      f("--rename", "list", "rename files using old=new pairs", "edit filename"),
      f("--remove", "list", "remove files by name", "remove file"),
      f("--expect-version", "string", "require a version from gist show", "uses opened version"),
    ],
  ),
  gist("push", "Push local commits to the Gist upstream", [ref]),
  gist(
    "delete",
    "Permanently delete a Gist from GitHub",
    [ref],
    [f("--yes", "bool", "confirm remote deletion and keep local files", "confirm dialog")],
  ),
];

function gist(
  name: string,
  summary: string,
  args: readonly ArgSpec[],
  flags: readonly FlagSpec[] = [],
): CommandSpec {
  return {
    id: `gist.${name}`,
    path: `gist ${name}`,
    title: `Gist ${name}`,
    group: "Workspace",
    summary,
    args,
    flags: [...flags, jsonFlag("machine-readable CLI result")],
    surface: { kind: "view", view: "gists" },
    requires: name === "open" ? ["workspace"] : name === "list" ? [] : ["auth"],
  };
}
