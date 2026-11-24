import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { InputRenderable } from "@opentui/core";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store } from "../src/components/store.ts";
import { VIEW_ORDER } from "../src/components/views/viewRegistry.ts";
import { inventoryEntry, storeDeps, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const previousConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
const compactSizes = [
  [58, 18],
  [40, 20],
  [120, 36],
] as const;

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (previousConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = previousConfigDir;
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

async function makeWorkspace(withManyRepos = false) {
  const fixture = workspaceFixture();
  fixtures.push(fixture);
  process.env.REPOTRUCK_CONFIG_DIR = fixture.configDir;
  if (withManyRepos) {
    fixture.config.repos = Array.from({ length: 30 }, (_, index) => {
      const name = `repo-${String(index + 1).padStart(2, "0")}`;
      const relativePath = `acme/source/${name}`;
      mkdirSync(path.join(fixture.root, relativePath), { recursive: true });
      return { ...inventoryEntry(relativePath), name };
    });
    await fixture.save();
  }
  const store = new Store(fixture.root, storeDeps());
  stores.push(store);
  return store;
}

describe("acceptance terminal resize matrix", () => {
  test("keeps modal editing and shell navigation usable across standard and compact sizes", async () => {
    const store = await makeWorkspace();
    await store.init();
    store.openSearchModal();
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 36, exitOnCtrlC: false, kittyKeyboard: true },
    );
    try {
      await settleRender(setup);
      expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
      await setup.mockInput.typeText("resize-query");
      await settleRender(setup);
      for (const [width, height] of compactSizes) {
        setup.resize(width, height);
        await settleRender(setup);
        expect(store.getSnapshot().modal?.type).toBe("search");
        expect(setup.renderer.currentFocusedRenderable).toBeInstanceOf(InputRenderable);
        expect((setup.renderer.currentFocusedRenderable as InputRenderable).value).toBe(
          "resize-query",
        );
        expect(setup.captureCharFrame()).toContain("Search");
      }

      await setup.mockInput.pressEscape();
      await settleRender(setup);
      expect(store.getSnapshot().modal).toBeNull();
      store.setFocus("list");
      store.setCursor(0);
      // The menu's keyboard activation still routes to the selected page after
      // the same compact -> narrow -> full resize sequence.
      setup.mockInput.pressKey("F10");
      await settleRender(setup);
      expect(store.getSnapshot().navFocused).toBe(true);
      store.setNavCursor(VIEW_ORDER.indexOf("search"));
      await settleRender(setup);
      for (const [width, height] of compactSizes) {
        setup.resize(width, height);
        await settleRender(setup);
        expect(store.getSnapshot().navFocused).toBe(true);
        expect(setup.captureCharFrame()).toContain("Views");
      }
      setup.mockInput.pressKey("RETURN");
      await settleRender(setup);
      expect(store.getSnapshot().navFocused).toBe(false);
      expect(store.getSnapshot().view).toBe("search");
    } finally {
      await setup.dispose();
    }
  });

  test("preserves list selection and scroll window through 120×36 → 58×18 → 40×20 → 120×36", async () => {
    const store = await makeWorkspace(true);
    await store.init();
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 36, exitOnCtrlC: false, kittyKeyboard: true },
    );
    try {
      await settleRender(setup);
      store.setFocus("list");
      store.setCursor(20);
      await settleRender(setup);
      expect(setup.captureCharFrame()).toContain("repo-21");
      for (const [width, height] of compactSizes) {
        setup.resize(width, height);
        await settleRender(setup);
        expect(store.getSnapshot().cursor).toBe(20);
        expect(store.getSnapshot().filteredRepos[20]?.name).toBe("repo-21");
        expect(setup.captureCharFrame()).toContain("repo-21");
        setup.mockInput.pressKey("ARROW_DOWN");
        await settleRender(setup);
        expect(store.getSnapshot().cursor).toBe(21);
        store.setCursor(20);
      }
    } finally {
      await setup.dispose();
    }
  });
});
