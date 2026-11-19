/**
 * Automatic TUI screenshots — repeatable, mock-data driven.
 *
 *   bun run shots:gen
 *
 * Renders the dashboard against the fixture workspace (mock services, no
 * network), drives every page/modal/dialog into place and writes:
 *
 *   website/public/screenshots/<slug>.svg   colored SVG frames
 *   website/src/components/screenshotsManifest.generated.ts
 *   README.md gallery block (between the screenshot markers)
 *
 * docs:check verifies the manifest + README blocks stay in sync.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import {
  buildFixtureWorkspace,
  makeScreenshotStore,
  registerFixtureWorkspace,
} from "./capture-fixtures.ts";
import { formattedContent } from "./docs-generate.ts";
import {
  buildReadmeGallery,
  buildScreenshotsManifestModule,
  SCENES,
} from "./screenshots-scenes.ts";

const WIDTH = 140;
const HEIGHT = 42;
const OUT_DIR = "website/public/screenshots";

// ---- SVG rendering -------------------------------------------------------------

const CW = 8.4; // char advance at 14px monospace
const LH = 17;
const FS = 14;
const PAD = 12;
const CANVAS_BG = "#0d1117";

interface SpanLike {
  text: string;
  width: number;
  fg: { toInts(): [number, number, number, number] };
  bg: { toInts(): [number, number, number, number] };
}

interface FrameLike {
  cols: number;
  rows: number;
  cursor: [number, number];
  lines: { spans: SpanLike[] }[];
}

function toInt(value: number): number {
  return value > 255 ? Math.round(value / 257) : value;
}

function css(color: { toInts(): [number, number, number, number] }): string {
  const [r, g, b] = color.toInts().map(toInt);
  return `rgb(${r},${g},${b})`;
}

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function frameToSvg(frame: FrameLike, slug: string): string {
  const w = frame.cols * CW + PAD * 2;
  const h = frame.rows * LH + PAD * 2;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}" role="img" aria-label="repotruck TUI — ${esc(slug)}">`,
  );
  parts.push(`<title>repotruck TUI — ${esc(slug)}</title>`);
  parts.push(`<rect width="${w}" height="${h}" fill="${CANVAS_BG}"/>`);
  parts.push(
    `<style>text{font-family:ui-monospace,"SF Mono","Cascadia Code",Consolas,"Liberation Mono",Menlo,monospace;font-size:${FS}px;white-space:pre}</style>`,
  );
  frame.lines.forEach((line, row) => {
    let col = 0;
    for (const span of line.spans) {
      if (span.text.length === 0) {
        col += span.width;
        continue;
      }
      const x = PAD + col * CW;
      const y = PAD + row * LH + FS;
      const [, , , bgA] = span.bg.toInts().map(toInt);
      if (bgA > 0) {
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${(PAD + row * LH).toFixed(1)}" width="${(span.width * CW).toFixed(1)}" height="${LH}" fill="${css(span.bg)}"/>`,
        );
      }
      parts.push(
        `<text x="${x.toFixed(1)}" y="${y}" fill="${css(span.fg)}" textLength="${(span.width * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(span.text)}</text>`,
      );
      col += span.width;
    }
  });
  const [cx, cy] = frame.cursor;
  if (cx >= 0 && cx < frame.cols && cy >= 0 && cy < frame.rows) {
    parts.push(
      `<rect x="${(PAD + cx * CW).toFixed(1)}" y="${(PAD + cy * LH).toFixed(1)}" width="${CW.toFixed(1)}" height="${LH}" fill="none" stroke="#e6edf3" stroke-opacity="0.55" rx="1"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

// ---- scene driver ----------------------------------------------------------------

type Tools = Awaited<ReturnType<typeof testRender>>;

async function settle(setup: Tools): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 90));
  await setup.flush({ maxPasses: 6 });
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function main(): Promise<void> {
  const root = buildFixtureWorkspace();
  await registerFixtureWorkspace(root);
  const store = makeScreenshotStore(root);

  const setup = await testRender(
    <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
    { width: WIDTH, height: HEIGHT, exitOnCtrlC: false },
  );
  await waitFor(() => store.getSnapshot().phase === "ready");
  await settle(setup);

  const repoRoot = path.join(import.meta.dir, "..");
  const outDir = path.join(repoRoot, OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  const shot = (slug: string): void => {
    const frame = (setup as unknown as { captureSpans: () => FrameLike }).captureSpans();
    writeFileSync(path.join(outDir, `${slug}.svg`), frameToSvg(frame, slug));
    process.stdout.write(`shot ${slug}\n`);
  };

  // State helpers shared by scenes.
  const openModal = (open: () => void): void => {
    open();
  };
  const snapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot();

  // --- Cockpit -----------------------------------------------------------------
  void store.toggleOrg("Mekanet-Energy");
  void store.toggleOrg("Hiretea");
  await waitFor(() => snapshot().repos.length >= 14);
  await waitFor(() => snapshot().localHealth.get("sametcn99/repotruck")?.dirty === true);
  await settle(setup);
  shot("cockpit");

  store.setRightPaneTab("inspector");
  await settle(setup);
  await waitFor(() => snapshot().inspector !== null);
  await settle(setup);
  shot("cockpit-inspector");

  store.setRightPaneTab("health");
  await settle(setup);
  await waitFor(() => snapshot().healthData?.loading === false);
  await settle(setup);
  shot("cockpit-health");

  store.openRepoContextMenu("sametcn99/repotruck");
  await settle(setup);
  shot("context-menu");
  store.closeRepoContextMenu();

  store.openHelpModal();
  await settle(setup);
  shot("help");
  store.closeModal();

  store.openOmnibar("commands", "sync");
  await settle(setup);
  shot("omnibar");
  store.closeModal();

  store.openCommandForm("sync");
  await settle(setup);
  shot("command-form");
  store.closeModal();

  store.toggleRepoAt(0);
  store.toggleRepoAt(1);
  await store.openStartPreview();
  await settle(setup);
  shot("start-preview");
  store.closeModal();

  // --- Pages ----------------------------------------------------------------------
  store.updateSyncCenter({
    scope: "all",
    stash: true,
    exclude: "forks/*",
    concurrency: 5,
    depth: 1,
    divergence: "rebase",
  });
  store.setView("sync");
  await settle(setup);
  shot("sync-center");

  store.updateDiscoverPage({ query: "mcp server" });
  await store.discoverSearch();
  await waitFor(() => snapshot().discoverPage?.loading === false);
  store.updateDiscoverPage({
    selected: new Set(["modelcontextprotocol/servers", "wong2/mcp-runner"]),
  });
  store.setView("discover");
  await settle(setup);
  shot("discover");

  store.setView("scan");
  await store.scanAndAdopt(false);
  await waitFor(() => (snapshot().scanPage?.unregistered?.length ?? 0) > 0);
  await settle(setup);
  shot("scan");

  store.setView("resolve");
  await settle(setup);
  shot("conflicts");

  store.setView("status");
  await store.refreshStatusMatrix();
  await waitFor(() => snapshot().statusMatrix?.loading === false);
  await settle(setup);
  shot("status-matrix");

  setup.mockInput.pressEnter(); // expand the cursor row (-D detail)
  await settle(setup);
  shot("status-detail");
  setup.mockInput.pressEscape();

  await store.refreshStatusMatrix(true);
  await waitFor(
    () => snapshot().statusMatrix?.loading === false && snapshot().statusMatrix?.remote === true,
  );
  await settle(setup);
  shot("status-remote");

  store.updateCodeSearchForm({ pattern: "Store" });
  await store.runCodeSearchPage();
  await waitFor(() => (snapshot().codeSearchPage?.matches?.length ?? 0) > 0);
  store.setView("search");
  await settle(setup);
  shot("code-search");

  store.setView("stats");
  void store.refreshStatsPage();
  await waitFor(() => snapshot().statsPage?.loading === false);
  await settle(setup);
  shot("stats");

  store.setView("changelog");
  await store.generateChangelog({ since: "30 days ago" });
  await waitFor(() => (snapshot().changelogPage?.markdown?.length ?? 0) > 0);
  await settle(setup);
  shot("changelog");

  store.updateRunConsole({ command: "bun test" });
  await store.runConsoleStart();
  await waitFor(
    () =>
      snapshot().runConsole?.running === false && (snapshot().runConsole?.results?.length ?? 0) > 0,
  );
  store.setView("run");
  await settle(setup);
  shot("run-console");

  await store.addCustomPreset("lang-owner", ["language", "owner", "name"]);
  store.setView("presets");
  await settle(setup);
  shot("presets");

  store.setView("profiles");
  await settle(setup);
  shot("profiles");

  await store.backupSnapshotNow();
  store.setView("trash");
  await store.refreshTrashPage();
  await waitFor(() => (snapshot().trashPage?.trash?.length ?? 0) > 0);
  await settle(setup);
  shot("trash-backups");

  store.setView("worktree");
  await store.scanWorkspaceWorktrees();
  await waitFor(() => (snapshot().worktreePage?.rows?.length ?? 0) > 0);
  await settle(setup);
  shot("worktrees");

  store.setView("agents");
  await settle(setup);
  shot("agents");

  store.setView("settings");
  void store.refreshSettingsPage();
  await waitFor(() => snapshot().settingsPage !== null);
  await settle(setup);
  shot("settings");

  // --- Modals & dialogs --------------------------------------------------------
  store.setView("cockpit");
  await settle(setup);

  openModal(() => store.openCloneModal());
  await settle(setup);
  shot("clone-modal");
  store.closeModal();

  openModal(() => store.openCreateModal());
  await settle(setup);
  shot("create-wizard");
  store.closeModal();

  await store.openMoveModal("sametcn99/repotruck");
  await settle(setup);
  shot("move-modal");
  store.closeModal();

  await store.openAliasModal("sametcn99/repotruck");
  await settle(setup);
  shot("alias-modal");
  store.closeModal();

  await store.openOpenModal("sametcn99/repotruck");
  await waitFor(() => snapshot().modal?.type === "open");
  await settle(setup);
  shot("open-modal");
  store.closeModal();

  store.openDetailModal("sametcn99/repotruck");
  await settle(setup);
  shot("detail-modal");
  store.closeModal();

  await store.openReorganizeModal();
  await waitFor(() => {
    const modal = snapshot().modal;
    return modal?.type === "reorganize" && modal.preview !== null;
  });
  await settle(setup);
  shot("reorganize-modal");
  store.closeModal();

  await store.openWorktreeModal("sametcn99/repotruck");
  await waitFor(() => {
    const modal = snapshot().modal;
    return modal?.type === "worktree" && modal.loading === false;
  });
  await settle(setup);
  shot("worktree-modal");
  store.closeModal();

  await store.openWorkspacePicker();
  await waitFor(() => snapshot().modal?.type === "workspaces");
  await settle(setup);
  shot("workspace-picker");
  store.closeModal();

  await store.openRootModal();
  await settle(setup);
  shot("root-modal");
  store.closeModal();

  void store.startDeviceFlow();
  await waitFor(() => snapshot().deviceFlow?.waiting === true);
  await settle(setup);
  shot("device-flow");
  store.cancelDeviceFlow();

  store.openPermanentDeleteConfirm("sametcn99/repotruck");
  await settle(setup);
  shot("permanent-delete");
  store.closeModal();

  await store.openSelectionDeleteConfirm();
  await waitFor(() => snapshot().modal?.type === "confirmDelete");
  await settle(setup);
  shot("confirm-delete");
  store.closeModal();

  await setup.dispose();

  // --- manifest + README ---------------------------------------------------------
  const manifestPath = "website/src/components/screenshotsManifest.generated.ts";
  const manifest = await formattedContent(manifestPath, buildScreenshotsManifestModule());
  writeFileSync(path.join(repoRoot, manifestPath), manifest);

  const readmePath = path.join(repoRoot, "README.md");
  const readme = await Bun.file(readmePath).text();
  const start = "<!-- screenshots:start -->";
  const end = "<!-- screenshots:end -->";
  const startIdx = readme.indexOf(start);
  const endIdx = readme.indexOf(end);
  if (startIdx >= 0 && endIdx > startIdx) {
    const next =
      readme.slice(0, startIdx + start.length) +
      "\n" +
      buildReadmeGallery() +
      "\n" +
      readme.slice(endIdx);
    writeFileSync(readmePath, next);
  }
  process.stdout.write(`manifest + README gallery updated (${SCENES.length} scenes)\n`);
}

await main();
