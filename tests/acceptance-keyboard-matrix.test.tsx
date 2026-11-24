import { afterEach, describe, expect, test } from "bun:test";
import { InputRenderable } from "@opentui/core";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { type ModalState, Store, type ViewId } from "../src/components/store.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { storeDeps, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const previousConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
const printableShellKeys = "qv[]?@#!";
const terminalSizes = [
  [58, 18],
  [40, 20],
  [120, 36],
] as const;

async function makeStore() {
  const fixture = workspaceFixture();
  fixtures.push(fixture);
  await fixture.save();
  process.env.REPOTRUCK_CONFIG_DIR = fixture.configDir;
  const store = new Store(fixture.root, storeDeps());
  stores.push(store);
  return { fixture, store };
}

async function mount(store: Store, width = 120, height = 36) {
  await store.init();
  const setup = await testRender(
    <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
    { width, height, exitOnCtrlC: false, kittyKeyboard: true },
  );
  await settleRender(setup);
  return setup;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (previousConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = previousConfigDir;
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

type RendererSetup = Awaited<ReturnType<typeof testRender>>;

// Complete logical inventory of current page/modal input modes: search-code,
// discover, run command/profile, profile name, preset ID, sync include/exclude,
// Settings defaultRoot/baseUrl; clone, move, permanent-delete name, worktree
// branch/path, create name/path/description/import directory, alias, default
// root, workspace add, search (also rendered by RepoList), four omnibar modes,
// plus FieldGroup positional URL/list/URL. FieldGroup does not enumerate every
// generated CLI option combination; its numeric stepper has a separate case.
const modalFields: Array<{
  name: string;
  modal: ModalState;
  view?: ViewId;
  prepare?: (setup: RendererSetup) => void;
  commandForm?: boolean;
  commandLabel?: string;
}> = [
  { name: "clone URL", modal: { type: "clone" } },
  { name: "move path", modal: { type: "move", key: "acme/api" } },
  {
    name: "permanent-delete confirmation name",
    modal: { type: "confirmPermanentDelete", key: "acme/api" },
  },
  {
    name: "worktree branch",
    modal: { type: "worktree", key: "acme/api", worktrees: [], loading: false, error: null },
  },
  {
    name: "worktree custom path",
    modal: { type: "worktree", key: "acme/api", worktrees: [], loading: false, error: null },
    prepare: (setup) => setup.mockInput.pressTab(),
  },
  {
    name: "create name",
    modal: { type: "create", step: "name", draft: { name: "", path: "", isPrivate: true } },
  },
  {
    name: "create path",
    modal: { type: "create", step: "path", draft: { name: "api", path: "", isPrivate: true } },
  },
  {
    name: "create description",
    modal: {
      type: "create",
      step: "description",
      draft: { name: "api", path: "acme/source/api", isPrivate: true },
    },
  },
  {
    name: "create import directory",
    modal: {
      type: "create",
      step: "source",
      draft: { name: "api", path: "", isPrivate: true, fromDir: "" },
    },
  },
  { name: "alias", modal: { type: "alias", key: "acme/api", prefill: "" } },
  { name: "default root", modal: { type: "root", effective: "/tmp", fromOverride: false } },
  { name: "add workspace", modal: { type: "workspaceAdd" } },
  { name: "SearchModal query", view: "search", modal: { type: "search", initial: "" } },
  { name: "cockpit RepoList filter", modal: { type: "search", initial: "" } },
  { name: "omnibar commands", modal: { type: "omnibar", mode: "commands", query: "" } },
  { name: "omnibar symbols", modal: { type: "omnibar", mode: "symbols", query: "" } },
  { name: "omnibar GitHub", modal: { type: "omnibar", mode: "github", query: "" } },
  { name: "omnibar runner", modal: { type: "omnibar", mode: "runner", query: "" } },
  {
    name: "command form positional URL",
    modal: { type: "commandForm", specId: "clone" },
    commandForm: true,
    commandLabel: "repotruck clone",
    prepare: (setup) => setup.mockInput.pressKey("RETURN"),
  },
  {
    name: "FieldGroup list editor (--include)",
    modal: { type: "commandForm", specId: "sync" },
    commandForm: true,
    commandLabel: "repotruck sync",
    prepare: (setup) => {
      for (let i = 0; i < 9; i += 1) setup.mockInput.pressKey("ARROW_DOWN");
      setup.mockInput.pressKey("RETURN");
    },
  },
  {
    name: "FieldGroup URL flag (--base-url)",
    modal: { type: "commandForm", specId: "sync" },
    commandForm: true,
    prepare: (setup) => {
      for (let i = 0; i < 12; i += 1) setup.mockInput.pressKey("ARROW_DOWN");
      setup.mockInput.pressKey("RETURN");
    },
    commandLabel: "repotruck sync",
  },
];

const pageFields: Array<{
  name: string;
  view: ViewId;
  prepare?: (setup: RendererSetup) => void;
}> = [
  { name: "code-search pattern", view: "search" },
  { name: "discover query", view: "discover" },
  { name: "run command", view: "run" },
  {
    name: "run profile",
    view: "run",
    prepare: (setup) => {
      setup.mockInput.pressEscape();
      setup.mockInput.pressKey("p");
    },
  },
  { name: "profile name", view: "profiles", prepare: (setup) => setup.mockInput.pressKey("n") },
  { name: "custom preset ID", view: "presets", prepare: (setup) => setup.mockInput.pressKey("a") },
  {
    name: "sync include filter",
    view: "sync",
    prepare: (setup) => setup.mockInput.pressKey("i"),
  },
  {
    name: "sync exclude filter",
    view: "sync",
    prepare: (setup) => setup.mockInput.pressKey("E"),
  },
  {
    name: "Settings defaultRoot",
    view: "settings",
    prepare: (setup) => {
      for (let i = 0; i < 6; i += 1) setup.mockInput.pressKey("ARROW_DOWN");
      setup.mockInput.pressKey("RETURN");
    },
  },
  {
    name: "Settings github.baseUrl",
    view: "settings",
    prepare: (setup) => {
      for (let i = 0; i < 5; i += 1) setup.mockInput.pressKey("ARROW_DOWN");
      setup.mockInput.pressKey("RETURN");
    },
  },
];

describe("acceptance keyboard matrix", () => {
  test.each(pageFields)(
    "page input preserves printable keys, shell shortcuts, and resize focus: $name",
    async ({ view, prepare }) => {
      const { store } = await makeStore();
      await store.init();
      store.setView(view);
      if (view === "sync") store.updateSyncCenter({});
      if (view === "run" && prepare !== undefined) store.updateRunConsole({ scope: "profile" });
      const setup = await testRender(
        <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
        { width: 120, height: 36, exitOnCtrlC: false, kittyKeyboard: true },
      );
      try {
        await settleRender(setup);
        prepare?.(setup);
        await settleRender(setup);
        expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
        await setup.mockInput.typeText(printableShellKeys);
        await settleRender(setup);
        let expectedValue = `${(setup.renderer.currentFocusedRenderable as InputRenderable).value}`;
        expect(expectedValue).toContain(printableShellKeys);

        for (const [width, height] of terminalSizes) {
          setup.resize(width, height);
          await settleRender(setup);
          expect(store.getSnapshot().view).toBe(view);
          expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
          expectedValue += "z";
          await setup.mockInput.typeText("z");
          await settleRender(setup);
          expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
            expectedValue,
          );
        }

        setup.mockInput.pressKey("k", { ctrl: true });
        await settleRender(setup);
        expect(store.getSnapshot().modal?.type).toBe("omnibar");
        setup.mockInput.pressEscape();
        await settleRender(setup);
        expect(store.getSnapshot().view).toBe(view);
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          expectedValue,
        );

        setup.mockInput.pressKey("F1");
        await settleRender(setup);
        expect(store.getSnapshot().modal?.type).toBe("help");
        setup.mockInput.pressEscape();
        await settleRender(setup);
        expect(store.getSnapshot().view).toBe(view);
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          expectedValue,
        );

        setup.mockInput.pressKey("F10");
        await settleRender(setup);
        expect(store.getSnapshot().navFocused).toBe(true);
        setup.mockInput.pressKey("F10");
        await settleRender(setup);
        expect(store.getSnapshot().navFocused).toBe(false);
        expect(store.getSnapshot().view).toBe(view);
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          expectedValue,
        );

        setup.mockInput.pressEscape();
        await settleRender(setup);
        expect(store.getSnapshot().view).toBe(view);
        expect(setup.renderer.currentFocusedRenderable).not.toBeInstanceOf(InputRenderable);
      } finally {
        await setup.dispose();
      }
    },
  );

  test.each(modalFields)(
    "modal input preserves printable keys and modal shortcut policy: $name",
    async ({ modal, view = "cockpit", commandForm, prepare, commandLabel }) => {
      const { store } = await makeStore();
      await store.init();
      store.setView(view);
      store.setModal(modal);
      const setup = await mount(store);
      try {
        prepare?.(setup);
        await settleRender(setup);
        const focused = setup.renderer.currentFocusedRenderable;
        expect(focused).toBeInstanceOf(InputRenderable);
        const input = focused as InputRenderable;
        const initialValue = input.value;
        await setup.mockInput.typeText(printableShellKeys);
        await settleRender(setup);
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          `${initialValue}${printableShellKeys}`,
        );
        expect(store.getSnapshot().modal?.type).toBe(modal?.type);

        let expectedValue = `${initialValue}${printableShellKeys}`;
        for (const [width, height] of terminalSizes) {
          setup.resize(width, height);
          await settleRender(setup);
          expect(store.getSnapshot().modal?.type).toBe(modal?.type);
          expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
          expectedValue += "z";
          await setup.mockInput.typeText("z");
          await settleRender(setup);
          expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
            expectedValue,
          );
        }

        // These advertised shell shortcuts remain governed by the active modal.
        await setup.mockInput.pressKey("k", { ctrl: true });
        await setup.mockInput.pressKey("F1");
        await setup.mockInput.pressKey("F10");
        await settleRender(setup);
        expect(store.getSnapshot().modal?.type).toBe(modal?.type);
        expect(store.getSnapshot().view).toBe(view);

        if (commandForm) {
          // Tab commits the FieldGroup's inline editor through its keyboard path.
          setup.mockInput.pressKey("tab");
          await settleRender(setup);
          expect(setup.captureCharFrame()).toContain(commandLabel ?? "");
          expect(setup.captureCharFrame()).toContain(printableShellKeys);
        } else {
          await setup.mockInput.pressEscape();
          await settleRender(setup);
          expect(store.getSnapshot().modal).toBeNull();
        }
      } finally {
        await setup.dispose();
      }
    },
  );

  test("search submit and create-wizard Enter invoke their rendered modal actions", async () => {
    const { store } = await makeStore();
    await store.init();
    store.openSearchModal();
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 36, exitOnCtrlC: false, kittyKeyboard: true },
    );
    try {
      await settleRender(setup);
      await setup.mockInput.typeText("api");
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(store.getSnapshot().search).toBe("api");
      expect(store.getSnapshot().modal).toBeNull();

      store.openCreateModal();
      await settleRender(setup);
      await setup.mockInput.typeText("new-repo");
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "source" });
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "org" });
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "path" });
      expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
    } finally {
      await setup.dispose();
    }
  });

  test("alias Save runs through the actual modal input and persisted workspace state", async () => {
    const { fixture, store } = await makeStore();
    await store.init();
    store.setModal({ type: "alias", key: "acme/api", prefill: "" });
    const setup = await mount(store);
    try {
      await setup.mockInput.typeText("api-short");
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      for (let i = 0; i < 30 && store.getSnapshot().modal !== null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(store.getSnapshot().modal).toBeNull();
      await expect(readWorkspaceConfig(fixture.root, fixture.env)).resolves.toMatchObject({
        aliases: { "api-short": "acme/source/api" },
      });
    } finally {
      await setup.dispose();
    }
  });

  test("FieldGroup numeric stepper changes the live CLI value through keyboard focus", async () => {
    const { store } = await makeStore();
    await store.init();
    store.openCommandForm("sync");
    const setup = await mount(store);
    try {
      // --concurrency is the fifth sync field (scope, pinned, profile, limit, concurrency).
      for (let i = 0; i < 4; i += 1) setup.mockInput.pressKey("ARROW_DOWN");
      await settleRender(setup);
      expect(setup.renderer.currentFocusedRenderable).not.toBeInstanceOf(InputRenderable);
      setup.mockInput.pressKey("ARROW_RIGHT");
      await settleRender(setup);
      expect(setup.captureCharFrame()).toContain("--concurrency 4");
      for (const [width, height] of terminalSizes) {
        setup.resize(width, height);
        await settleRender(setup);
        setup.mockInput.pressKey("ARROW_RIGHT");
        await settleRender(setup);
      }
      setup.resize(120, 36);
      await settleRender(setup);
      expect(setup.captureCharFrame()).toContain("--concurrency 7");
    } finally {
      await setup.dispose();
    }
  });

  test("command-form Escape cancels its active field editor and leaves the form open", async () => {
    const { store } = await makeStore();
    await store.init();
    store.openCommandForm("clone");
    const setup = await mount(store);
    try {
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
      await setup.mockInput.typeText("acme/api");
      await settleRender(setup);
      setup.mockInput.pressEscape();
      await settleRender(setup);
      expect(store.getSnapshot().modal?.type).toBe("commandForm");
      expect(setup.renderer.currentFocusedRenderable).not.toBeInstanceOf(InputRenderable);
    } finally {
      await setup.dispose();
    }
  });
});
