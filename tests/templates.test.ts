import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CUSTOM_INSTRUCTIONS_BEGIN,
  extractCustomInstructions,
  extractTemplateBlock,
  generateAgentsMd,
  TEMPLATE_BLOCK_BEGIN,
  TEMPLATE_BLOCK_END,
} from "../src/services/agentsMd.ts";
import { AGENTS_MD_FILENAME, writeAgentsMd } from "../src/services/config.ts";
import {
  applyAgentsMdTemplate,
  clearAgentsMdTemplate,
  getAgentsMdTemplate,
  listAgentsMdTemplates,
  renderAgentsMdTemplateBlock,
  templateNames,
} from "../src/services/templates.ts";

const pendingDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-templates-"));
  pendingDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of pendingDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* swept by the next run */
    }
  }
});

const REPO = {
  owner: "monalisa",
  name: "api",
  relativePath: "monalisa/source/api",
  internal: true,
  category: "source",
  language: "TypeScript",
};

const USER_RULES = [
  "# My project rules",
  "- Always answer in English",
  "- Never touch `community/`",
].join("\n");

describe("template registry", () => {
  test("ships node, python, and monorepo profiles", () => {
    expect(templateNames()).toEqual(["monorepo", "node", "python"]);
    for (const name of templateNames()) {
      const template = getAgentsMdTemplate(name);
      expect(template).not.toBeNull();
      expect(template!.rules.length).toBeGreaterThan(2);
      expect(template!.description.length).toBeGreaterThan(0);
    }
  });

  test("listAgentsMdTemplates is sorted and returns copies", () => {
    const listed = listAgentsMdTemplates();
    const names = listed.map((template) => template.name);
    expect(names).toEqual([...names].sort());
    for (const template of listed) {
      expect(template).not.toBe(getAgentsMdTemplate(template.name));
      expect(template.rules).not.toBe(getAgentsMdTemplate(template.name)!.rules);
    }
  });

  test("unknown templates resolve to null", () => {
    expect(getAgentsMdTemplate("rust")).toBeNull();
    expect(renderAgentsMdTemplateBlock("nope")).toBeNull();
  });
});

describe("template injection in generateAgentsMd", () => {
  test("renders the template metadata line and block before the custom section", () => {
    const node = renderAgentsMdTemplateBlock("node")!;
    const content = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [REPO],
      customInstructions: USER_RULES,
      template: node,
    });
    expect(content).toContain("- Instructions template: `node`");
    expect(content.indexOf(TEMPLATE_BLOCK_BEGIN)).toBeGreaterThan(-1);
    expect(content.indexOf(TEMPLATE_BLOCK_BEGIN)).toBeLessThan(
      content.indexOf(CUSTOM_INSTRUCTIONS_BEGIN),
    );
    expect(content.indexOf(TEMPLATE_BLOCK_END)).toBeGreaterThan(-1);
    expect(content.indexOf(TEMPLATE_BLOCK_END)).toBeLessThan(
      content.indexOf(CUSTOM_INSTRUCTIONS_BEGIN),
    );
    for (const rule of node.body.split("\n")) {
      expect(content).toContain(rule);
    }
    expect(content).toContain(USER_RULES);
  });

  test("omits the template line and markers when no template is set", () => {
    const content = generateAgentsMd({ preset: "categorized", lastSync: null, repos: [] });
    expect(content).not.toContain("Instructions template");
    expect(content).not.toContain(TEMPLATE_BLOCK_BEGIN);
    expect(content).not.toContain(TEMPLATE_BLOCK_END);
  });

  test("template application is idempotent byte-for-byte", () => {
    const node = renderAgentsMdTemplateBlock("python")!;
    const first = generateAgentsMd({
      preset: "categorized",
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: [REPO],
      customInstructions: USER_RULES,
      template: node,
    });
    const extracted = extractTemplateBlock(first)!;
    expect(extracted.name).toBe("python");
    expect(extracted.body).toBe(node.body);
    const second = generateAgentsMd({
      preset: "categorized",
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: [REPO],
      customInstructions: extractCustomInstructions(first),
      template: extracted,
    });
    expect(second).toBe(first);
  });

  test("preserves custom instructions byte-for-byte alongside a template", () => {
    const node = renderAgentsMdTemplateBlock("monorepo")!;
    const content = generateAgentsMd({
      preset: "flat-by-owner",
      lastSync: null,
      repos: [],
      customInstructions: USER_RULES,
      template: node,
    });
    expect(extractCustomInstructions(content)).toBe(USER_RULES);
    expect(extractTemplateBlock(content)!.body).toBe(node.body);
  });
});

describe("writeAgentsMd template preservation", () => {
  test("keeps the existing template when the argument is undefined", async () => {
    const root = makeTempRoot();
    const node = renderAgentsMdTemplateBlock("node")!;
    await writeAgentsMd(root, [REPO], "categorized", null, undefined, node);
    await writeAgentsMd(root, [REPO], "categorized", "2026-10-23T00:00:00.000Z");
    const rewritten = readFileSync(path.join(root, AGENTS_MD_FILENAME), "utf8");
    expect(rewritten).toContain("- Instructions template: `node`");
    expect(rewritten).toContain(TEMPLATE_BLOCK_BEGIN);
    expect(rewritten).toContain(TEMPLATE_BLOCK_END);
    expect(rewritten).toContain("- Last sync: 2026-10-23T00:00:00.000Z");
  });

  test("drops the template when the argument is null but keeps custom text", async () => {
    const root = makeTempRoot();
    const node = renderAgentsMdTemplateBlock("node")!;
    const withCustom = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [REPO],
      customInstructions: USER_RULES,
      template: node,
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, AGENTS_MD_FILENAME), withCustom, "utf8");
    await writeAgentsMd(root, [REPO], "categorized", null, undefined, null);
    const cleared = readFileSync(path.join(root, AGENTS_MD_FILENAME), "utf8");
    expect(cleared).not.toContain("Instructions template");
    expect(cleared).not.toContain(TEMPLATE_BLOCK_BEGIN);
    expect(extractCustomInstructions(cleared)).toBe(USER_RULES);
  });
});

describe("applyAgentsMdTemplate service", () => {
  test("rejects an unknown template with the available names", async () => {
    const root = makeTempRoot();
    const result = await applyAgentsMdTemplate(
      { root, repos: [REPO], preset: "categorized", lastSync: null },
      "rust",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unknown template: rust");
    expect(result.message).toContain("node");
  });

  test("applies a template while preserving existing custom instructions", async () => {
    const root = makeTempRoot();
    await writeAgentsMd(root, [REPO], "categorized", null, undefined, null);
    const seed = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [REPO],
      customInstructions: USER_RULES,
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, AGENTS_MD_FILENAME), seed, "utf8");
    const result = await applyAgentsMdTemplate(
      { root, repos: [REPO], preset: "categorized", lastSync: null },
      "python",
    );
    expect(result.ok).toBe(true);
    const content = readFileSync(path.join(root, AGENTS_MD_FILENAME), "utf8");
    expect(content).toContain("- Instructions template: `python`");
    expect(extractCustomInstructions(content)).toBe(USER_RULES);
  });

  test("clearAgentsMdTemplate removes the template and keeps custom text", async () => {
    const root = makeTempRoot();
    await applyAgentsMdTemplate(
      { root, repos: [REPO], preset: "categorized", lastSync: null },
      "node",
    );
    const withCustom = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [REPO],
      customInstructions: USER_RULES,
      template: renderAgentsMdTemplateBlock("node"),
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, AGENTS_MD_FILENAME), withCustom, "utf8");
    const result = await clearAgentsMdTemplate({
      root,
      repos: [REPO],
      preset: "categorized",
      lastSync: null,
    });
    expect(result.ok).toBe(true);
    const content = readFileSync(path.join(root, AGENTS_MD_FILENAME), "utf8");
    expect(content).not.toContain("Instructions template");
    expect(extractCustomInstructions(content)).toBe(USER_RULES);
  });
});
