import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ChangelogSection } from "../src/components/ChangelogSection.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const ENTRY_TITLES: readonly string[] = [
  "Unreleased: Security hardening and CLI surface completion",
  "Sprint 8: Website docs and changelog parity",
  "Sprint 7: Core libraries",
  "Sprint 6: Authentication, GHE, platform and CLI wiring",
  "Sprint 5: MCP expansion and HTTP transport",
  "Sprint 4: TUI accessibility and modal flows",
  "Sprint 3: Repository lifecycle",
  "Sprint 2: Sync engine hardening",
  "Sprint 1: Stabilization and release blockers",
  "0.1.0: Initial baseline",
];

const ENTRY_HASHES: readonly string[] = [
  "743d478",
  "c828991",
  "9f40f0f",
  "c35c911",
  "e0081fc",
  "62e8b7b",
  "1e4189d",
  "720c5e1",
  "0c8587f",
];

suite("changelog section", () => {
  test("renders the heading and badge note", () => {
    render(<ChangelogSection />);
    expect(screen.getByRole("heading", { level: 2, name: "Changelog" })).toBeInTheDocument();
    expect(screen.getByText(/one entry per sprint commit/i)).toBeInTheDocument();
    expect(screen.getByText(/unreleased working tree/i)).toBeInTheDocument();
  });

  test("shows the npm version badge with an accessible name", () => {
    render(<ChangelogSection />);
    const badge = screen.getByAltText(/repotruck package version on npm/i);
    expect(badge).toHaveAttribute("src", "https://img.shields.io/npm/v/repotruck.svg");
    expect(badge.closest("a")).toHaveAttribute("href", "https://www.npmjs.com/package/repotruck");
  });

  test("lists entries newest first, sprint 7 and 8 included", () => {
    render(<ChangelogSection />);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(ENTRY_TITLES);
  });

  test("marks the current sprint as unreleased without a commit link", () => {
    render(<ChangelogSection />);
    const marker = screen.getByText("unreleased");
    expect(marker.tagName).not.toBe("A");
    expect(marker.closest("a")).toBeNull();
  });

  test("links every sprint entry to its commit on GitHub", () => {
    render(<ChangelogSection />);
    for (const hash of ENTRY_HASHES) {
      const link = screen.getByText(hash);
      expect(link).toHaveAttribute("href", `https://github.com/sametcn99/repotruck/commit/${hash}`);
    }
  });

  test("covers the current sprint highlights", () => {
    const { container } = render(<ChangelogSection />);
    const text = container.textContent ?? "";
    for (const phrase of [
      "GIT_CONFIG_*",
      "repotruck preset add",
      "backup list/restore",
      "sync --watch",
      "doctor --fix",
      "config unset",
      "PowerShell completions",
      "25 total",
      "keeps and reports unclear answers",
      "ModalShell/SelectList refactor",
    ]) {
      expect(text, `missing highlight: ${phrase}`).toContain(phrase);
    }
  });

  test("covers the sprint 7 and sprint 8 highlights", () => {
    const { container } = render(<ChangelogSection />);
    const text = container.textContent ?? "";
    for (const phrase of [
      "Tree-sitter symbol search",
      "parallel shell command execution",
      "Docs and changelog subpages",
      "CLI reference expanded to every committed command",
    ]) {
      expect(text, `missing highlight: ${phrase}`).toContain(phrase);
    }
  });
});
