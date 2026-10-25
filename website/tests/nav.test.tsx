import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import App from "../src/App.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

suite("site nav", () => {
  test("every header link targets an existing section id", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    const links = nav.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href");
      expect(href?.startsWith("#")).toBe(true);
      expect(document.getElementById(href!.slice(1)), `missing target for ${href}`).not.toBeNull();
    }
  });

  test("sections with subheadings render dropdown menus", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Site" });

    // Presets dropdown
    expect(nav.querySelector('a[href="#trees"]')).not.toBeNull();

    // MCP dropdown
    expect(nav.querySelector('a[href="#mcp-tools"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#mcp-resources"]')).not.toBeNull();

    // CLI dropdown
    expect(nav.querySelector('a[href="#sync-and-clone"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#lifecycle"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#workspace"]')).not.toBeNull();

    // Reference dropdown
    expect(nav.querySelector('a[href="#ref-auth"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#ref-memory"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#ref-agents"]')).not.toBeNull();
  });

  test("mobile toggle opens and closes mobile navigation", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });

    expect(nav.classList.contains("is-mobile-open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(nav.classList.contains("is-mobile-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(nav.classList.contains("is-mobile-open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("caret buttons toggle dropdown open state", () => {
    render(<App />);
    const cliCaret = screen.getByRole("button", { name: /toggle cli subheadings/i });
    const cliItem = cliCaret.closest(".nav-item");

    expect(cliItem?.classList.contains("is-open")).toBe(false);
    fireEvent.click(cliCaret);
    expect(cliItem?.classList.contains("is-open")).toBe(true);

    fireEvent.click(cliCaret);
    expect(cliItem?.classList.contains("is-open")).toBe(false);
  });

  test("clicking a link closes mobile menu and dropdown", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(toggle);
    expect(nav.classList.contains("is-mobile-open")).toBe(true);

    const syncLink = nav.querySelector('a[href="#sync-and-clone"]');
    expect(syncLink).not.toBeNull();
    fireEvent.click(syncLink!);

    expect(nav.classList.contains("is-mobile-open")).toBe(false);
  });

  test("pressing escape closes mobile menu and dropdown", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Site" });
    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    fireEvent.click(toggle);
    expect(nav.classList.contains("is-mobile-open")).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(nav.classList.contains("is-mobile-open")).toBe(false);
  });

  test("brand shows the truck logo and the repotruck name", () => {
    render(<App />);
    expect(document.querySelector(".brand-logo")).not.toBeNull();
    expect(screen.getByText("repotruck", { selector: ".brand" })).toBeInTheDocument();
  });

  test("footer links to the GitHub repository and npm package", () => {
    render(<App />);
    const footer = document.querySelector(".site-footer");
    expect(footer).not.toBeNull();
    const hrefs = Array.from(footer!.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toContain("https://github.com/sametcn99/repotruck");
    expect(hrefs).toContain("https://www.npmjs.com/package/repotruck");
    for (const href of hrefs) {
      expect(href?.startsWith("/")).toBe(false);
    }
  });

  test("desktop side footer renders github, npm and top links", () => {
    render(<App />);
    const sideFooter = document.querySelector(".side-footer");
    expect(sideFooter).not.toBeNull();
    const hrefs = Array.from(sideFooter!.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toContain("https://github.com/sametcn99/repotruck");
    expect(hrefs).toContain("https://www.npmjs.com/package/repotruck");
    expect(hrefs).toContain("#main");
  });

  test("toc rail navbar includes brand link pointing to #main", () => {
    render(<App />);
    const rail = document.querySelector(".toc-rail");
    expect(rail).not.toBeNull();
    const brandLink = rail!.querySelector('a[href="#main"].toc-brand');
    expect(brandLink).not.toBeNull();
    expect(brandLink?.textContent).toContain("repotruck");
  });
});
