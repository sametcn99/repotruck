import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TerminalHero } from "../src/components/TerminalHero.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

suite("TerminalHero", () => {
  function stubMatchMedia(matches: boolean): void {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders the single h1 copy", () => {
    stubMatchMedia(false);
    render(<TerminalHero />);
    expect(
      screen.getByRole("heading", { level: 1, name: /bulk-clone and organize/i }),
    ).toBeInTheDocument();
  });

  test("animates: dashboard frame is absent while typing is in progress", () => {
    stubMatchMedia(false);
    render(<TerminalHero />);
    const typedLine = document.querySelector(".typed-line");
    expect(typedLine?.textContent).toContain("$ ");
    expect(typedLine?.textContent).not.toContain("npx repotruck");
    expect(document.querySelector(".caret")).not.toBeNull();
    expect(document.querySelector(".dash-frame")).toBeNull();
  });

  test("typing completes and the final dashboard frame appears", () => {
    stubMatchMedia(false);
    render(<TerminalHero />);
    act(() => {
      vi.advanceTimersByTime(40 * 20);
    });
    const typedLine = document.querySelector(".typed-line");
    expect(typedLine?.textContent).toContain("npx repotruck");
    expect(document.querySelector(".dash-frame")).not.toBeNull();
    expect(screen.getAllByText(/monalisa \(auth: gh-cli\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 repositories · 1 selected/)).toBeInTheDocument();
  });

  test("reduced motion renders the final frame immediately with no caret", () => {
    stubMatchMedia(true);
    render(<TerminalHero />);
    const typedLine = document.querySelector(".typed-line");
    expect(typedLine?.textContent).toContain("npx repotruck");
    expect(document.querySelector(".dash-frame")).not.toBeNull();
    expect(screen.getAllByText(/monalisa \(auth: gh-cli\)/).length).toBeGreaterThan(0);
    expect(screen.getByText("[DONE] octo/lib — cloned")).toBeInTheDocument();
    expect(document.querySelector(".caret")).toBeNull();
  });

  test("reduced-motion loop stays on the final DONE lines", () => {
    stubMatchMedia(true);
    render(<TerminalHero />);
    vi.advanceTimersByTime(10_000);
    const statuses = Array.from(
      document.querySelectorAll<HTMLElement>(".dash-status .status-line"),
    );
    expect(statuses.length).toBeGreaterThan(0);
    for (const line of statuses) {
      expect(line.textContent).toContain("[DONE]");
    }
  });
});
