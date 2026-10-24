import { describe, expect, test } from "bun:test";
import {
  buildPreviewTree,
  PREVIEW_TREE_CAP,
  type PreviewTreeEntry,
} from "../src/components/windowing.ts";

function entry(key: string, relPath: string, exists: boolean, custom?: boolean): PreviewTreeEntry {
  return custom === undefined ? { key, relPath, exists } : { key, relPath, exists, custom };
}

describe("buildPreviewTree", () => {
  test("a single new destination renders each segment with a clone marker", () => {
    expect(buildPreviewTree([entry("acme/api", "community/acme/api", false)])).toEqual([
      "└── community",
      "    └── acme",
      "        └── api [clone]",
    ]);
  });

  test("an existing destination is marked update", () => {
    expect(buildPreviewTree([entry("monalisa/api", "monalisa/source/api", true)])).toEqual([
      "└── monalisa",
      "    └── source",
      "        └── api [update]",
    ]);
  });

  test("multiple repos share directory nodes and sort alphabetically", () => {
    const lines = buildPreviewTree([
      entry("monalisa/web", "monalisa/source/web", false),
      entry("monalisa/api", "monalisa/source/api", true),
      entry("acme/api", "community/acme/api", false),
    ]);
    expect(lines).toEqual([
      "├── community",
      "│   └── acme",
      "│       └── api [clone]",
      "└── monalisa",
      "    └── source",
      "        ├── api [update]",
      "        └── web [clone]",
    ]);
  });

  test("siblings use ├── and the last sibling uses └── at every depth", () => {
    const lines = buildPreviewTree([
      entry("a/c", "r/a/c", false),
      entry("a/b", "r/b/c", false),
      entry("a/a", "r/a/d", true),
    ]);
    expect(lines).toEqual([
      "└── r",
      "    ├── a",
      "    │   ├── c [clone]",
      "    │   └── d [update]",
      "    └── b",
      "        └── c [clone]",
    ]);
  });

  test("custom entries are marked custom even when they exist", () => {
    expect(buildPreviewTree([entry("a/b", "custom/project", true, true)])).toEqual([
      "└── custom",
      "    └── project [custom]",
    ]);
  });

  test("sorting is case-insensitive and stable for equal lowercase names", () => {
    const lines = buildPreviewTree([
      entry("a/beta", "r/Beta", false),
      entry("a/alpha", "r/alpha", false),
      entry("a/Alpha2", "r/Alpha2", false),
    ]);
    expect(lines).toEqual([
      "└── r",
      "    ├── alpha [clone]",
      "    ├── Alpha2 [clone]",
      "    └── Beta [clone]",
    ]);
  });

  test("empty input renders no lines", () => {
    expect(buildPreviewTree([])).toEqual([]);
  });

  test("output is capped with an ... and N more tail", () => {
    const entries: PreviewTreeEntry[] = [];
    for (let i = 0; i < PREVIEW_TREE_CAP + 5; i += 1) {
      const name = `d${String(i).padStart(2, "0")}`;
      entries.push(entry(name, name, false));
    }
    const lines = buildPreviewTree(entries);
    expect(lines.length).toBe(PREVIEW_TREE_CAP + 1);
    expect(lines[PREVIEW_TREE_CAP]).toBe(`... and 5 more`);
    expect(lines[0]).toBe("├── d00 [clone]");
    expect(lines[PREVIEW_TREE_CAP - 1]).toBe("├── d39 [clone]");
  });

  test("output at exactly the cap has no tail", () => {
    const entries: PreviewTreeEntry[] = [];
    for (let i = 0; i < PREVIEW_TREE_CAP; i += 1) {
      const name = `d${String(i).padStart(2, "0")}`;
      entries.push(entry(name, name, true));
    }
    const lines = buildPreviewTree(entries);
    expect(lines.length).toBe(PREVIEW_TREE_CAP);
    expect(lines[lines.length - 1]).toBe("└── d39 [update]");
  });

  test("a destination that is a prefix of another keeps its marker on the shared node", () => {
    const lines = buildPreviewTree([
      entry("a/parent", "shared/parent", true),
      entry("a/child", "shared/parent/child", false),
    ]);
    expect(lines).toEqual(["└── shared", "    └── parent [update]", "        └── child [clone]"]);
  });
});
