import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { COMMAND_GROUPS } from "../src/components/commandGroups.generated.ts";
import { TerminalHero } from "../src/components/TerminalHero.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

function mockClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function openBuilder(): HTMLDialogElement {
  fireEvent.click(screen.getByRole("button", { name: /command builder/i }));
  const dialog = document.querySelector("dialog.builder") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
  return dialog;
}

suite("hero install chip", () => {
  test("clicking the npx repotruck chip copies it in one click", async () => {
    const writeText = mockClipboard();
    render(<TerminalHero />);

    const chip = screen.getByRole("button", { name: "Copy command: npx repotruck" });
    expect(chip.textContent).toContain("$ npx repotruck");
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByText("copied!")).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith("npx repotruck");
  });
});

suite("command builder", () => {
  beforeEach(() => {
    mockClipboard();
  });

  test("opens from the hero button and lists every command", () => {
    render(<TerminalHero />);
    openBuilder();

    const total = COMMAND_GROUPS.reduce((sum, g) => sum + g.commands.length, 0);
    const items = screen
      .getAllByRole("button", { name: /.+/ })
      .filter((button) => button.classList.contains("builder-command"));
    expect(items.length).toBe(total);
    for (const group of COMMAND_GROUPS) {
      expect(screen.getByText(group.title)).toBeInTheDocument();
    }
  });

  test("search filters the command list", () => {
    render(<TerminalHero />);
    openBuilder();

    fireEvent.change(screen.getByLabelText("Search commands"), {
      target: { value: "changelog" },
    });
    const items = screen
      .getAllByRole("button")
      .filter((b) => b.classList.contains("builder-command"));
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain("changelog");
  });

  test("places the built command and examples before the settings", () => {
    render(<TerminalHero />);
    const dialog = openBuilder();
    const details = within(dialog);

    const examples = details.getByRole("region", { name: "Examples" });
    const form = details.getByRole("group", { name: "Form" });
    expect(examples.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      details.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent),
    ).toEqual(["Built command", "Examples", "Options", "Global options"]);
  });

  test("boolean flag and choices flag build into the preview", () => {
    render(<TerminalHero />);
    openBuilder();

    // sync is selected by default
    fireEvent.click(screen.getByLabelText("--pinned"));
    expect(screen.getByText("npx repotruck sync --pinned")).toBeInTheDocument();

    // choices flag auto-picks its documented default when enabled
    fireEvent.click(screen.getByLabelText("--divergence <strategy>"));
    expect(screen.getByText(/--divergence fail/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Value for --divergence"), {
      target: { value: "rebase" },
    });
    expect(screen.getByText("npx repotruck sync --pinned --divergence rebase")).toBeInTheDocument();
  });

  test("value flag renders a text input and quotes values", () => {
    render(<TerminalHero />);
    openBuilder();

    fireEvent.click(screen.getByLabelText("--profile <name>"));
    fireEvent.change(screen.getByLabelText("Value for --profile"), {
      target: { value: "backend" },
    });
    expect(screen.getByText("npx repotruck sync --profile backend")).toBeInTheDocument();
  });

  test("positional argument lands in the built command", () => {
    render(<TerminalHero />);
    openBuilder();

    const sidebar = document.querySelector(".builder-list") as HTMLElement;
    fireEvent.click(within(sidebar).getByRole("button", { name: /^clone/ }));
    fireEvent.change(screen.getByLabelText(/^<url>/), {
      target: { value: "monalisa/api" },
    });
    expect(screen.getByText("npx repotruck clone monalisa/api")).toBeInTheDocument();
  });

  test("usage forms switch arguments (sync resolve)", () => {
    render(<TerminalHero />);
    openBuilder();

    const sidebar = document.querySelector(".builder-list") as HTMLElement;
    fireEvent.click(within(sidebar).getByRole("button", { name: /^sync/ }));
    fireEvent.click(screen.getByLabelText(/sync resolve \[repo\]/));
    fireEvent.change(screen.getByLabelText(/^\[repo\]/), {
      target: { value: "monalisa/api" },
    });
    expect(screen.getByText("npx repotruck sync resolve monalisa/api")).toBeInTheDocument();
  });

  test("global options append after command options", () => {
    render(<TerminalHero />);
    openBuilder();

    fireEvent.click(screen.getByLabelText(/--verbose/));
    expect(screen.getByText("npx repotruck sync --verbose")).toBeInTheDocument();
  });

  test("built command is copyable", async () => {
    const writeText = mockClipboard();
    render(<TerminalHero />);
    openBuilder();

    fireEvent.click(screen.getByLabelText("--pinned"));
    fireEvent.click(
      screen.getByRole("button", { name: "Copy command: npx repotruck sync --pinned" }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("npx repotruck sync --pinned");
    });
  });

  test("close button closes the dialog", () => {
    render(<TerminalHero />);
    const dialog = openBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Close command builder" }));
    expect(dialog.open).toBe(false);
  });

  test("escape closes the dialog even while the search box has text", () => {
    render(<TerminalHero />);
    const dialog = openBuilder();

    fireEvent.change(screen.getByLabelText("Search commands"), {
      target: { value: "changelog" },
    });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog.open).toBe(false);
  });
});
