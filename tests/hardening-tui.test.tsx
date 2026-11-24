import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { InputRenderable } from "@opentui/core";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { type ModalState, Store, type ViewId } from "../src/components/store.ts";
import { copyText, MAX_OSC52_BYTES } from "../src/components/ui/JsonCopy.ts";
import { clampBoxLine, terminalWidth } from "../src/components/windowing.ts";
import { APP_DESCRIPTION, APP_GITHUB_URL } from "../src/services/about.ts";
import { diagSnapshot } from "../src/services/diagnostics.ts";
import { writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { installRuntimeErrorCapture, startTui } from "../src/tuiRuntime.tsx";
import { storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";
import { testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [],
  stores: Store[] = [];
const previousConfig = process.env.REPOTRUCK_CONFIG_DIR;
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  return f;
}
function store(f: ReturnType<typeof fixture>, deps = storeDeps()) {
  const value = new Store(f.root, deps);
  stores.push(value);
  return value;
}
afterEach(() => {
  for (const value of stores.splice(0)) value.dispose();
  if (previousConfig === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = previousConfig;
  for (const f of fixtures.splice(0)) f.cleanup();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("TUI lifetime and interaction boundaries", () => {
  for (const view of ["search", "discover", "run"] as ViewId[])
    test(`[E58] editing ${view} keeps letters and punctuation out of global shortcuts`, async () => {
      const f = fixture();
      await f.save();
      const value = store(f);
      await value.init();
      value.setView(view);
      let quit = 0;
      const setup = await testRender(
        <Dashboard
          store={value}
          onQuit={() => {
            quit++;
          }}
          onSuspendAndRun={async () => {}}
        />,
        { width: 110, height: 32 },
      );
      try {
        await setup.flush();
        const text = "qv[]?ocladpwsrtu";
        await setup.mockInput.typeText(text);
        await setup.flush();
        expect(value.getSnapshot().view).toBe(view);
        expect(value.getSnapshot().modal).toBeNull();
        expect(quit).toBe(0);
        const state = value.getSnapshot();
        const input =
          view === "search"
            ? state.codeSearchPage?.pattern
            : view === "discover"
              ? state.discoverPage?.query
              : state.runConsole?.command;
        expect(input).toBe(text);
      } finally {
        await setup.dispose();
      }
    });

  for (const [name, modal] of [
    ["clone", { type: "clone" }],
    ["move", { type: "move", key: "acme/api" }],
    ["alias", { type: "alias", key: "acme/api", prefill: "" }],
    ["root", { type: "root", effective: "/tmp", fromOverride: false }],
    ["workspaceAdd", { type: "workspaceAdd" }],
    ["search", { type: "search", initial: "" }],
    [
      "create-name",
      { type: "create", step: "name", draft: { name: "", path: "", isPrivate: true } },
    ],
    ["permanent-delete", { type: "confirmPermanentDelete", key: "acme/api" }],
    ["omnibar", { type: "omnibar", mode: "commands", query: "" }],
  ] as Array<[string, ModalState]>)
    test(`[E58] editable ${name} modal isolates global shortcuts`, async () => {
      const f = fixture();
      await f.save();
      const value = store(f);
      await value.init();
      value.openModal(modal);
      let quits = 0;
      const setup = await testRender(
        <Dashboard
          store={value}
          onQuit={() => {
            quits++;
          }}
          onSuspendAndRun={async () => {}}
        />,
        { width: 110, height: 36 },
      );
      try {
        await setup.flush();
        const focused = setup.renderer.currentFocusedRenderable;
        expect(focused).toBeInstanceOf(InputRenderable);
        const initial = (focused as InputRenderable).value;
        await setup.mockInput.typeText("qv[]?@#!");
        await setup.flush();
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          `${initial}qv[]?@#!`,
        );
        expect(value.getSnapshot().view).toBe("cockpit");
        expect(value.getSnapshot().modal?.type).toBe(modal?.type);
        expect(quits).toBe(0);
        setup.mockInput.pressEscape();
        await waitUntil(() => value.getSnapshot().modal === null);
        await expect(
          (await import("../src/services/workspaceRegistry.ts")).readWorkspaceConfig(f.root, f.env),
        ).resolves.toMatchObject({ repos: f.config.repos });
      } finally {
        await setup.dispose();
      }
    });

  test("[E59] CJK, combining marks and emoji clamp by cells and keep graphemes intact", () => {
    expect(terminalWidth("漢字")).toBe(4);
    expect(terminalWidth("e\u0301")).toBe(1);
    expect(terminalWidth("👨‍👩‍👧‍👦")).toBe(2);
    for (const text of ["漢字とrepo", "ş🙂e\u0301repo", "👨‍👩‍👧‍👦🇹🇷long"])
      for (const width of [0, 1, 2, 3, 8]) {
        const result = clampBoxLine(text, width);
        expect(terminalWidth(result)).toBeLessThanOrEqual(width);
        expect(result).not.toMatch(/[\ud800-\udbff]$/u);
      }
    expect(clampBoxLine("e\u0301long", 3)).toBe("e\u0301l…");
  });

  test("[E60] repeated destructive confirmations perform a single delete", async () => {
    const f = fixture();
    await f.save();
    const pending = deferred<never>();
    let calls = 0;
    const value = store(
      f,
      storeDeps({
        deleteRepo: async () => {
          calls++;
          return await pending.promise;
        },
      }),
    );
    await value.init();
    value.openModal({ type: "confirmDelete", key: "acme/api", absPath: f.repoDir });
    const first = value.confirmDelete("acme/api");
    const second = value.confirmDelete("acme/api");
    await waitUntil(() => calls === 1);
    pending.resolve({ ok: true, config: f.config, message: "deleted" } as never);
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    let confirms = 0;
    value.confirmDialog({ title: "Once", message: "test" }, () => {
      confirms++;
    });
    value.resolveDialog(true);
    value.resolveDialog(true);
    expect(confirms).toBe(1);
  });

  for (const kind of ["discover", "status", "run"] as const)
    test(`[E61] old ${kind} completion cannot overwrite the switched workspace`, async () => {
      const f = fixture();
      await f.save();
      const b = workspaceFixture();
      fixtures.push(b);
      await writeWorkspaceConfig(b.root, b.config, f.env);
      const pending = deferred<never>();
      let started = false;
      const defaults = storeDeps();
      const value = store(
        f,
        storeDeps({
          github: (token, baseUrl) => ({
            ...defaults.github!(token, baseUrl),
            searchRepos: async () => {
              started = true;
              return pending.promise;
            },
          }),
          workspaceStatusFn: async () => {
            started = true;
            return pending.promise;
          },
          runInReposFn: async () => {
            started = true;
            return pending.promise;
          },
        }),
      );
      await value.init();
      let request: Promise<void>;
      if (kind === "discover") {
        value.updateDiscoverPage({ query: "old" });
        request = value.discoverSearch();
      } else if (kind === "status") request = value.refreshStatusMatrix(true);
      else {
        value.updateRunConsole({ command: "node --version", scope: "all" });
        request = value.runConsoleStart();
      }
      await waitUntil(() => started);
      await value.switchWorkspace(b.root);
      const snapshot = value.getSnapshot();
      pending.resolve(
        (kind === "discover"
          ? [{ name: "old-result" }]
          : kind === "status"
            ? { lastSync: "old-result", repos: [] }
            : { results: [], skipped: ["old-result"] }) as never,
      );
      await request;
      expect(value.root).toBe(b.root);
      expect(value.getSnapshot().discoverPage).toEqual(snapshot.discoverPage);
      expect(value.getSnapshot().statusMatrix).toEqual(snapshot.statusMatrix);
      expect(value.getSnapshot().runConsole).toEqual(snapshot.runConsole);
      expect(
        value.getSnapshot().statuses.some((status) => status.message?.includes("old-result")),
      ).toBe(false);
    });

  test("[E61] a late init cannot replace the active workspace identity", async () => {
    const f = fixture();
    await f.save();
    const b = workspaceFixture();
    fixtures.push(b);
    await writeWorkspaceConfig(b.root, b.config, f.env);
    const pending = deferred<string>();
    let calls = 0,
      waiting = false;
    const defaults = storeDeps();
    const value = store(
      f,
      storeDeps({
        github: (token, baseUrl) => ({
          ...defaults.github!(token, baseUrl),
          getUserLogin: async () => {
            if (calls++ === 0) {
              waiting = true;
              return pending.promise;
            }
            return "new-user";
          },
        }),
      }),
    );
    const first = value.init();
    await waitUntil(() => waiting);
    await value.switchWorkspace(b.root);
    pending.resolve("old-user");
    await first;
    expect(value.getSnapshot().userLogin).toBe("new-user");
    expect(value.root).toBe(b.root);
  });

  test("[E63] repeated capture installation and Store disposal release listeners and timers", () => {
    const baseline = [
      process.listenerCount("unhandledRejection"),
      process.listenerCount("uncaughtException"),
    ];
    for (let i = 0; i < 20; i++) {
      const stop = installRuntimeErrorCapture();
      expect(process.listenerCount("unhandledRejection")).toBe(baseline[0]! + 1);
      stop();
    }
    expect([
      process.listenerCount("unhandledRejection"),
      process.listenerCount("uncaughtException"),
    ]).toEqual(baseline);
    const stop = installRuntimeErrorCapture();
    const listener = process.listeners("uncaughtException").at(-1)!;
    listener(new Error("captured fixture"), "uncaughtException");
    stop();
    expect(diagSnapshot().at(-1)?.message).toContain("captured fixture");
    const f = fixture(),
      value = store(f);
    let calls = 0;
    value.subscribe(() => {
      calls++;
    });
    value.dispose();
    value.dispose();
    value.pushStatus("DONE", "test", "after disposal");
    expect(calls).toBe(0);
  });

  test("[E63] renderer startup failure disposes the Store and restores runtime listeners", async () => {
    const f = fixture();
    const baseline = process.listenerCount("uncaughtException");
    let disposed = 0;
    class FailingStore extends Store {
      constructor(root: string) {
        super(root, storeDeps());
        const original = this.dispose;
        this.dispose = () => {
          disposed++;
          original();
        };
      }
    }
    for (let i = 0; i < 3; i++)
      await expect(
        startTui(Dashboard, FailingStore, {
          resolveRoot: async () => f.root,
          createRenderer: async () => {
            throw new Error("renderer fixture failure");
          },
        }),
      ).rejects.toThrow("renderer fixture failure");
    expect(disposed).toBe(3);
    expect(process.listenerCount("uncaughtException")).toBe(baseline);
  });

  test("[E49] a cancelled login's late success cannot close or replace the second login", async () => {
    const f = fixture();
    await f.save();
    const old = deferred<never>(),
      current = deferred<never>();
    let calls = 0;
    const token = process.env.REPOTRUCK_TOKEN;
    delete process.env.REPOTRUCK_TOKEN;
    const value = store(
      f,
      storeDeps({
        beginDeviceLoginFn: async () => ({
          verificationUri: "https://github.com/login/device",
          userCode: ++calls === 1 ? "OLD" : "NEW",
          completion: calls === 1 ? old.promise : current.promise,
        }),
      }),
    );
    try {
      const first = value.startDeviceFlow();
      await waitUntil(() => value.getSnapshot().deviceFlow?.waiting === true);
      value.cancelDeviceFlow();
      const second = value.startDeviceFlow();
      await waitUntil(() => value.getSnapshot().deviceFlow?.userCode === "NEW");
      old.resolve({ token: "old-token", method: "device" } as never);
      await first;
      expect(value.getSnapshot().modal?.type).toBe("deviceFlow");
      expect(value.getSnapshot().deviceFlow?.userCode).toBe("NEW");
      current.resolve({ token: "new-token", method: "device" } as never);
      await second;
      expect(calls).toBe(2);
    } finally {
      if (token === undefined) delete process.env.REPOTRUCK_TOKEN;
      else process.env.REPOTRUCK_TOKEN = token;
    }
  });

  test("[E60] a stale dialog callback cannot confirm a newer dialog", () => {
    const f = fixture(),
      value = store(f);
    let first = 0,
      second = 0;
    value.confirmDialog({ title: "First", message: "first" }, () => {
      first++;
      value.confirmDialog({ title: "Second", message: "second" }, () => {
        second++;
      });
    });
    const oldDialog = value.getSnapshot().dialog;
    value.resolveDialog(true, oldDialog);
    value.resolveDialog(true, oldDialog);
    expect(first).toBe(1);
    expect(second).toBe(0);
    value.resolveDialog(false);
    expect(second).toBe(0);
  });

  test("[E64] denied/unavailable clipboard and oversized Unicode preserve exact fallback bytes", () => {
    for (const output of [
      {
        isTTY: false,
        write: () => {
          throw new Error("must not write");
        },
      },
      {
        isTTY: true,
        write: () => {
          throw new Error("denied");
        },
      },
    ]) {
      const result = copyText("test", "ş🙂\n漢字", output);
      expect(result.clipboard).toBe(false);
      expect(result.ok).toBe(true);
      expect(readFileSync(result.filePath!, "utf8")).toBe("ş🙂\n漢字");
      rmSync(path.dirname(result.filePath!), { recursive: true });
    }
    let sequence = "";
    const emitted = copyText("test", "hello", {
      isTTY: true,
      write: (text) => {
        sequence = text;
      },
    });
    expect(sequence).toContain("]52;");
    expect(emitted.message).toContain("unverified");
    const payload = "🙂".repeat(MAX_OSC52_BYTES);
    const large = copyText("large", payload, {
      isTTY: true,
      write: () => {
        throw new Error("oversized OSC must not be emitted");
      },
    });
    expect(large.clipboard).toBe(false);
    expect(readFileSync(large.filePath!, "utf8")).toBe(payload);
    rmSync(path.dirname(large.filePath!), { recursive: true });
  });

  test("[E73/E59] About opens through v,o and menu; description and GitHub survive resize", async () => {
    const f = fixture();
    await f.save();
    const value = store(f);
    await value.init();
    const setup = await testRender(
      <Dashboard store={value} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 110, height: 32 },
    );
    try {
      await setup.flush();
      await setup.mockInput.pressKey("v");
      await setup.mockInput.pressKey("o");
      await setup.flush();
      expect(value.getSnapshot().view).toBe("about");
      const frame = setup.captureCharFrame();
      expect(frame).toContain(APP_DESCRIPTION);
      expect(frame).toContain(APP_GITHUB_URL);
      for (const [width, height] of [
        [40, 20],
        [160, 44],
        [80, 24],
      ]) {
        setup.resize(width!, height!);
        await setup.flush();
        expect(setup.captureCharFrame()).toContain("Repotruck");
      }
      await setup.mockInput.pressEscape();
      await waitUntil(() => value.getSnapshot().view === "cockpit");
      await setup.flush();
      expect(value.getSnapshot().view).toBe("cockpit");
      value.setNavFocused(true);
      value.setNavCursor(
        (await import("../src/components/views/viewRegistry.ts")).VIEW_ORDER.indexOf("about"),
      );
      value.activateNavRow();
      await setup.flush();
      expect(value.getSnapshot().view).toBe("about");
    } finally {
      await setup.dispose();
    }
  });
});
