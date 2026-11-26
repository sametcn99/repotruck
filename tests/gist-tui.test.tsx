import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store } from "../src/components/store.ts";
import { gistPath } from "../src/services/gistGit.ts";
import { CREATED_ID, gistApiFixture, PUBLIC_ID, SECRET_ID } from "./helpers/gists.ts";
import { storeDeps, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

test("Gists keyboard workflow edits and creates multiline files, opens local copies, and confirms deletion", async () => {
  const fixture = workspaceFixture();
  const previous = process.env.REPOTRUCK_CONFIG_DIR;
  process.env.REPOTRUCK_CONFIG_DIR = fixture.configDir;
  const { github, requests, items } = gistApiFixture();
  const opened: { cwd: string; args: readonly string[] }[] = [];
  const store = new Store(
    fixture.root,
    storeDeps({
      github: () => github,
      resolveAppFn: async (name) => ({ name, command: "editor", args: ["{repoDir}"] }),
      spawnImpl: async (request) => {
        opened.push(request);
        return 0;
      },
    }),
  );
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  const directory = gistPath(fixture.root, SECRET_ID);
  try {
    fixture.config.gists = [{ id: SECRET_ID }];
    await fixture.save();
    mkdirSync(directory, { recursive: true });
    mkdirSync(gistPath(fixture.root, CREATED_ID), { recursive: true });
    const git = simpleGit(directory);
    await git.init();
    await git.addRemote("origin", `https://gist.github.com/${SECRET_ID}.git`);
    writeFileSync(path.join(directory, "keep.txt"), "keep\n");
    await store.init();
    setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 110, height: 34, exitOnCtrlC: false, kittyKeyboard: true },
    );
    const renderer = setup;
    const keys = renderer.mockInput;
    const settle = () => settleRender(renderer);
    async function waitFrame(marker: string) {
      for (let i = 0; i < 28; i++) {
        await settle();
        if (renderer.captureCharFrame().includes(marker)) return;
      }
      throw new Error(`Expected frame to show ${marker}:\n${renderer.captureCharFrame()}`);
    }

    keys.pressKey("v");
    keys.pressKey("j");
    await waitFrame("Public notes");
    expect(store.getSnapshot().view).toBe("gists");
    keys.pressKey(" ");
    await waitFrame("1 selected");
    keys.pressKey(" ");
    keys.pressKey("/");
    await waitFrame("Search Gists");
    await keys.typeText("Secret");
    keys.pressEnter();
    await waitFrame("1 Gists");
    expect(renderer.captureCharFrame()).not.toContain("Public notes");

    keys.pressEnter();
    await waitFrame("second line");
    keys.pressEscape();
    await waitFrame("1 Gists");
    keys.pressKey("o");
    await waitFrame("Editor or app name");
    keys.pressEnter();
    await waitFrame("Opened in vscode");
    expect(opened).toMatchObject([{ cwd: directory, args: [directory] }]);

    keys.pressKey("e");
    await waitFrame("Edit Gist on GitHub");
    keys.pressKey("n", { ctrl: true });
    await waitFrame("File 2/2");
    await keys.typeText("extra.md");
    keys.pressTab();
    await settle();
    await keys.typeText("first");
    keys.pressEnter();
    await keys.typeText("second");
    keys.pressKey("s", { ctrl: true });
    await waitFrame("Saved on GitHub");
    expect(items.get(SECRET_ID)?.files["extra.md"]?.content).toBe("first\nsecond");

    keys.pressKey("n");
    await waitFrame("Create GitHub Gist");
    keys.pressKey("p", { ctrl: true });
    await waitFrame("Public · anyone can find it");
    keys.pressKey("p", { ctrl: true });
    await waitFrame("Secret · anyone with the link");
    await keys.typeText("Created from terminal");
    keys.pressTab();
    await settle();
    await keys.typeText("created.md");
    keys.pressTab();
    await settle();
    await keys.typeText("one");
    keys.pressEnter();
    await keys.typeText("two");
    keys.pressKey("s", { ctrl: true });
    await waitFrame("clone failed");
    expect(items.get(CREATED_ID)?.files["created.md"]?.content).toBe("one\ntwo");
    expect(items.get(CREATED_ID)?.public).toBe(false);

    keys.pressKey("e");
    await waitFrame("Edit Gist on GitHub");
    keys.pressEscape();
    await waitFrame("1 Gists");
    keys.pressKey("d");
    await waitFrame("permanently from GitHub");
    keys.pressEscape();
    await waitFrame("1 Gists");
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
    keys.pressKey("d");
    await waitFrame("permanently from GitHub");
    keys.pressEnter();
    await waitFrame("Deleted from GitHub");
    expect(items.has(SECRET_ID)).toBe(false);
    expect((await store.gistService().list(true))[0]?.local).toBe("dirty");
    keys.pressEscape();
    await waitFrame("Repositories");
    expect(store.getSnapshot().view).toBe("cockpit");
    expect(items.has(PUBLIC_ID)).toBe(true);
  } finally {
    setup?.renderer.destroy();
    store.dispose();
    if (previous === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
    else process.env.REPOTRUCK_CONFIG_DIR = previous;
    fixture.cleanup();
  }
}, 18000);

test("Cockpit and Sync Center show Gist inclusion and sync a workspace with zero selected repositories", async () => {
  const fixture = workspaceFixture();
  const previous = process.env.REPOTRUCK_CONFIG_DIR;
  process.env.REPOTRUCK_CONFIG_DIR = fixture.configDir;
  const { github, requests } = gistApiFixture([]);
  const store = new Store(fixture.root, storeDeps({ github: () => github }));
  let setup: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    await store.init();
    setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 115, height: 34, exitOnCtrlC: false },
    );
    const renderer = setup;
    const keys = renderer.mockInput;
    keys.pressEnter();
    await settleRender(renderer);
    expect(renderer.captureCharFrame()).toContain("Include Gists: on");
    keys.pressKey("g");
    await settleRender(renderer);
    expect(renderer.captureCharFrame()).toContain("Include Gists: off");
    keys.pressKey("g");
    keys.pressEnter();
    for (let i = 0; i < 20 && store.getSnapshot().running; i++) await settleRender(renderer);
    expect(store.getSnapshot().running).toBe(false);
    expect(
      store.getSnapshot().statuses.some(({ message }) => message?.includes("Gists: 0 synced")),
    ).toBe(true);
    expect(requests.filter(({ route }) => route === "/gists")).toHaveLength(1);

    store.setView("sync");
    store.updateSyncCenter({ scope: "user" });
    await settleRender(renderer);
    expect(renderer.captureCharFrame()).toContain("Include Gists: on");
    keys.pressKey("g");
    await settleRender(renderer);
    expect(renderer.captureCharFrame()).toContain("Include Gists: off");
    await store.startSyncCenter();
    expect(requests.filter(({ route }) => route === "/gists")).toHaveLength(1);
    keys.pressKey("g");
    await settleRender(renderer);
    await store.startSyncCenter();
    expect(requests.filter(({ route }) => route === "/gists")).toHaveLength(2);
  } finally {
    setup?.renderer.destroy();
    store.dispose();
    if (previous === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
    else process.env.REPOTRUCK_CONFIG_DIR = previous;
    fixture.cleanup();
  }
}, 15000);
