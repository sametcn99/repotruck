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
import { Dashboard } from "../src/components/Dashboard.tsx";
import { settleRender as settle, testRender } from "../tests/helpers/render.tsx";
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

// Height 48 avoids an @opentui core row-merge artifact observed at heights
// 42/44 (every 4th modal content row corrupts when header+modal+footer all
// render); 40/48/50 render clean across widths.
const WIDTH = 160;
const HEIGHT = 52;
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

export function frameToSvg(frame: FrameLike, slug: string, charRows: readonly string[]): string {
  const w = frame.cols * CW + PAD * 2;
  const h = frame.rows * LH + PAD * 2;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}" role="img" aria-label="primary TUI — ${esc(slug)}">`,
  );
  parts.push(`<title>primary TUI — ${esc(slug)}</title>`);
  parts.push(`<rect width="${w}" height="${h}" fill="${CANVAS_BG}"/>`);
  parts.push(
    `<style>text{font-family:ui-monospace,"SF Mono","Cascadia Code",Consolas,"Liberation Mono",Menlo,monospace;font-size:${FS}px;white-space:pre}</style>`,
  );
  frame.lines.forEach((line, row) => {
    // The span serializer occasionally merges stale cells into a row's text
    // (observable as duplicated letters); the plain char frame is the source
    // of truth for glyphs. When the two disagree, render the char frame row
    // with the row's dominant span color.
    const spanText = line.spans
      .map((span) => span.text)
      .join("")
      .replace(/\s+$/, "");
    const charText = (charRows[row] ?? "").replace(/\s+$/, "");
    const trustworthy = spanText === charText;

    let col = 0;
    if (trustworthy) {
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
    } else if (charText.length > 0) {
      const counts = new Map<string, number>();
      for (const span of line.spans) {
        if (span.text.trim().length === 0) continue;
        const key = css(span.fg);
        counts.set(key, (counts.get(key) ?? 0) + span.text.trim().length);
      }
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#e6edf3";
      const x = PAD;
      const y = PAD + row * LH + FS;
      parts.push(
        `<text x="${x.toFixed(1)}" y="${y}" fill="${dominant}" textLength="${(charText.length * CW).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(charText)}</text>`,
      );
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

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function main(): Promise<void> {
  // Screenshots document the default color theme regardless of a CI NO_COLOR setting.
  delete process.env.NO_COLOR;
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

  let repairedRows = 0;
  const captureFrom = (setup: Tools, slug: string): void => {
    const tools = setup as unknown as {
      captureSpans: () => FrameLike;
      captureCharFrame: () => string;
    };
    const frame = tools.captureSpans();
    const charRows = tools.captureCharFrame().split("\n");
    for (const [row, line] of frame.lines.entries()) {
      const spanText = line.spans
        .map((span) => span.text)
        .join("")
        .replace(/\s+$/, "");
      const charText = (charRows[row] ?? "").replace(/\s+$/, "");
      if (spanText !== charText) repairedRows += 1;
    }
    writeFileSync(path.join(outDir, `${slug}.svg`), frameToSvg(frame, slug, charRows));
    process.stdout.write(`shot ${slug}\n`);
  };

  const shot = async (slug: string, markers: readonly string[] = []): Promise<void> => {
    const deadline = Date.now() + 4000;
    do {
      await settle(setup);
      const frame = setup.captureCharFrame();
      if (markers.every((marker) => frame.includes(marker))) {
        captureFrom(setup, slug);
        return;
      }
    } while (Date.now() < deadline);
    throw new Error(`${slug}: expected to see ${markers.join(", ")} in the captured frame`);
  };

  // State helpers shared by scenes.
  const snapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot();

  // --- Cockpit -----------------------------------------------------------------
  void store.toggleOrg("acme-labs");
  void store.toggleOrg("vertex-soft");
  await waitFor(() => snapshot().repos.length >= 12);
  await waitFor(() => snapshot().localHealth.get("devuser/primary")?.dirty === true);

  await shot("cockpit");

  store.setRightPaneTab("inspector");
  await waitFor(() => snapshot().inspector?.details !== null, 6000);
  await shot("cockpit-inspector");

  store.setRightPaneTab("health");
  await waitFor(() => snapshot().healthData?.loading === false);
  await shot("cockpit-health");

  store.openRepoContextMenu("devuser/primary");
  await shot("context-menu");
  store.closeRepoContextMenu();

  store.openHelpModal();
  await shot("help");
  store.closeModal();

  store.openOmnibar("commands", "sync");
  await shot("omnibar");
  store.closeModal();

  store.openCommandForm("sync");
  await shot("command-form");
  store.closeModal();

  store.toggleRepoAt(0);
  store.toggleRepoAt(1);
  await store.openStartPreview();
  await waitFor(() => snapshot().modal?.type === "preview");
  await shot("start-preview");
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
  await shot("sync-center");

  await settle(setup, async () => store.setView("gists"));
  await shot("gists", [
    "public  clean  Deployment checklist",
    "secret  dirty  Workspace handoff notes",
    "public  missing  TypeScript error formatter",
  ]);
  setup.mockInput.pressEnter();
  await shot("gist-detail", ["checklist.md", "health-check.sh", "Verify artifact checksums"]);
  setup.mockInput.pressEscape();
  await settle(setup);
  setup.mockInput.pressKey("e");
  await shot("gist-edit", ["Edit Gist on GitHub", "File 1/2", "checklist.md"]);
  setup.mockInput.pressEscape();
  await settle(setup);
  setup.mockInput.pressKey("n");
  await settle(setup);
  await setup.mockInput.typeText("Release review checklist");
  setup.mockInput.pressTab();
  await settle(setup);
  await setup.mockInput.typeText("review.md");
  setup.mockInput.pressTab();
  await settle(setup);
  await setup.mockInput.typeText("# Release review");
  setup.mockInput.pressEnter();
  await setup.mockInput.typeText("- Check the release notes and run the smoke tests.");
  setup.mockInput.pressKey("n", { ctrl: true });
  await settle(setup);
  await setup.mockInput.typeText("smoke-results.txt");
  setup.mockInput.pressTab();
  await settle(setup);
  await setup.mockInput.typeText("All smoke checks passed.");
  await shot("gist-create", ["Create GitHub Gist", "File 2/2", "smoke-results.txt"]);
  setup.mockInput.pressEscape();

  store.updateDiscoverPage({ query: "mcp mirror-svc" });
  await store.discoverSearch();
  await waitFor(() => snapshot().discoverPage?.loading === false);
  store.updateDiscoverPage({
    selected: new Set(["open-tools/mcp-servers", "indie-dev/mcp-runner"]),
  });
  store.setView("discover");
  await shot("discover");

  await store.scanAndAdopt(false);
  await waitFor(() => (snapshot().scanPage?.unregistered?.length ?? 0) > 0);
  store.setView("scan");
  await shot("scan");

  store.pushStatus(
    "FAILED",
    "acme-labs/dashboard",
    "rebase conflict in src/config.ts (divergence=rebase)",
  );
  store.pushStatus("FAILED", "acme-labs/core-api", "diverged from origin/main (1 ahead, 1 behind)");
  store.setView("resolve");
  await shot("conflicts");

  await store.refreshStatusMatrix();
  await waitFor(() => snapshot().statusMatrix?.loading === false);
  store.setView("status");
  await shot("status-matrix");

  // remote first: status-detail's escape resets the view to cockpit
  await store.refreshStatusMatrix(true);
  await waitFor(
    () => snapshot().statusMatrix?.loading === false && snapshot().statusMatrix?.remote === true,
  );
  store.setView("status");
  await settle(setup);
  await shot("status-remote");

  // then detail (expanded row); escape at the end is fine — next scene sets its own view
  store.setView("status");
  await settle(setup);
  setup.mockInput.pressEnter(); // expand the cursor row (-D detail)
  await shot("status-detail");

  store.updateCodeSearchForm({ pattern: "Store" });
  await store.runCodeSearchPage();
  await waitFor(() => (snapshot().codeSearchPage?.matches?.length ?? 0) > 0, 6000);
  store.setView("search");
  await settle(setup);
  await shot("code-search");

  await store.refreshStatsPage();
  await waitFor(() => snapshot().statsPage?.loading === false);
  store.setView("stats");
  await shot("stats");

  await store.generateChangelog({ since: "30 days ago" });
  await waitFor(() => (snapshot().changelogPage?.markdown?.length ?? 0) > 0, 6000);
  store.setView("changelog");
  await settle(setup);
  await settle(setup);
  await shot("changelog");

  store.updateRunConsole({ command: "bun test" });
  await store.runConsoleStart();
  await waitFor(
    () =>
      snapshot().runConsole?.running === false && (snapshot().runConsole?.results?.length ?? 0) > 0,
  );
  store.setView("run");
  await shot("run-console");

  await store.addCustomPreset("lang-owner", ["language", "owner", "name"]);
  store.setView("presets");
  await shot("presets");

  store.setView("profiles");
  await shot("profiles");

  await store.backupSnapshotNow();
  await store.refreshTrashPage();
  await waitFor(() => (snapshot().trashPage?.trash?.length ?? 0) > 0);
  store.setView("trash");
  await shot("trash-backups");

  await store.scanWorkspaceWorktrees();
  await waitFor(() => (snapshot().worktreePage?.rows?.length ?? 0) > 0, 6000);
  store.setView("worktree");
  await settle(setup);
  await shot("worktrees");

  store.setView("agents");
  await shot("agents");

  await store.refreshSettingsPage();
  await waitFor(() => snapshot().settingsPage !== null);
  store.setView("about");
  await shot("about");

  store.setView("settings");
  await shot("settings");

  // --- Modals & dialogs --------------------------------------------------------
  store.setView("cockpit");
  await store.openCloneModal();
  await shot("clone-modal");
  store.closeModal();

  store.openCreateModal();
  await shot("create-wizard");
  store.closeModal();

  await store.openMoveModal("devuser/primary");
  await shot("move-modal");
  store.closeModal();

  await store.openAliasModal("devuser/primary");
  await shot("alias-modal");
  store.closeModal();

  await store.openOpenModal("devuser/primary");
  await waitFor(() => snapshot().modal?.type === "open");
  await shot("open-modal");
  store.closeModal();

  store.openDetailModal("devuser/primary");
  await shot("detail-modal");
  store.closeModal();

  await store.openReorganizeModal();
  await waitFor(() => {
    const modal = snapshot().modal;
    return modal?.type === "reorganize" && modal.preview !== null;
  });
  await shot("reorganize-modal");
  store.closeModal();

  await store.openWorktreeModal("devuser/primary");
  await waitFor(() => {
    const modal = snapshot().modal;
    return modal?.type === "worktree" && modal.loading === false;
  });
  await shot("worktree-modal");
  store.closeModal();

  await store.openWorkspacePicker();
  await waitFor(() => snapshot().modal?.type === "workspaces");
  await shot("workspace-picker");
  store.closeModal();

  await store.openRootModal();
  await shot("root-modal");
  store.closeModal();

  void store.startDeviceFlow();
  await waitFor(() => snapshot().deviceFlow?.waiting === true);
  await shot("device-flow");
  store.cancelDeviceFlow();

  store.openPermanentDeleteConfirm("devuser/primary");
  await shot("permanent-delete");
  store.closeModal();

  await store.openSelectionDeleteConfirm();
  await waitFor(() => snapshot().modal?.type === "confirmDelete");
  await shot("confirm-delete");
  store.closeModal();

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
  process.stdout.write(
    `manifest + README gallery updated (${SCENES.length} scenes, ${repairedRows} rows color-flattened from span-merge artifacts)\n`,
  );
}

await main();
