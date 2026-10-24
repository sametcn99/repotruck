import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { InstallBox } from "../src/components/InstallBox.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const COMMANDS = ["npx repotruck", "bunx repotruck", "npm i -g repotruck", "bun add -g repotruck"];

suite("InstallBox", () => {
  test("renders all four install commands", () => {
    render(<InstallBox />);
    for (const command of COMMANDS) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(screen.getAllByText(new RegExp(escaped)).length).toBeGreaterThan(0);
    }
  });

  test("clipboard write succeeds and shows Copied!", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<InstallBox />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(4);
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBe(1);
    });
    expect(writeText).toHaveBeenCalledWith("npx repotruck");
    expect(buttons[0]!).toHaveAccessibleName("Copy command: npx repotruck");
  });

  test("falls back to execCommand when navigator.clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as unknown as typeof document.execCommand;
    render(<InstallBox />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]!);
    await vi.waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBe(1);
    });
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
