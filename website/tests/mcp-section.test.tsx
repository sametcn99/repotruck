import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MCP_PROMPT_ROWS, MCP_RESOURCE_ROWS, MCP_TOOL_ROWS } from "../src/components/McpDocs.ts";
import { McpSection } from "../src/components/McpSection.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

suite("McpSection", () => {
  test("renders the section heading and intro", () => {
    render(<McpSection />);
    expect(
      screen.getByRole("heading", { level: 2, name: "MCP for coding agents" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Model Context Protocol server/)).toBeInTheDocument();
  });

  test("shows the Claude Code one-liner and the mcpServers JSON config", () => {
    render(<McpSection />);
    expect(screen.getAllByText(/claude mcp add repotruck/).length).toBeGreaterThan(0);
    expect(screen.getByText(/"mcpServers"/)).toBeInTheDocument();
    expect(screen.getByText(/"-y", "repotruck", "mcp"/)).toBeInTheDocument();
  });

  test("lists every MCP tool row", () => {
    render(<McpSection />);
    for (const row of MCP_TOOL_ROWS) {
      expect(screen.getByText(row.tool)).toBeInTheDocument();
      expect(screen.getByText(row.action)).toBeInTheDocument();
    }
  });

  test("documents all 25 tools including the newest additions", () => {
    expect(MCP_TOOL_ROWS.length).toBe(25);
    for (const tool of [
      "repotruck_run",
      "repotruck_stats",
      "repotruck_delete",
      "repotruck_doctor",
      "repotruck_workspaces_remove",
    ]) {
      expect(
        MCP_TOOL_ROWS.map((row) => row.tool),
        `missing tool: ${tool}`,
      ).toContain(tool);
    }
    render(<McpSection />);
    for (const tool of MCP_TOOL_ROWS.map((row) => row.tool)) {
      expect(screen.getByText(tool)).toBeInTheDocument();
    }
  });

  test("lists the fixed resources and per-workspace resource templates", () => {
    render(<McpSection />);
    expect(MCP_RESOURCE_ROWS.length).toBe(6);
    for (const row of MCP_RESOURCE_ROWS) {
      expect(screen.getByText(row.uri)).toBeInTheDocument();
      expect(screen.getByText(row.content)).toBeInTheDocument();
    }
    for (const uri of [
      "repotruck://agents-md/{root}",
      "repotruck://inventory/{root}",
      "repotruck://tree/{root}",
    ]) {
      expect(screen.getByText(uri)).toBeInTheDocument();
    }
  });

  test("lists pre-built prompt workflows", () => {
    render(<McpSection />);
    expect(MCP_PROMPT_ROWS.length).toBe(2);
    for (const row of MCP_PROMPT_ROWS) {
      expect(screen.getByText(row.prompt)).toBeInTheDocument();
      expect(screen.getByText(row.description)).toBeInTheDocument();
    }
  });

  test("copy button copies the JSON config", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<McpSection />);
    const buttons = screen.getAllByRole("button");
    const jsonButton = buttons.find(
      (button) => !button.textContent?.includes("--") && button.accessibilityName !== undefined,
    );
    const configButton =
      buttons.find((button) => button.getAttribute("aria-label")?.includes("mcpServers")) ??
      jsonButton ??
      buttons[buttons.length - 1];
    fireEvent.click(configButton!);
    await vi.waitFor(() => {
      expect(screen.getAllByText("Copied!").length).toBe(1);
    });
    expect(writeText).toHaveBeenCalled();
  });
});
