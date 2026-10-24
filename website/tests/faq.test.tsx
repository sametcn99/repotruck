import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import { Faq } from "../src/components/Faq.tsx";

const hasDom = typeof document !== "undefined";
const suite = hasDom ? describe : describe.skip;

interface FaqEntry {
  "@type"?: string;
  name?: string;
  acceptedAnswer?: { "@type"?: string; text?: string };
}

interface FaqPage {
  "@type"?: string;
  mainEntity?: FaqEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const builtHtmlPath = join(here, "..", "dist", "index.html");

function extractFaqJsonLd(html: string): string {
  const blocks = Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ).map((match) => match[1] ?? "");
  for (const block of blocks) {
    const parsed = JSON.parse(block) as { "@type"?: string };
    if (parsed["@type"] === "FAQPage") {
      return block;
    }
  }
  throw new Error("FAQPage JSON-LD block not found in built index.html");
}

suite("FAQ JSON-LD parity", () => {
  beforeAll(() => {
    let html: string;
    try {
      html = readFileSync(builtHtmlPath, "utf8");
    } catch {
      throw new Error(
        `dist/index.html not found at ${builtHtmlPath} — run \`bun run build\` before \`bun run test\`.`,
      );
    }
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = extractFaqJsonLd(html);
    document.head.appendChild(script);
  });

  test("renders six visible Q&A items", () => {
    render(<Faq />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.length).toBe(6);
  });

  test("every visible Q&A pair matches the FAQPage JSON-LD exactly", () => {
    render(<Faq />);
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    let data: FaqPage | null = null;
    for (const block of blocks) {
      const parsed = JSON.parse(block.textContent ?? "") as FaqPage;
      if (parsed["@type"] === "FAQPage") {
        data = parsed;
        break;
      }
    }
    expect(data).not.toBeNull();
    expect(data!.mainEntity?.length).toBe(6);
    const headings = screen.getAllByRole("heading", { level: 3 });
    for (let index = 0; index < headings.length; index += 1) {
      const question = headings[index]!.textContent ?? "";
      const answerElement = headings[index]!.nextElementSibling;
      const answer = answerElement?.textContent ?? "";
      const entry = data!.mainEntity![index]!;
      expect(entry.name).toBe(question);
      expect(entry.acceptedAnswer?.text).toBe(answer);
    }
  });
});
