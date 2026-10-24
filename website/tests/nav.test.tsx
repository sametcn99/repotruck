import { render, screen } from "@testing-library/react";
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

  test("brand shows the truck logo and the repotruck name", () => {
    render(<App />);
    expect(document.querySelector(".brand-logo")).not.toBeNull();
    expect(screen.getByText("repotruck", { selector: ".brand" })).toBeInTheDocument();
  });

  test("footer links to the GitHub repository", () => {
    render(<App />);
    const footer = document.querySelector(".site-footer");
    expect(footer).not.toBeNull();
    const hrefs = Array.from(footer!.querySelectorAll("a")).map((link) =>
      link.getAttribute("href"),
    );
    expect(hrefs).toContain("https://github.com/sametcn99/repotruck");
    for (const href of hrefs) {
      expect(href?.startsWith("/")).toBe(false);
    }
  });
});
