import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "https://sametcn99.github.io/repotruck/";

test("robots.txt allows all and points at the sitemap", () => {
  const robots = readFileSync(join(websiteRoot, "public", "robots.txt"), "utf8");
  expect(robots).toContain("User-agent: *");
  expect(robots).toContain("Allow: /");
  expect(robots).toContain(`Sitemap: ${CANONICAL}sitemap.xml`);
});

test("sitemap.xml contains one canonical URL per site page", () => {
  const sitemap = readFileSync(join(websiteRoot, "public", "sitemap.xml"), "utf8");
  const urls = Array.from(sitemap.matchAll(/<loc>(.*?)<\/loc>/g)).map((match) => match[1]);
  expect(urls.length).toBe(1);
  expect(urls).toContain(CANONICAL);
});

function builtHtml(): string {
  return readFileSync(join(websiteRoot, "dist", "index.html"), "utf8");
}

test("built index.html contains the canonical URL", () => {
  expect(builtHtml()).toContain(`<link rel="canonical" href="${CANONICAL}" />`);
});

test("built index.html contains the og:image and Twitter card", () => {
  const html = builtHtml();
  expect(html).toContain('property="og:image"');
  expect(html).toContain(`${CANONICAL}og-image.png`);
  expect(html).toContain('property="og:image:width" content="1200"');
  expect(html).toContain('property="og:image:height" content="630"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('name="twitter:image"');
});

test("built index.html contains both JSON-LD blocks", () => {
  const html = builtHtml();
  expect(html).toContain('"@type": "SoftwareApplication"');
  expect(html).toContain('"@type": "FAQPage"');
  expect(html).toContain('"applicationCategory": "DeveloperApplication"');
  expect(html).toContain('"operatingSystem": "Windows, macOS, Linux"');
});

test("built index.html contains the noscript fallback with the final frame", () => {
  const html = builtHtml();
  expect(html).toContain("<noscript>");
  const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
  expect(noscript).toContain("npx repotruck");
  expect(noscript).toContain("[DONE] acme/api");
  expect(noscript).toContain("<h1>");
});
