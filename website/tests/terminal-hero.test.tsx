import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TerminalHero } from "../src/components/TerminalHero.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

suite("TerminalHero", () => {
  test("renders the single h1 copy at the top of the hero", () => {
    const { container } = render(<TerminalHero />);
    expect(
      screen.getByRole("heading", { level: 1, name: /bulk-clone and organize/i }),
    ).toBeInTheDocument();
    const hero = container.querySelector("section.hero");
    expect(hero?.firstElementChild?.tagName).toBe("H1");
  });

  test("ships no animated TUI mock", () => {
    render(<TerminalHero />);
    expect(document.querySelector(".terminal")).toBeNull();
    expect(document.querySelector(".typed-line")).toBeNull();
    expect(document.querySelector(".dash-frame")).toBeNull();
    expect(document.querySelector(".status-line")).toBeNull();
  });

  test("keeps the copy chip, command builder button and meta line", () => {
    render(<TerminalHero />);
    expect(screen.getByRole("button", { name: "Copy command: npx repotruck" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /command builder/i })).toBeInTheDocument();
    expect(screen.getByText(/no install required/i)).toBeInTheDocument();
  });

  test("describes the workspace map pitch in the sub line", () => {
    render(<TerminalHero />);
    expect(screen.getByText(/AGENTS\.md map/i)).toBeInTheDocument();
  });
});
