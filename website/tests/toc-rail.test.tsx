import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import App from "../src/App.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

suite("toc rail", () => {
  test("lists a link for every section and includes deeper subheadings", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = Array.from(nav.querySelectorAll("a"));
    const sections = Array.from(document.querySelectorAll("main section[id]"));

    // Every top-level section must have a corresponding link in the rail
    for (const section of sections) {
      expect(
        nav.querySelector(`a[href="#${section.id}"]`),
        `missing section link for #${section.id}`,
      ).not.toBeNull();
    }

    // Rail contains deeper subheadings marked with .toc-rail-sub
    const subLinks = Array.from(nav.querySelectorAll("a.toc-rail-sub"));
    expect(subLinks.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(sections.length);

    // Every link targets an existing DOM element
    for (const link of links) {
      const href = link.getAttribute("href");
      expect(href?.startsWith("#")).toBe(true);
      expect(document.getElementById(href!.slice(1)), `missing target for ${href}`).not.toBeNull();
    }
  });

  test("labels come from section headings and subheadings, not raw ids", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Sections" });

    const cliLink = nav.querySelector<HTMLAnchorElement>('a[href="#cli"]');
    expect(cliLink?.textContent).toContain("Headless CLI");
    expect(cliLink?.getAttribute("data-level")).toBe("1");

    const syncSubLink = nav.querySelector<HTMLAnchorElement>('a[href="#sync-and-clone"]');
    expect(syncSubLink?.textContent).toContain("Sync and clone");
    expect(syncSubLink?.getAttribute("data-level")).toBe("2");
    expect(syncSubLink?.classList.contains("toc-rail-sub")).toBe(true);

    const authSubLink = nav.querySelector<HTMLAnchorElement>('a[href="#ref-auth"]');
    expect(authSubLink?.textContent).toContain("Authentication");
    expect(authSubLink?.getAttribute("data-level")).toBe("2");

    const toolsSubLink = nav.querySelector<HTMLAnchorElement>('a[href="#mcp-tools"]');
    expect(toolsSubLink?.textContent).toContain("Tools");
    expect(toolsSubLink?.getAttribute("data-level")).toBe("2");
  });
});
