import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import type { FlagSpec } from "../src/commands/registry.ts";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import {
  buildCliArguments,
  defaultFieldValues,
  FieldGroup,
  type FieldValues,
  formatFieldLine,
} from "../src/components/ui/FieldGroup.tsx";
import { copyJson, copyText } from "../src/components/ui/JsonCopy.ts";
import { renderMarkdownLines } from "../src/components/ui/MarkdownPane.tsx";
import { TableView } from "../src/components/ui/TableView.tsx";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  activateTheme("default");
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const FLAGS: readonly FlagSpec[] = [
  { flag: "--blobless", type: "bool", summary: "blobless", tui: "toggle" },
  {
    flag: "--divergence",
    type: "enum",
    values: ["fail", "rebase", "reset", "skip"],
    default: "fail",
    summary: "strategy",
    tui: "enum",
  },
  { flag: "--depth", type: "optional-int", summary: "depth", tui: "stepper" },
  { flag: "--exclude", type: "list", summary: "exclude", tui: "list editor" },
  { flag: "--profile", type: "string", summary: "profile", tui: "field" },
  {
    flag: "--concurrency",
    short: "-c",
    type: "int",
    default: "3",
    summary: "jobs",
    tui: "stepper",
  },
];

function withMockedStdout<T>(
  opts: { isTTY: boolean; writeThrow?: boolean },
  fn: (written: string[]) => T,
): T {
  const origDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const origWrite = process.stdout.write.bind(process.stdout);
  const written: string[] = [];
  Object.defineProperty(process.stdout, "isTTY", {
    value: opts.isTTY,
    configurable: true,
    writable: true,
  });
  (process.stdout as { write: (...args: unknown[]) => boolean }).write = (chunk: unknown) => {
    if (opts.writeThrow) throw new Error("stdout write failed");
    written.push(String(chunk));
    return true;
  };
  try {
    return fn(written);
  } finally {
    process.stdout.write = origWrite;
    if (origDesc) Object.defineProperty(process.stdout, "isTTY", origDesc);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

function FieldGroupHarness({ changes }: { changes: Array<[string, boolean | string]> }) {
  const [vals, setVals] = useState<FieldValues>(() => defaultFieldValues(FLAGS));
  return (
    <FieldGroup
      flags={FLAGS}
      values={vals}
      onChange={(flag, val) => {
        changes.push([flag, val]);
        setVals((prev) => ({ ...prev, [flag]: val }));
      }}
      width={60}
    />
  );
}

describe("FieldGroup helpers & component", () => {
  test("defaults come from the flag specs", () => {
    const values = defaultFieldValues(FLAGS);
    expect(values["--blobless"]).toBe(false);
    expect(values["--divergence"]).toBe("fail");
    expect(values["--depth"]).toBe("");
  });

  test("formatFieldLine renders per control type", () => {
    expect(formatFieldLine("--blobless", FLAGS[0]!, false, false, 60)).toContain("[ ]");
    expect(formatFieldLine("--blobless", FLAGS[0]!, true, true, 60)).toContain("[x]");
    expect(formatFieldLine("--divergence", FLAGS[1]!, "rebase", false, 60)).toContain(
      "rebase (< >)",
    );
    expect(formatFieldLine("--depth", FLAGS[2]!, "", false, 60)).toContain("off (+)");
    expect(formatFieldLine("--depth", FLAGS[2]!, "5", false, 60)).toContain("[5]");
    expect(formatFieldLine("--concurrency", FLAGS[5]!, "3", false, 60)).toContain("[3] (− +)");
    expect(formatFieldLine("--exclude", FLAGS[3]!, "", false, 60)).toContain("— (enter to edit)");
    expect(formatFieldLine("--exclude", FLAGS[3]!, "a/*", false, 60)).toContain("a/* (edit)");
    expect(formatFieldLine("--profile", FLAGS[4]!, "", false, 12)).toContain("…");
  });

  test("buildCliArguments skips defaults and serializes lists", () => {
    const values = defaultFieldValues(FLAGS);
    values["--blobless"] = true;
    values["--depth"] = "1";
    values["--exclude"] = "fork/*, archived/*";
    const cli = buildCliArguments("repotruck sync", FLAGS, values, ["extra"]);
    expect(cli).toContain("repotruck sync extra");
    expect(cli).toContain("--blobless");
    expect(cli).toContain("--depth 1");
    expect(cli).toContain("--exclude 'fork/*'");
    expect(cli).toContain("--exclude 'archived/*'");
    // divergence stays at its default and must not appear
    expect(cli).not.toContain("--divergence");
  });

  test("FieldGroup handles keyboard navigation, toggles, enums, steppers, and inline edit", async () => {
    const changes: Array<[string, boolean | string]> = [];
    const setup = await testRender(<FieldGroupHarness changes={changes} />, {
      width: 60,
      height: 16,
      exitOnCtrlC: false,
    });
    await setup.flush({ maxPasses: 4 });

    const run = async (fn: () => void | Promise<void>) => {
      await act(async () => {
        await fn();
      });
      await setup.flush({ maxPasses: 4 });
    };

    // Row 0: --blobless (bool) -> space toggles, left sets false, right sets true
    await run(() => setup.mockInput.pressKey(" "));
    await run(() => setup.mockInput.pressArrow("left"));
    await run(() => setup.mockInput.pressArrow("right"));
    // Row 1: --divergence (enum) -> arrow down, right/left cycle
    await run(() => setup.mockInput.pressArrow("down"));
    await run(() => setup.mockInput.pressArrow("right"));
    await run(() => setup.mockInput.pressArrow("left"));
    // Row 2: --depth (optional-int) -> arrow down, right -> 1, right -> 2, left -> 1, left -> ""
    await run(() => setup.mockInput.pressArrow("down"));
    await run(() => setup.mockInput.pressArrow("right"));
    await run(() => setup.mockInput.pressArrow("right"));
    await run(() => setup.mockInput.pressArrow("left"));
    await run(() => setup.mockInput.pressArrow("left"));
    // Row 3: --exclude (list) -> arrow down, enter opens input, type and submit
    await run(() => setup.mockInput.pressArrow("down"));
    await run(() => setup.mockInput.pressEnter());
    await run(() => setup.mockInput.typeText("a/*"));
    await run(() => setup.mockInput.pressEnter());
    // Row 4: --profile (string) -> arrow down, space opens edit, type and submit
    await run(() => setup.mockInput.pressArrow("down"));
    await run(() => setup.mockInput.pressKey(" "));
    await run(() => setup.mockInput.typeText("work"));
    await run(() => setup.mockInput.pressEnter());
    // Row 5: --concurrency (int) -> arrow down, right -> 4, left -> 3, up wraps
    await run(() => setup.mockInput.pressArrow("down"));
    await run(() => setup.mockInput.pressArrow("right"));
    await run(() => setup.mockInput.pressArrow("left"));
    await run(() => setup.mockInput.pressArrow("up"));

    expect(changes).toContainEqual(["--blobless", true]);
    expect(changes).toContainEqual(["--blobless", false]);
    expect(changes).toContainEqual(["--divergence", "rebase"]);
    expect(changes).toContainEqual(["--divergence", "fail"]);
    expect(changes).toContainEqual(["--depth", "1"]);
    expect(changes).toContainEqual(["--depth", "2"]);
    expect(changes).toContainEqual(["--depth", ""]);
    expect(changes).toContainEqual(["--exclude", "a/*"]);
    expect(changes).toContainEqual(["--profile", "work"]);
    expect(changes).toContainEqual(["--concurrency", "4"]);
    expect(changes).toContainEqual(["--concurrency", "3"]);
    await setup.dispose();
  });
});

describe("MarkdownPane", () => {
  test("headings accent, code dims, bullets survive", () => {
    const lines = renderMarkdownLines("## Title\n- bullet item\n```\ncode line\n```\nplain", 60);
    expect(lines[0]?.fg).toBeDefined();
    expect(lines[0]?.text).toContain("Title");
    expect(lines[1]?.text).toContain("- bullet item");
    expect(lines[3]?.fg).toBeDefined();
    expect(lines[4]?.fg).toBeDefined();
    expect(lines[5]?.text).toBe("plain");
  });
});

describe("JsonCopy", () => {
  test("non-TTY falls back to a temp file", () => {
    const result = withMockedStdout({ isTTY: false }, () =>
      copyJson("status", { ok: true, repos: [] }),
    );
    expect(result.ok).toBe(true);
    expect(result.clipboard).toBe(false);
    expect(result.filePath).not.toBeNull();
    const written = JSON.parse(readFileSync(result.filePath!, "utf8"));
    expect(written.ok).toBe(true);
    expect(result.message).toContain("status JSON");
  });

  test("TTY emits OSC 52 sequence without temp file, and writeFile writes both", () => {
    const resClipboard = withMockedStdout({ isTTY: true }, (out) => {
      const r = copyJson("status", { a: 1 });
      expect(out.length).toBe(1);
      expect(out[0]).toContain("\x1b]52;c;");
      return r;
    });
    expect(resClipboard.ok).toBe(true);
    expect(resClipboard.clipboard).toBe(true);
    expect(resClipboard.filePath).toBeNull();

    const resBoth = withMockedStdout({ isTTY: true }, () => copyJson("status", { a: 1 }, true));
    expect(resBoth.ok).toBe(true);
    expect(resBoth.filePath).not.toBeNull();
    expect(resBoth.message).toContain("written to");

    // TTY write error falls back to file
    const resErr = withMockedStdout({ isTTY: true, writeThrow: true }, () =>
      copyJson("status", { a: 1 }),
    );
    expect(resErr.ok).toBe(true);
    expect(resErr.clipboard).toBe(false);
    expect(resErr.filePath).not.toBeNull();
  });

  test("copyText handles TTY OSC 52, write error fallback, and non-TTY temp file", () => {
    const ttyRes = withMockedStdout({ isTTY: true }, (out) => {
      const r = copyText("cmd", "repotruck sync");
      expect(out[0]).toContain("\x1b]52;c;");
      return r;
    });
    expect(ttyRes.ok).toBe(true);
    expect(ttyRes.clipboard).toBe(true);

    const nonTtyRes = withMockedStdout({ isTTY: false }, () => copyText("cmd", "repotruck sync"));
    expect(nonTtyRes.ok).toBe(true);
    expect(nonTtyRes.clipboard).toBe(false);
    expect(nonTtyRes.filePath).not.toBeNull();
    expect(readFileSync(nonTtyRes.filePath!, "utf8")).toBe("repotruck sync");

    const errRes = withMockedStdout({ isTTY: true, writeThrow: true }, () =>
      copyText("cmd", "repotruck sync"),
    );
    expect(errRes.ok).toBe(true);
    expect(errRes.clipboard).toBe(false);
  });
});

describe("TableView", () => {
  test("renders windowed rows with cursor marker and empty state", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      row: i,
      cells: [`repo-${i}`, i % 2 === 0 ? "clean" : "dirty"],
      detail: i % 2 === 0 ? undefined : ["  + src/main.ts"],
    }));
    const setup = await testRender(
      <TableView
        columns={[
          { key: "repo", label: "repo" },
          { key: "state", label: "state" },
        ]}
        rows={rows}
        cursor={25}
        onCursor={() => {}}
        expandedId={null}
        onToggleExpand={() => {}}
        viewportRows={5}
        width={60}
      />,
      { width: 60, height: 20, exitOnCtrlC: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    await setup.flush({ maxPasses: 4 });
    const frame = setup.captureCharFrame();
    expect(frame).toContain("repo-25");
    expect(frame).toContain("dirty");
    // windowed: early rows are outside the slice
    expect(frame).not.toContain("repo-0");
    await setup.dispose();

    const empty = await testRender(
      <TableView
        columns={[{ key: "repo", label: "repo" }]}
        rows={[]}
        cursor={0}
        onCursor={() => {}}
        expandedId={null}
        onToggleExpand={() => {}}
        viewportRows={5}
        width={40}
        emptyLabel="trash is empty"
      />,
      { width: 40, height: 10, exitOnCtrlC: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    await empty.flush({ maxPasses: 4 });
    expect(empty.captureCharFrame()).toContain("trash is empty");
    await empty.dispose();
  });
});

function makeRepo(owner: string, name: string) {
  return {
    owner,
    name,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("dialog layer", () => {
  function makeStore(): Store {
    const root = tempDir("rt-dialog-ws-");
    mkdirSync(path.join(root, "acme"), { recursive: true });
    writeFileSync(
      path.join(root, "repotruck.json"),
      JSON.stringify({ version: 1, root, preset: "categorized", repos: [], aliases: {} }),
      "utf8",
    );
    const deps: StoreDeps = {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: () => ({
        getUserLogin: async () => "u",
        getActiveOrgs: async () => [],
        listUserRepos: async () => [],
        listOrgRepos: async () => [],
        getRepo: async (owner: string, name: string) => makeRepo(owner, name),
        createRepo: async (name: string) => makeRepo("u", name),
      }),
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
      detectAppsFn: async () => [],
      resolveAppFn: async () => null,
      listWorkspacesFn: async () => [],
    };
    return new Store(root, deps);
  }

  test("confirmDialog resolves y/n and fires the callback once", () => {
    const store = makeStore();
    expect(store.getSnapshot().dialog).toBeNull();
    let confirmed = 0;
    store.confirmDialog(
      {
        title: "Empty trash",
        message: "3 entries, 65 MB freed",
        danger: true,
        confirmLabel: "Empty",
      },
      () => {
        confirmed += 1;
      },
    );
    const dialog = store.getSnapshot().dialog;
    expect(dialog?.title).toBe("Empty trash");
    expect(dialog?.danger).toBe(true);

    store.resolveDialog(false);
    expect(store.getSnapshot().dialog).toBeNull();
    expect(confirmed).toBe(0);

    store.confirmDialog({ title: "Restore", message: "ok" }, () => {
      confirmed += 1;
    });
    store.resolveDialog(true);
    expect(confirmed).toBe(1);
    // second resolve is a no-op (callback cleared)
    store.resolveDialog(true);
    expect(confirmed).toBe(1);
  });
});
