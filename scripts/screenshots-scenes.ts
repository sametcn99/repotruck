/**
 * Screenshot scene metadata — the single list shared by the capture driver
 * (scripts/capture-screens.ts), the generated website manifest and the
 * README gallery. Pure data + pure text builders so docs-check can verify
 * drift without spinning up a renderer.
 */

export interface SceneSpec {
  readonly slug: string;
  readonly title: string;
  readonly caption: string;
  readonly group: "Cockpit" | "Pages" | "Modals & dialogs";
}

export const SCENES: readonly SceneSpec[] = [
  {
    slug: "cockpit",
    title: "Cockpit",
    caption: "scope sidebar · live repository list · activity panel",
    group: "Cockpit",
  },
  {
    slug: "cockpit-inspector",
    title: "Inspector",
    caption: "right pane tab [2]: live git state of the cursor repo",
    group: "Cockpit",
  },
  {
    slug: "cockpit-health",
    title: "Health & Doctor",
    caption: "right pane tab [3]: workspace stats and doctor checks",
    group: "Cockpit",
  },
  {
    slug: "context-menu",
    title: "Repo context menu",
    caption: "→ or right-click: every repo-targeted action in one list",
    group: "Cockpit",
  },
  {
    slug: "help",
    title: "Help",
    caption: "? — keybindings plus the registry-generated views and parity line",
    group: "Cockpit",
  },
  {
    slug: "omnibar",
    title: "Command palette",
    caption: ": / Ctrl+K — fuzzy search across every CLI command",
    group: "Cockpit",
  },
  {
    slug: "command-form",
    title: "Command form",
    caption: "palette → form: full flag editing with the live CLI line",
    group: "Cockpit",
  },
  {
    slug: "start-preview",
    title: "Sync preview",
    caption: "Enter on a selection: where every repo will land before it runs",
    group: "Cockpit",
  },

  {
    slug: "sync-center",
    title: "Sync Center",
    caption: "v s — every sync flag, watch mode and the equivalent CLI command",
    group: "Pages",
  },
  {
    slug: "discover",
    title: "Discover",
    caption: "v d — qualified GitHub search, tracked markers, bulk clone",
    group: "Pages",
  },
  {
    slug: "scan",
    title: "Scan & Adopt",
    caption: "v n — unregistered repositories with adopt (scan --move)",
    group: "Pages",
  },
  {
    slug: "conflicts",
    title: "Conflicts",
    caption: "v x — failed-sync candidates with continue/abort actions",
    group: "Pages",
  },
  {
    slug: "status-matrix",
    title: "Status Matrix",
    caption: "v t — every repository × dirty/ahead/behind/missing",
    group: "Pages",
  },
  {
    slug: "status-detail",
    title: "Status detail",
    caption: "Enter expands a row: outgoing commits and diff stats (-D)",
    group: "Pages",
  },
  {
    slug: "status-remote",
    title: "Status remote",
    caption: "u adds open PR counts and CI state columns (--remote)",
    group: "Pages",
  },
  {
    slug: "code-search",
    title: "Code Search",
    caption: "v e / @ — symbol, text and regex search, results by repository",
    group: "Pages",
  },
  {
    slug: "stats",
    title: "Stats & health",
    caption: "v i — scorecard grades, languages, disk and stale repos",
    group: "Pages",
  },
  {
    slug: "changelog",
    title: "Changelog",
    caption: "v c — conventional commits across the workspace",
    group: "Pages",
  },
  {
    slug: "run-console",
    title: "Run Console",
    caption: "v r / ! — one command across repos with per-repo results",
    group: "Pages",
  },
  {
    slug: "presets",
    title: "Presets",
    caption: "v p — built-in and custom layout presets, token builder",
    group: "Pages",
  },
  {
    slug: "profiles",
    title: "Profiles & pins",
    caption: "v f — pinned repos and named profiles feeding sync/run scopes",
    group: "Pages",
  },
  {
    slug: "trash-backups",
    title: "Trash & backups",
    caption: "v b — soft-deleted repos and snapshot generations",
    group: "Pages",
  },
  {
    slug: "worktrees",
    title: "Worktrees",
    caption: "v w — workspace-wide linked worktree browser",
    group: "Pages",
  },
  {
    slug: "agents",
    title: "Agents & MCP",
    caption: "v g — AGENTS.md templates, exports and the MCP server",
    group: "Pages",
  },
  {
    slug: "about",
    title: "About",
    caption: "v o — Repotruck description and GitHub project",
    group: "Pages",
  },
  {
    slug: "settings",
    title: "Settings",
    caption: "v a — configuration, auth, update and completions",
    group: "Pages",
  },

  {
    slug: "clone-modal",
    title: "Clone",
    caption: "c — clone by URL or owner/name",
    group: "Modals & dialogs",
  },
  {
    slug: "create-wizard",
    title: "Create wizard",
    caption: "n — new repository, step by step",
    group: "Modals & dialogs",
  },
  {
    slug: "move-modal",
    title: "Move",
    caption: "m — custom path, undoable with z",
    group: "Modals & dialogs",
  },
  {
    slug: "alias-modal",
    title: "Alias",
    caption: "r — short names usable everywhere",
    group: "Modals & dialogs",
  },
  {
    slug: "open-modal",
    title: "Open in app",
    caption: "o — detected editors and agent CLIs",
    group: "Modals & dialogs",
  },
  {
    slug: "detail-modal",
    title: "Details",
    caption: "i — GitHub metadata plus local git state",
    group: "Modals & dialogs",
  },
  {
    slug: "reorganize-modal",
    title: "Reorganize",
    caption: "R — preset picker with a live dry-run preview",
    group: "Modals & dialogs",
  },
  {
    slug: "worktree-modal",
    title: "Worktree manager",
    caption: "W — per-repo linked worktrees",
    group: "Modals & dialogs",
  },
  {
    slug: "workspace-picker",
    title: "Workspace picker",
    caption: "w — switch or remove registered workspaces",
    group: "Modals & dialogs",
  },
  {
    slug: "root-modal",
    title: "Default root",
    caption: "d — show and set the fallback workspace root",
    group: "Modals & dialogs",
  },
  {
    slug: "device-flow",
    title: "Device-flow login",
    caption: "auth login — non-blocking URL + code while polling",
    group: "Modals & dialogs",
  },
  {
    slug: "permanent-delete",
    title: "Permanent delete",
    caption: "delete --yes — armed only by typing the repository name",
    group: "Modals & dialogs",
  },
  {
    slug: "confirm-delete",
    title: "Delete to trash",
    caption: "D — y/n confirm, parked in .repotruck/trash (z undoes)",
    group: "Modals & dialogs",
  },
];

export const SCREENSHOT_GROUPS: readonly SceneSpec["group"][] = [
  "Cockpit",
  "Pages",
  "Modals & dialogs",
];

/** Website manifest module content (biome-formatted downstream). */
export function buildScreenshotsManifestModule(): string {
  const entries = SCENES.map((scene) => ({
    slug: scene.slug,
    title: scene.title,
    caption: scene.caption,
    group: scene.group,
  }));
  return (
    "// AUTO-GENERATED from scripts/screenshots-scenes.ts — do not edit by hand.\n" +
    "// Regenerate with: bun run shots:gen   (drift fails CI via: bun run docs:check)\n\n" +
    "export interface ScreenshotEntry {\n" +
    "  slug: string;\n" +
    "  title: string;\n" +
    "  caption: string;\n" +
    '  group: "Cockpit" | "Pages" | "Modals & dialogs";\n' +
    "}\n\n" +
    "export const SCREENSHOTS: readonly ScreenshotEntry[] = " +
    JSON.stringify(entries, null, 2) +
    ";\n\n" +
    'export const SCREENSHOT_GROUPS: readonly ScreenshotEntry["group"][] = ' +
    JSON.stringify(SCREENSHOT_GROUPS, null, 2) +
    ";\n"
  );
}

/** README collapsible gallery block (markdown between the markers). */
export function buildReadmeGallery(): string {
  const sections = SCREENSHOT_GROUPS.map((group) => {
    const rows = SCENES.filter((scene) => scene.group === group);
    const images = rows
      .map(
        (scene) =>
          `    <p><sub><b>${scene.title}</b> — ${scene.caption}</sub><br />` +
          `<img src="website/public/screenshots/${scene.slug}.svg" alt="${scene.title} — ${scene.caption}" width="880" /></p>`,
      )
      .join("\n");
    return `  <h4>${group}</h4>\n${images}`;
  }).join("\n\n");
  return [
    "<details>",
    "<summary><b>Screenshots</b> — every page, modal and dialog (auto-captured from the TUI with mock data; regenerate with <code>bun run shots:gen</code>)</summary>",
    "",
    sections,
    "",
    "</details>",
  ].join("\n");
}
