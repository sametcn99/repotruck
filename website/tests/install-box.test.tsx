import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { InstallBox } from "../src/components/InstallBox.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

const COMMANDS = ["npx repotruck", "bunx repotruck", "npm i -g repotruck", "bun add -g repotruck"];

suite("InstallBox", () => {
  test("renders standalone and registry install commands", () => {
    render(<InstallBox />);
    for (const command of COMMANDS) {
      expect(screen.getByRole("button", { name: `Copy command: ${command}` })).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("group", { name: "Linux, macOS, or Git Bash" })).getByRole("button"),
    ).toHaveAccessibleName(/download\/install\.sh \| sh$/);
    expect(
      within(screen.getByRole("group", { name: "Windows PowerShell" })).getByRole("button"),
    ).toHaveAccessibleName(/download\/install\.ps1 \| iex$/);
    expect(
      within(screen.getByRole("group", { name: "Homebrew on macOS" })).getByRole("button"),
    ).toHaveAccessibleName(/brew install sametcn99\/repotruck\/repotruck$/);
    expect(
      within(screen.getByRole("group", { name: "Scoop on Windows" })).getByRole("button"),
    ).toHaveAccessibleName(/scoop install repotruck\/repotruck/);
  });

  test("clipboard write succeeds and shows Copied!", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<InstallBox />);
    const button = screen.getByRole("button", { name: "Copy command: npx repotruck" });
    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBe(1);
    });
    expect(writeText).toHaveBeenCalledWith("npx repotruck");
    expect(button).toHaveAccessibleName("Copy command: npx repotruck");
  });

  test("falls back to execCommand when navigator.clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as unknown as typeof document.execCommand;
    render(<InstallBox />);
    fireEvent.click(screen.getByRole("button", { name: "Copy command: bunx repotruck" }));
    await vi.waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBe(1);
    });
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
