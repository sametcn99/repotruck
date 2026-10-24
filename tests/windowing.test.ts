import { describe, expect, test } from "bun:test";
import { buildFooterLines, buildHeaderLine } from "../src/components/Dashboard.tsx";
import {
  MIN_CENTER_COLUMNS,
  repoRowLabel,
  repoViewportRows,
  sidebarWidth,
  statusWidth,
  visibleSlice,
} from "../src/components/windowing.ts";

describe("repoViewportRows", () => {
  test("reserves chrome rows so the list never overflows its box", () => {
    expect(repoViewportRows(38, false)).toBe(29);
    expect(repoViewportRows(24, false)).toBe(15);
  });

  test("reserves three more rows while the update toast is visible", () => {
    expect(repoViewportRows(38, true)).toBe(26);
    expect(repoViewportRows(24, true)).toBe(12);
  });

  test("degrades to a single row on tiny terminals", () => {
    expect(repoViewportRows(7, false)).toBe(1);
    expect(repoViewportRows(1, true)).toBe(1);
  });
});

describe("visibleSlice", () => {
  test("returns the first window when the cursor is at the top", () => {
    expect(visibleSlice(0, 100, 10)).toEqual({ start: 0, end: 10 });
    expect(visibleSlice(5, 100, 10)).toEqual({ start: 0, end: 10 });
  });

  test("keeps the cursor inside the window as it moves down", () => {
    const window1 = visibleSlice(6, 100, 10);
    expect(window1.start).toBeLessThanOrEqual(6);
    expect(window1.end).toBeGreaterThan(6);
    const window2 = visibleSlice(9, 100, 10);
    expect(window2.start).toBeLessThanOrEqual(9);
    expect(window2.end).toBeGreaterThan(9);
  });

  test("pins the cursor at the last row when it reaches the end", () => {
    expect(visibleSlice(99, 100, 10)).toEqual({ start: 90, end: 100 });
    expect(visibleSlice(97, 100, 10)).toEqual({ start: 88, end: 98 });
  });

  test("viewport larger than total returns everything", () => {
    expect(visibleSlice(0, 5, 10)).toEqual({ start: 0, end: 5 });
    expect(visibleSlice(4, 5, 10)).toEqual({ start: 0, end: 5 });
  });

  test("viewport of one follows the cursor", () => {
    expect(visibleSlice(0, 5, 1)).toEqual({ start: 0, end: 1 });
    expect(visibleSlice(3, 5, 1)).toEqual({ start: 3, end: 4 });
    expect(visibleSlice(4, 5, 1)).toEqual({ start: 4, end: 5 });
  });

  test("empty list and zero viewport degrade safely", () => {
    expect(visibleSlice(0, 0, 10)).toEqual({ start: 0, end: 0 });
    expect(visibleSlice(3, 10, 0)).toEqual({ start: 0, end: 0 });
  });

  test("out-of-range cursors are clamped", () => {
    expect(visibleSlice(-5, 10, 3)).toEqual({ start: 0, end: 3 });
    expect(visibleSlice(50, 10, 3)).toEqual({ start: 7, end: 10 });
  });

  test("window always contains the clamped cursor", () => {
    for (let cursor = 0; cursor < 30; cursor += 1) {
      const { start, end } = visibleSlice(cursor, 30, 7);
      expect(start).toBeLessThanOrEqual(cursor);
      expect(end).toBeGreaterThanOrEqual(cursor + 1);
      expect(end - start).toBeLessThanOrEqual(7);
    }
  });
});

describe("repoRowLabel", () => {
  test("plain active repository shows the bare name", () => {
    expect(
      repoRowLabel({
        name: "api",
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: null,
      }),
    ).toBe("api");
  });

  test("badges render in contract order after the bare name", () => {
    expect(
      repoRowLabel({
        name: "api",
        isPrivate: true,
        isFork: true,
        isArchived: true,
        language: "Rust",
      }),
    ).toBe("api [Private] [Fork] [Archived] [Rust]");
  });

  test("empty language is omitted", () => {
    expect(
      repoRowLabel({
        name: "api",
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "",
      }),
    ).toBe("api");
  });
});

describe("panel widths", () => {
  test("keeps the center at least 20 columns across the whole sweep (T4')", () => {
    for (let tw = 40; tw <= 250; tw += 10) {
      expect(sidebarWidth(tw) + statusWidth(tw)).toBeLessThanOrEqual(tw - MIN_CENTER_COLUMNS);
    }
  });

  test("raw ratio values inside the clamp band", () => {
    expect(sidebarWidth(140)).toBe(30);
    expect(statusWidth(140)).toBe(42);
    expect(sidebarWidth(200)).toBe(44);
    expect(statusWidth(200)).toBe(60);
  });

  test("lower clamps engage on narrow terminals but still honor the invariant", () => {
    expect(sidebarWidth(100)).toBe(24);
    expect(statusWidth(100)).toBe(32);
    expect(sidebarWidth(40) + statusWidth(40)).toBeLessThanOrEqual(40 - MIN_CENTER_COLUMNS);
    expect(sidebarWidth(40)).toBeGreaterThanOrEqual(8);
    expect(statusWidth(40)).toBeGreaterThanOrEqual(8);
  });
});

describe("buildFooterLines", () => {
  test("never overflows terminal width across widths from 40 to 220", () => {
    for (let w = 40; w <= 220; w += 5) {
      const lines = buildFooterLines(w);
      expect(lines.length).toBe(1);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(Math.max(30, w - 4));
      }
    }
  });

  test("contains primary shortcuts on typical widths", () => {
    const lines = buildFooterLines(120);
    const combined = lines.join(" ");
    expect(combined).toContain("[Tab] Focus");
    expect(combined).toContain("[Space] Select");
    expect(combined).toContain("[?] Help");
    expect(combined).toContain("[q] Quit");
  });

  test("running summary replaces the shortcuts and is width-trimmed", () => {
    const lines = buildFooterLines(120, "working… · 2 cloning/pulling · 3 done · 1 failed");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("working…");
    expect(lines[0]).toContain("2 cloning/pulling");
    expect(lines[0]).not.toContain("[Tab] Focus");
    for (let w = 40; w <= 220; w += 5) {
      const trimmed = buildFooterLines(w, "x".repeat(300));
      expect(trimmed.length).toBe(1);
      expect(trimmed[0]!.length).toBeLessThanOrEqual(Math.max(30, w - 4));
    }
  });
});

describe("buildHeaderLine", () => {
  test("never overflows terminal width across widths from 40 to 220", () => {
    const header = `repotruck · monalisa (auth: gh-cli) · preset: categorized · root: ${"long/path/".repeat(20)} · 1234 repos`;
    for (let w = 40; w <= 220; w += 5) {
      const line = buildHeaderLine(w, header);
      expect(line.length).toBeLessThanOrEqual(Math.max(30, w - 4));
    }
  });

  test("passes short headers through untouched with a leading space", () => {
    expect(buildHeaderLine(120, "repotruck · monalisa")).toBe(" repotruck · monalisa");
  });

  test("trims long headers with a trailing ellipsis", () => {
    const line = buildHeaderLine(60, "x".repeat(300));
    expect(line.length).toBeLessThanOrEqual(Math.max(30, 60 - 4));
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("theme options", () => {
  test("resolveThemeName prefers env over settings and validates values", async () => {
    const theme = await import("../src/components/theme.ts");
    expect(theme.resolveThemeName(undefined, undefined)).toBe("default");
    expect(theme.resolveThemeName("light", undefined)).toBe("light");
    expect(theme.resolveThemeName("light", "contrast")).toBe("light");
    expect(theme.resolveThemeName(undefined, "contrast")).toBe("contrast");
    expect(theme.resolveThemeName("neon", "contrast")).toBe("contrast");
    expect(theme.resolveThemeName("neon", "nope")).toBe("default");
    expect(theme.isThemeName("light")).toBe(true);
    expect(theme.isThemeName("neon")).toBe(false);
    expect(theme.PALETTE.accent).toBe("#58a6ff");
  });
});
