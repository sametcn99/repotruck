import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PresetTable } from "../src/components/PresetTable.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const EXPECTED_PATHS = [
  "monalisa/source/api",
  "community/acme/source/api",
  "monalisa/api",
  "community/acme/api",
  "monalisa/TypeScript/web",
  "community/acme/Go/service",
  "TypeScript/monalisa/api",
  "community/Go/acme/service",
  "source/monalisa/api",
  "community/forks/acme/left-pad",
  "monalisa/source/TypeScript/api",
  "community/acme/forks/Go/cli",
  "api",
  "community/service",
  "source/api",
  "community/forks/left-pad",
  "TypeScript/api",
  "source/TypeScript/api",
  "community/forks/JavaScript/left-pad",
  "TypeScript/source/api",
  "community/Go/source/service",
  "monalisa/TypeScript/source/api",
  "community/acme/Go/source/service",
  "source/monalisa/TypeScript/api",
  "community/forks/acme/JavaScript/left-pad",
  "source/TypeScript/monalisa/api",
  "community/source/Go/acme/service",
  "TypeScript/monalisa/source/api",
  "TypeScript/source/monalisa/api",
  "community/Go/source/acme/service",
];

suite("PresetTable", () => {
  test("renders every preset row with internal and community paths", () => {
    render(<PresetTable />);
    for (const preset of [
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
    ]) {
      expect(screen.getByText(preset)).toBeInTheDocument();
    }
    for (const path of EXPECTED_PATHS) {
      expect(screen.getAllByText(path).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("every community example is prefixed with community/", () => {
    render(<PresetTable />);
    for (const path of EXPECTED_PATHS.filter((item) => item.includes("community/"))) {
      expect(path.startsWith("community/")).toBe(true);
      expect(screen.getAllByText(path).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("documents custom presets built from the segment tokens", () => {
    render(<PresetTable />);
    const note = screen.getByText(/four segment tokens/);
    expect(note.textContent).toContain("repotruck preset add lang-owner language owner name");
    for (const token of ["owner", "category", "language", "name"]) {
      expect(note.textContent).toContain(token);
    }
    expect(note.textContent).toContain("repotruck preset list");
    expect(note.textContent).toContain("repotruck preset remove");
  });
});
