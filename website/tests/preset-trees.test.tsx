import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PresetTrees } from "../src/components/PresetTrees.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const PRESETS = [
  "categorized",
  "flat-by-owner",
  "topic-focused",
  "language-first",
  "category-first",
  "language-categorized",
  "flat",
  "category-flat",
  "language-flat",
  "category-language",
  "language-category",
  "owner-language-category",
  "category-owner-language",
  "category-language-owner",
  "language-owner-category",
  "language-category-owner",
] as const;

suite("PresetTrees", () => {
  test("renders a tree panel for every preset", () => {
    render(<PresetTrees />);
    for (const preset of PRESETS) {
      expect(screen.getByRole("group", { name: preset })).toBeInTheDocument();
    }
  });

  test("every tree files community repositories under community/", () => {
    render(<PresetTrees />);
    for (const preset of PRESETS) {
      const panel = screen.getByRole("group", { name: preset });
      expect(within(panel).getByText("community")).toBeInTheDocument();
      if (
        ![
          "flat",
          "category-flat",
          "language-flat",
          "category-language",
          "language-category",
        ].includes(preset)
      ) {
        expect(within(panel).getAllByText("acme").length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("trees show categories, languages and the other fallback", () => {
    render(<PresetTrees />);
    const categorized = screen.getByRole("group", { name: "categorized" });
    expect(within(categorized).getAllByText("source").length).toBe(2);
    expect(within(categorized).getByText("archived")).toBeInTheDocument();
    expect(within(categorized).getByText("forks")).toBeInTheDocument();

    const languageFirst = screen.getByRole("group", { name: "language-first" });
    expect(within(languageFirst).getByText("TypeScript")).toBeInTheDocument();
    expect(within(languageFirst).getByText("other")).toBeInTheDocument();

    const flat = screen.getByRole("group", { name: "flat-by-owner" });
    expect(within(flat).queryByText("source")).not.toBeInTheDocument();
    expect(within(flat).queryByText("archived")).not.toBeInTheDocument();
  });

  test("tree guides are hidden from assistive technology", () => {
    render(<PresetTrees />);
    const guides = document.querySelectorAll(".tree-guide");
    expect(guides.length).toBeGreaterThan(0);
    for (const guide of guides) {
      expect(guide).toHaveAttribute("aria-hidden", "true");
    }
  });
});
