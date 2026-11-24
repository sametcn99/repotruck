import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { simpleGit } from "simple-git";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { terminalWidth } from "../src/components/windowing.ts";
import type { CodeSearchMatch } from "../src/services/codeSearch.ts";
import type { RepoStatusLine } from "../src/services/lifecycle.ts";
import { storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const priorConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
activateTheme("default");

function fixture() {
  const value = workspaceFixture();
  fixtures.push(value);
  process.env.REPOTRUCK_CONFIG_DIR = value.configDir;
  return value;
}

function makeStore(f: ReturnType<typeof fixture>, extra: Parameters<typeof storeDeps>[0] = {}) {
  const value = new Store(f.root, storeDeps(extra));
  stores.push(value);
  return value;
}

async function mount(store: Store, width = 130, height = 44, onQuit = () => {}) {
  const setup = await testRender(
    <Dashboard store={store} onQuit={onQuit} onSuspendAndRun={async () => {}} />,
    { width, height, exitOnCtrlC: false },
  );
  await waitUntil(() => store.getSnapshot().phase === "ready");
  await settleRender(setup);
  return setup;
}

async function settle(setup: Awaited<ReturnType<typeof mount>>) {
  await settleRender(setup);
}

async function clickText(setup: Awaited<ReturnType<typeof mount>>, text: string) {
  await settle(setup);
  const frame = setup.captureCharFrame();
  const offset = frame.indexOf(text);
  expect(offset, `visible control ${text}`).toBeGreaterThanOrEqual(0);
  const before = frame.slice(0, offset);
  const y = before.split("\n").length - 1;
  const rowPrefix = before.includes("\n") ? before.slice(before.lastIndexOf("\n") + 1) : before;
  const x = [...rowPrefix].reduce((sum, char) => sum + (char.codePointAt(0)! > 0xff ? 2 : 1), 0);
  await setup.mockMouse.click(x, y);
  await settle(setup);
}

function samePhysicalDirectory(left: string, right: string): boolean {
  const leftStats = statSync(left);
  const rightStats = statSync(right);
  if (leftStats.ino !== 0 && rightStats.ino !== 0) {
    return leftStats.dev === rightStats.dev && leftStats.ino === rightStats.ino;
  }

  const canonical = (value: string) => {
    let resolved = realpathSync.native(value).replaceAll("\\", "/");
    if (resolved.startsWith("//?/")) resolved = resolved.slice(4);
    return resolved.replace(/\/+$/, "").toLocaleLowerCase("en-US");
  };
  return canonical(left) === canonical(right);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (priorConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = priorConfigDir;
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("acceptance: page workflows through actual terminal events", () => {
  test("visible page footer controls open help and commands and navigate between pages", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    let quitRequests = 0;
    const setup = await mount(store, 130, 44, () => quitRequests++);
    try {
      store.setView("search");
      await settle(setup);
      await clickText(setup, "[F1] Help");
      expect(store.getSnapshot().modal?.type).toBe("help");
      setup.mockInput.pressEscape();
      await settle(setup);
      await clickText(setup, "[:] Commands");
      expect(store.getSnapshot().modal?.type).toBe("omnibar");
      setup.mockInput.pressEscape();
      await settle(setup);

      const current = store.getSnapshot().view;
      await clickText(setup, "] Next");
      expect(store.getSnapshot().view).not.toBe(current);
      await clickText(setup, "[ Prev");
      expect(store.getSnapshot().view).toBe(current);
      await clickText(setup, "[F10] Views");
      expect(store.getSnapshot().navFocused).toBe(true);
      await clickText(setup, "[F10] Views");
      expect(store.getSnapshot().navFocused).toBe(false);
      await clickText(setup, "System");
      expect(store.getSnapshot().navFocused).toBe(true);
      const cursorBeforeScroll = store.getSnapshot().navCursor;
      const menuFrame = setup.captureCharFrame();
      const menuArrow = menuFrame.indexOf("[→]");
      expect(menuArrow).toBeGreaterThanOrEqual(0);
      const menuPrefix = menuFrame.slice(0, menuArrow);
      const menuY = menuPrefix.split("\n").length - 1;
      const menuRow = menuPrefix.includes("\n")
        ? menuPrefix.slice(menuPrefix.lastIndexOf("\n") + 1)
        : menuPrefix;
      const menuX = terminalWidth(menuRow);
      await setup.mockMouse.scroll(menuX + 4, menuY + 3, "down");
      await settle(setup);
      expect(store.getSnapshot().navCursor).not.toBe(cursorBeforeScroll);
      await clickText(setup, "[←]");
      await clickText(setup, "[→]");
      await clickText(setup, "Settings");
      expect(store.getSnapshot().view).toBe("settings");
      await clickText(setup, "[F10] Views");
      expect(store.getSnapshot().navFocused).toBe(true);
      await setup.mockMouse.click(0, 12);
      await settle(setup);
      expect(store.getSnapshot().navFocused).toBe(false);
      await clickText(setup, "[q] Quit");
      expect(quitRequests).toBe(1);

      store.pushStatus("DONE", "[notice]", "fixture notice to dismiss");
      await settle(setup);
      expect(store.getSnapshot().toast?.message).toBe("[notice] — fixture notice to dismiss");
      await clickText(setup, "fixture notice to dismiss");
      expect(store.getSnapshot().toast).toBeNull();

      store.setView("cockpit");
      await settle(setup);
      for (let index = 0; index < 3 && store.getSnapshot().focus !== "list"; index++) {
        await clickText(setup, "[Tab] Focus");
      }
      const selectedBefore = store.getSnapshot().selected.has("acme/api");
      await clickText(setup, "[Space] Select");
      expect(store.getSnapshot().selected.has("acme/api")).toBe(!selectedBefore);
      for (let index = 0; index < 3 && store.getSnapshot().focus !== "sidebar"; index++) {
        await clickText(setup, "[Tab] Focus");
      }
      expect(store.getSnapshot().focus).toBe("sidebar");
      await clickText(setup, "[R] Layout");
      expect(store.getSnapshot().modal?.type).toBe("reorganize");
      await clickText(setup, "[Esc] Close");
    } finally {
      await setup.dispose();
    }
  });

  test("changelog range controls query local git history and mouse scrolling changes the preview", async () => {
    const f = fixture();
    await f.save();
    await simpleGit(f.repoDir).init();
    await simpleGit(f.repoDir).addConfig("user.name", "Repotruck Test");
    await simpleGit(f.repoDir).addConfig("user.email", "test@example.invalid");
    writeFileSync(path.join(f.repoDir, "history.md"), "first local change\n");
    await simpleGit(f.repoDir).add("history.md").commit("record local acceptance change");
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("changelog");
      await settle(setup);
      await clickText(setup, "[7 · 7d]");
      expect(store.getSnapshot().changelogPage?.markdown).toContain(
        "record local acceptance change",
      );
      await clickText(setup, "[g · 14d]");
      await clickText(setup, "[m · 30d]");
      await clickText(setup, "[c · copy]");
      setup.mockInput.pressKey("m");
      await settle(setup);
      expect(
        store.getSnapshot().statuses.some((entry) => entry.message?.includes("30 days ago")),
      ).toBe(true);
      await setup.mockMouse.scroll(90, 20, "down");
      await settle(setup);
      setup.mockInput.pressKey("HOME");
      setup.mockInput.pressKey("END");
      setup.mockInput.pressKey("PAGEDOWN");
      setup.mockInput.pressKey("PAGEUP");
      await settle(setup);
      setup.mockInput.pressKey("c");
      await settle(setup);
      expect(store.getSnapshot().statuses.some((entry) => entry.key === "[changelog]")).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("scan page finds a fixture repository and guards adopt and prune with cancelable confirmations", async () => {
    const f = fixture();
    await f.save();
    const untrackedRepo = path.join(f.root, "incoming", "notes");
    mkdirSync(untrackedRepo, { recursive: true });
    const untrackedGit = simpleGit(untrackedRepo);
    await untrackedGit.init();
    await untrackedGit.addConfig("user.name", "Repotruck Test");
    await untrackedGit.addConfig("user.email", "test@example.invalid");
    await untrackedGit.addRemote("origin", "https://github.com/extra/notes.git");
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("scan");
      await settle(setup);
      await clickText(setup, "[s] scan");
      expect(
        store.getSnapshot().scanPage?.unregistered.some((line) => line.includes("extra/notes")),
      ).toBe(true);
      await clickText(setup, "extra/notes · incoming/notes");
      await clickText(setup, "[a] adopt (--move)");
      expect(store.getSnapshot().dialog?.title).toBe("Adopt unregistered repos");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      await clickText(setup, "[p] prune untrack deleted");
      expect(store.getSnapshot().dialog?.title).toBe("Prune repositories");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(store.getSnapshot().repos).toHaveLength(1);
      expect(
        store.getSnapshot().scanPage?.unregistered.some((line) => line.includes("extra/notes")),
      ).toBe(true);

      await clickText(setup, "[a] adopt (--move)");
      await clickText(setup, "[Enter] Confirm");
      await waitUntil(() => store.getSnapshot().repos.some((repo) => repo.owner === "extra"));
      const adopted = store.getSnapshot().repos.find((repo) => repo.owner === "extra");
      expect(adopted?.name).toBe("notes");
      expect(existsSync(untrackedRepo)).toBe(false);
      const adoptedPath = store.getSnapshot().localHealth.get("extra/notes")?.relativePath;
      expect(adoptedPath).toBeTruthy();
      expect(existsSync(path.join(f.root, adoptedPath!))).toBe(true);
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (entry) => entry.key === "[scan]" && entry.message?.includes("adopted 1, 0 errors"),
          ),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("worktrees page scans a local linked checkout and opens its management modal from the mouse", async () => {
    const f = fixture();
    await f.save();
    const git = simpleGit(f.repoDir);
    await git.init();
    await git.addConfig("user.name", "Repotruck Test");
    await git.addConfig("user.email", "test@example.invalid");
    writeFileSync(path.join(f.repoDir, "seed.txt"), "fixture worktree\n");
    await git.add("seed.txt").commit("seed worktree fixture");
    const linkedPath = path.join(f.root, "acme", "source", "linked-checkout");
    await git.raw(["worktree", "add", "-b", "acceptance-worktree", linkedPath]);
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("worktree");
      await settle(setup);
      await clickText(setup, "[s] scan workspace worktrees");
      const linkedRow = store
        .getSnapshot()
        .worktreePage?.rows.find(
          (row) => row.repo === "acme/api" && row.branch === "acceptance-worktree",
        );
      expect(linkedRow).toBeDefined();
      expect(samePhysicalDirectory(linkedRow!.path, linkedPath)).toBe(true);
      expect(samePhysicalDirectory(linkedRow!.path, f.repoDir)).toBe(false);
      await setup.mockMouse.scroll(90, 20, "down");
      await settle(setup);
      setup.mockInput.pressKey("HOME");
      setup.mockInput.pressKey("END");
      setup.mockInput.pressKey("PAGEDOWN");
      setup.mockInput.pressKey("PAGEUP");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("worktree");
      await clickText(setup, "[Esc] Close");
      await settle(setup);
      setup.mockInput.pressKey("G");
      await settle(setup);
      await clickText(setup, "acceptance-worktree");
      await clickText(setup, "[Enter] Manage worktrees");
      expect(store.getSnapshot().modal?.type).toBe("worktree");
      expect(store.getSnapshot().modal).toMatchObject({ key: "acme/api" });
    } finally {
      await setup.dispose();
    }
  });

  test("code search controls change query options, search fixture files, and expose empty/error outcomes", async () => {
    const f = fixture();
    await f.save();
    writeFileSync(path.join(f.repoDir, "needle.ts"), "export class Needle {}\n");
    let searches = 0;
    const match: CodeSearchMatch = {
      repo: "acme/api",
      path: "needle.ts",
      line: 1,
      kind: "class",
      name: "Needle",
      formatted: "acme/api needle.ts:1 class Needle",
    } as CodeSearchMatch;
    const store = makeStore(f, {
      searchCodeFn: async (options) => {
        searches++;
        if (options.regex === true) throw new Error("fixture regex rejected");
        return {
          matches: searches === 1 ? [match] : [],
          filesIndexed: 1,
          symbols: 1,
          durationMs: 2,
        } as never;
      },
    });
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("search");
      await settle(setup);
      await setup.mockInput.typeText("Needle");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().codeSearchPage?.matches[0]?.name).toBe("Needle");
      await clickText(setup, "acme/api needle.ts:1 class Needle");
      expect(store.getSnapshot().modal?.type).toBe("detail");
      setup.mockInput.pressEscape();
      await settle(setup);
      await clickText(setup, "[m] mode: symbol");
      expect(store.getSnapshot().codeSearchPage?.mode).toBe("text");
      await clickText(setup, "[o] offline: on");
      expect(store.getSnapshot().codeSearchPage?.offline).toBe(false);
      setup.mockInput.pressKey("t");
      setup.mockInput.pressKey("l");
      setup.mockInput.pressKey("n");
      setup.mockInput.pressKey("m");
      setup.mockInput.pressKey("J");
      setup.mockInput.pressKey("s");
      await settle(setup);
      expect(store.getSnapshot().codeSearchPage?.matches).toEqual([]);
      expect(searches).toBe(2);
      expect(store.getSnapshot().statuses.some((entry) => entry.key === "[search-code]")).toBe(
        true,
      );
      await clickText(setup, "[r] rebuild index");
      await clickText(setup, "[s] search");
      await settle(setup);
      expect(searches).toBeGreaterThanOrEqual(3);
      await clickText(setup, "Needle");
      setup.mockInput.pressKey("END");
      for (let index = 0; index < 40; index++) setup.mockInput.pressKey("BACKSPACE");
      await setup.mockInput.typeText("[");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().codeSearchPage).toMatchObject({ mode: "re", pattern: "[" });
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (status) => status.phase === "FAILED" && status.message === "fixture regex rejected",
          ),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("run console submits a command, renders mixed results, and lets mouse and keys change scope", async () => {
    const f = fixture();
    await f.save();
    let received: unknown;
    const store = makeStore(f, {
      runInReposFn: async (options) => {
        received = options;
        return {
          results: [
            {
              key: "acme/api",
              relativePath: "acme/source/api",
              ok: false,
              exitCode: 7,
              durationMs: 4,
              stdout: "partial",
              stderr: "fixture failure",
            },
          ],
          skipped: [],
        } as never;
      },
    });
    await store.init();
    const setup = await mount(store);
    try {
      store.updateRunConsole({ scope: "all", command: "npm test" });
      store.setView("run");
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
      await clickText(setup, "[e] Run");
      await settle(setup);
      expect(received).toBeDefined();
      expect(store.getSnapshot().runConsole?.results[0]).toMatchObject({
        ok: false,
        stderr: "fixture failure",
      });
      expect(store.getSnapshot().statuses.some((entry) => entry.phase === "FAILED")).toBe(true);
      await clickText(setup, "acme/api · exit 7");
      setup.mockInput.pressKey("c");
      setup.mockInput.pressKey("s");
      setup.mockInput.pressKey("J");
      await settle(setup);
      expect(store.getSnapshot().runConsole?.scope).toBe("selection");
      expect(setup.captureCharFrame()).toContain("fixture failure");
      await clickText(setup, "[s] scope: selection");
      expect(store.getSnapshot().runConsole?.scope).toBe("pinned");
      await clickText(setup, "[c] -c 5");
      expect(store.getSnapshot().runConsole?.concurrency).toBe(8);
      await clickText(setup, "[J] copy JSON");
      expect(store.getSnapshot().statuses.some((entry) => entry.key === "[run]")).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("status matrix mouse filters rows, refreshes remote columns, expands details, and toggles back", async () => {
    const f = fixture();
    await f.save();
    const lines: RepoStatusLine[] = [
      { key: "acme/api", line: "acme/api — dirty", dirty: true, ahead: 2, behind: 0 },
    ];
    let requests = 0;
    const store = makeStore(f, {
      workspaceStatusFn: async (_root, remote) => {
        requests++;
        return { lastSync: "now", repos: lines, remote } as never;
      },
    });
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("status");
      await settle(setup);
      expect(store.getSnapshot().statusMatrix?.repos).toHaveLength(1);
      await clickText(setup, "[ ] dirty");
      expect(setup.captureCharFrame()).toContain("1 repos");
      await clickText(setup, "[u] remote: off");
      expect(store.getSnapshot().statusMatrix?.remote).toBe(true);
      expect(requests).toBeGreaterThanOrEqual(2);
      await clickText(setup, "[r] refresh");
      await clickText(setup, "[J] copy JSON");
      await clickText(setup, "acme/api");
      setup.mockInput.pressKey("o");
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("detail");
      store.closeModal();
      setup.mockInput.pressKey("f");
      setup.mockInput.pressKey("r");
      await settle(setup);
      setup.mockInput.pressKey("u");
      await settle(setup);
      setup.mockInput.pressKey("J");
      await settle(setup);
      expect(store.getSnapshot().statusMatrix?.remote).toBe(false);
      expect(store.getSnapshot().statuses.some((entry) => entry.key === "[status]")).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("sync controls update CLI flags, report empty selection, and preview through the mouse action", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("sync");
      await settle(setup);
      setup.mockInput.pressKey("s");
      setup.mockInput.pressKey("d");
      setup.mockInput.pressKey("b");
      setup.mockInput.pressKey("t");
      setup.mockInput.pressKey("c");
      setup.mockInput.pressKey("p");
      setup.mockInput.pressKey("l");
      await settle(setup);
      expect(store.getSnapshot().syncCenter).toMatchObject({
        blobless: true,
        stash: true,
        concurrency: 5,
        depth: 1,
        limit: 10,
      });
      await clickText(setup, "[i] include:");
      await setup.mockInput.typeText("acme/*");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().syncCenter?.include).toBe("acme/*");
      await clickText(setup, "[E] exclude:");
      await setup.mockInput.typeText("fork/*");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().syncCenter?.exclude).toBe("fork/*");
      await clickText(setup, "[e] Start Sync");
      await settle(setup);
      expect(store.getSnapshot().statuses.some((entry) => entry.phase === "FAILED")).toBe(true);
      await clickText(setup, "[V] Preview cockpit selection");
      await settle(setup);
      expect(store.getSnapshot().view).toBe("cockpit");
    } finally {
      await setup.dispose();
    }
  });

  test("conflict resolver opens the failed repo detail and routes abort through fixture git", async () => {
    const f = fixture();
    await f.save();
    await simpleGit(f.repoDir).init();
    const store = makeStore(f);
    await store.init();
    store.pushStatus("FAILED", "acme/api", "conflict in fixture repo");
    const setup = await mount(store);
    try {
      store.setView("resolve");
      await settle(setup);
      await clickText(setup, "acme/api — conflict in fixture repo");
      expect(store.getSnapshot().modal?.type).toBe("detail");
      store.closeModal();
      await settle(setup);
      await act(async () => {
        await clickText(setup, "[a] git rebase --abort");
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      await settle(setup);
      expect(setup.captureCharFrame()).toContain("Resolution output");
      expect(
        store
          .getSnapshot()
          .statuses.some((entry) => entry.key === "[resolve]" && entry.message?.includes("abort")),
      ).toBe(true);
      await act(async () => {
        await clickText(setup, "[g] git rebase --continue");
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (entry) => entry.key === "[resolve]" && entry.message?.includes("continue"),
          ),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });
});
