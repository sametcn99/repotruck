import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = "https://sametcn99.github.io/repotruck/";

test("robots.txt allows all and points at the sitemap, AI rules, and content signals", () => {
  const robots = readFileSync(join(websiteRoot, "public", "robots.txt"), "utf8");
  expect(robots).toContain("User-agent: *");
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("User-agent: OAI-SearchBot");
  expect(robots).toContain("User-agent: Claude-SearchBot");
  expect(robots).toContain("User-agent: PerplexityBot");
  expect(robots).toContain("User-agent: GPTBot");
  expect(robots).toContain("User-agent: ClaudeBot");
  expect(robots).toContain("Content-Signal: ai-train=yes, search=yes, ai-input=yes");
  expect(robots).toContain(`Sitemap: ${CANONICAL}sitemap.xml`);
  expect(robots).toContain(`Agentmap: ${CANONICAL}.well-known/ai-catalog.json`);
});

test("sitemap.xml contains canonical URLs for site pages and docs", () => {
  const sitemap = readFileSync(join(websiteRoot, "public", "sitemap.xml"), "utf8");
  const urls = Array.from(sitemap.matchAll(/<loc>(.*?)<\/loc>/g)).map((match) => match[1]);
  expect(urls.length).toBeGreaterThanOrEqual(1);
  expect(urls).toContain(CANONICAL);
  expect(urls).toContain(`${CANONICAL}auth.md`);
  expect(urls).toContain(`${CANONICAL}index.md`);
  expect(urls).toContain(`${CANONICAL}llms.txt`);
});

function builtHtml(): string {
  return readFileSync(join(websiteRoot, "dist", "index.html"), "utf8");
}

test("built index.html contains canonical and agent documentation links", () => {
  const html = builtHtml();
  expect(html).toContain(`<link rel="canonical" href="${CANONICAL}" />`);
  expect(html).toContain('rel="alternate" type="text/markdown"');
  expect(html).toContain('rel="ai-catalog"');
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

test("auth.md exists and documents GitHub CLI and device-flow authentication", () => {
  const authMd = readFileSync(join(websiteRoot, "public", "auth.md"), "utf8");
  expect(authMd).toContain("# repotruck auth.md");
  expect(authMd).toContain("gh auth login");
  expect(authMd).toContain("REPOTRUCK_OAUTH_CLIENT_ID");
});

test("llms.txt and index.md completely cover the 16 presets, 27 CLI commands and 25 MCP tools", () => {
  const llms = readFileSync(join(websiteRoot, "public", "llms.txt"), "utf8");
  const indexMd = readFileSync(join(websiteRoot, "public", "index.md"), "utf8");

  expect(llms).toContain("16 Built-in Presets");
  expect(llms).toContain("27 CLI Commands");
  expect(llms).toContain("25 MCP Tools");
  expect(llms).toContain("repotruck_search_code");

  expect(indexMd).toContain("16 Built-in Presets");
  expect(indexMd).toContain("27 Commands");
  expect(indexMd).toContain("25 Tools");
  expect(indexMd).toContain("search-code");
  expect(indexMd).toContain("reorganize");
  expect(indexMd).toContain("AGENTS.md");
});

test("agent discovery well-known files exist and match calculated sha256 digests", () => {
  const mcpServerCardPath = join(websiteRoot, "public", ".well-known", "mcp", "server-card.json");
  expect(existsSync(mcpServerCardPath)).toBe(true);
  const mcpCard = JSON.parse(readFileSync(mcpServerCardPath, "utf8"));
  expect(mcpCard.serverInfo.name).toBe("repotruck");
  expect(mcpCard.transport.type).toBe("stdio");
  expect(mcpCard.transport.args).toContain("mcp");

  const agentSkillsPath = join(websiteRoot, "public", ".well-known", "agent-skills", "index.json");
  expect(existsSync(agentSkillsPath)).toBe(true);
  const skillsIndex = JSON.parse(readFileSync(agentSkillsPath, "utf8"));
  expect(skillsIndex.$schema).toContain("agentskills.io");
  expect(skillsIndex.skills.length).toBe(2);

  for (const skill of skillsIndex.skills) {
    const skillPath = join(
      websiteRoot,
      "public",
      ".well-known",
      "agent-skills",
      skill.name,
      "SKILL.md",
    );
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath);
    const hash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    expect(skill.digest).toBe(hash);
  }

  const aiCatalogPath = join(websiteRoot, "public", ".well-known", "ai-catalog.json");
  expect(existsSync(aiCatalogPath)).toBe(true);
  const aiCatalog = JSON.parse(readFileSync(aiCatalogPath, "utf8"));
  expect(aiCatalog.specVersion).toBe("1.0");
  expect(Array.isArray(aiCatalog.entries)).toBe(true);
});
