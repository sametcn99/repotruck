import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import App from "../src/App.tsx";
import {
  COMMAND_GROUPS,
  DIVERGENCE_ROWS,
  GLOBAL_FLAGS,
  SETTING_ROWS,
} from "../src/components/CommandReference.ts";
import { PRESET_ROWS } from "../src/components/PresetTable.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const ALL_COMMAND_NAMES: readonly string[] = COMMAND_GROUPS.flatMap((group) =>
  group.commands.map((command) => command.name),
);

suite("command reference on the landing page", () => {
  test("renders the headless CLI section heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 2, name: "Headless CLI" })).toBeInTheDocument();
    expect(screen.getByText(/dashboard is optional/i)).toBeInTheDocument();
  });

  test("documents every committed CLI command exactly once", () => {
    expect(ALL_COMMAND_NAMES.length).toBe(27);
    expect(ALL_COMMAND_NAMES).toContain("preset");
    expect(ALL_COMMAND_NAMES).toContain("backup");
    expect(ALL_COMMAND_NAMES).toContain("scan");
    const { container } = render(<App />);
    const rendered = Array.from(
      container.querySelectorAll<HTMLElement>(".command-doc h3 code"),
    ).map((code) => code.textContent?.split(" ")[1]);
    expect(rendered).toEqual(ALL_COMMAND_NAMES);
  });

  test("shows usage, summary and at least one example per command", () => {
    const { container } = render(<App />);
    const renderedExamples = Array.from(
      container.querySelectorAll<HTMLSpanElement>(".cli-example .copy-command"),
    ).map((span) => span.textContent?.replace(/^\$\s/, "").trim());
    const renderedUsages = Array.from(
      container.querySelectorAll<HTMLElement>(".command-doc h3 code"),
    ).map((code) => code.textContent);
    for (const group of COMMAND_GROUPS) {
      for (const command of group.commands) {
        expect(renderedUsages, `missing usage: ${command.usage}`).toContain(command.usage);
        expect(screen.getByText(command.summary)).toBeInTheDocument();
        expect(renderedExamples, `missing example: ${command.examples[0]}`).toContain(
          command.examples[0],
        );
      }
    }
  });

  test("documents the sync flag surface and global flags", () => {
    render(<App />);
    for (const flag of [
      "-c, --concurrency <n>",
      "--depth <n>",
      "--blobless",
      "--stash",
      "--divergence <strategy>",
      "--include <glob>",
      "--exclude <glob>",
      "--watch [seconds]",
      ...GLOBAL_FLAGS.map((row) => row.flag),
    ]) {
      expect(screen.getAllByText(flag).length, `missing flag: ${flag}`).toBeGreaterThan(0);
    }
  });

  test("documents the new commands and their flag surface", () => {
    render(<App />);
    for (const flag of [
      "-r, --repo <ref>",
      "--fix",
      "--regex",
      "--clear",
      "--http",
      "--token <token>",
    ]) {
      expect(screen.getAllByText(flag).length, `missing flag: ${flag}`).toBeGreaterThan(0);
    }
    for (const example of [
      "repotruck preset add lang-owner language owner name",
      "repotruck backup list",
      "repotruck config unset sync.depth",
      "repotruck completions powershell",
      "repotruck doctor --fix",
    ]) {
      expect(screen.getAllByText(example).length, `missing example: ${example}`).toBeGreaterThan(0);
    }
  });

  test("lists the preset layouts", () => {
    render(<App />);
    for (const row of PRESET_ROWS) {
      expect(screen.getAllByText(row.preset).length).toBeGreaterThan(0);
    }
  });

  test("lists every settings key with its default", () => {
    render(<App />);
    for (const row of SETTING_ROWS) {
      expect(screen.getByText(row.key)).toBeInTheDocument();
      expect(screen.getAllByText(row.value).length).toBeGreaterThan(0);
    }
  });

  test("lists all four divergence strategies", () => {
    render(<App />);
    for (const row of DIVERGENCE_ROWS) {
      expect(screen.getAllByText(row.strategy).length).toBeGreaterThan(0);
      expect(screen.getByText(row.behavior)).toBeInTheDocument();
    }
  });
});
