import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { WorkspaceSkeleton } from "../src/components/WorkspaceSkeleton.tsx";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  process.env.REPOTRUCK_CONFIG_DIR = makeTempDir("repotruck-skeleton-cfg-");
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

// biome-ignore lint/suspicious/noExplicitAny: test-only cast
async function settle(setup: any): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await setup.flush();
}

function norm(frame: string): string {
  return frame.replace(
    /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/g,
    " ",
  );
}

describe("WorkspaceSkeleton", () => {
  test("renders all three panels with skeleton blocks on standard terminal", async () => {
    const setup = await testRender(
      <WorkspaceSkeleton width={100} height={30} preset="categorized" />,
      { width: 100, height: 30 },
    );
    try {
      await settle(setup);
      const frame = norm(setup.captureCharFrame());
      // Check for three panel titles
      expect(frame).toContain("Scope");
      expect(frame).toContain("Repositories");
      expect(frame).toContain("Status");

      // Scope section elements
      expect(frame).toContain("SCOPE");
      expect(frame).toContain("Personal repos");
      expect(frame).toContain("PRESET");
      expect(frame).toContain("categorized");
      expect(frame).toContain("FILTERS");

      // Repositories section elements
      expect(frame).toContain("Loading workspace\u2026");
      expect(frame).toContain("Discovering repositories\u2026");
      expect(frame).toContain("[ ]");
      expect(frame).toContain("\u2591");

      // Status section elements
      expect(frame).toContain("0 cloning \u00b7 0 pulling");
      expect(frame).toContain("\u00b7 0 failed");
      expect(frame).toContain("DISCOVERY");
      expect(frame).toContain("Authenticate GitHub");
      expect(frame).toContain("ACTIVITY");
    } finally {
      await setup.dispose();
    }
  });

  test("renders cleanly on narrow terminal without overflow", async () => {
    const setup = await testRender(<WorkspaceSkeleton width={50} height={20} preset="flat" />, {
      width: 50,
      height: 20,
    });
    try {
      await settle(setup);
      const frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Scope");
      expect(frame).toContain("Repositories");
      expect(frame).toContain("Status");
      expect(frame).toContain("Loading\u2026");
      expect(frame).toContain("flat");
    } finally {
      await setup.dispose();
    }
  });

  test("dashboard renders skeleton during loading phase", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    let resolveAuth: (value: any) => void = () => {};
    const pendingAuth = new Promise((resolve) => {
      resolveAuth = resolve;
    });

    const deps: StoreDeps = {
      // biome-ignore lint/suspicious/noExplicitAny: test-only cast
      auth: () => pendingAuth as any,
      // biome-ignore lint/suspicious/noExplicitAny: test-only cast
      github: () => ({}) as any,
      updater: async () => ({
        currentVersion: "0.1.0",
        latestVersion: null,
        updateAvailable: false,
      }),
      readUpdateStateFn: async () => ({
        lastCheck: null,
        latestVersion: null,
        dismissedVersion: null,
      }),
    };

    const store = new Store("dummy/root", deps);
    // Don't await init so it stays in loading phase
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 100, height: 30, exitOnCtrlC: false },
    );

    try {
      await settle(setup);
      expect(store.getSnapshot().phase).toBe("loading");
      const frame = norm(setup.captureCharFrame());
      expect(frame).toContain("repotruck");
      expect(frame).toContain("discovering\u2026");
      expect(frame).toContain("Loading workspace\u2026");
      expect(frame).toContain("Scope");
      expect(frame).toContain("Repositories");
      expect(frame).toContain("Status");
      expect(frame).toContain("Personal repos");
    } finally {
      resolveAuth({ token: "tok", method: "cached" });
      await setup.dispose();
    }
  });
});
