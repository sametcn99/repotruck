import { describe, expect, test } from "bun:test";
import { REGISTRY } from "../src/commands/registry.ts";
import { MCP_TOOL_CATALOG } from "../src/mcp/toolCatalog.ts";
import { PRESET_IDS, type PresetId } from "../src/presets/index.ts";
import {
  AGENTS_MD_MARKER,
  type AgentsMdRepo,
  CUSTOM_INSTRUCTIONS_BEGIN,
  CUSTOM_INSTRUCTIONS_END,
  CUSTOM_INSTRUCTIONS_PLACEHOLDER,
  extractCustomInstructions,
  generateAgentsMd,
  parsePresetFromAgentsMd,
} from "../src/services/agentsMd.ts";
import {
  GUIDE_BEGIN,
  GUIDE_END,
  GUIDE_VERSION,
  parseGuideVersion,
  renderAgentsMdGuide,
} from "../src/services/agentsMdGuide.ts";

const internalRepo: AgentsMdRepo = {
  owner: "monalisa",
  name: "api",
  relativePath: "monalisa/source/api",
  internal: true,
  category: "source",
  language: "Go",
};

const communityFork: AgentsMdRepo = {
  owner: "octocat",
  name: "hello",
  relativePath: "community/octocat/forks/hello",
  internal: false,
  category: "forks",
  language: null,
};

const communityArchived: AgentsMdRepo = {
  owner: "torvalds",
  name: "lib",
  relativePath: "community/torvalds/archived/lib",
  internal: false,
  category: "archived",
  language: "C",
};

function generate(preset: PresetId, repos: AgentsMdRepo[], lastSync: string | null): string {
  return generateAgentsMd({ preset, lastSync, repos });
}

describe("generateAgentsMd", () => {
  test("starts with the AUTO-GENERATED marker as the first line", () => {
    const content = generate("categorized", [], null);
    expect(content.startsWith(AGENTS_MD_MARKER)).toBe(true);
    expect(content.split("\n")[0]).toBe(AGENTS_MD_MARKER);
  });

  test("uses English headings for every section", () => {
    const content = generate("categorized", [internalRepo, communityFork], null);
    expect(content).toContain("# Repository Workspace Map");
    expect(content).toContain("## Workspace Metadata");
    expect(content).toContain("## Internal Projects");
    expect(content).toContain("## Community Repositories (community/)");
    expect(content).toContain("## Agent Rules");
  });

  test("renders workspace metadata with counts", () => {
    const content = generate(
      "categorized",
      [internalRepo, communityFork, communityArchived],
      "2026-10-23T10:00:00.000Z",
    );
    expect(content).toContain("- Preset: `categorized`");
    expect(content).toContain("- Last sync: 2026-10-23T10:00:00.000Z");
    expect(content).toContain("- Total repositories: 3 (1 internal, 2 community)");
  });

  test("renders never for a null lastSync", () => {
    const content = generate("flat-by-owner", [], null);
    expect(content).toContain("- Last sync: never");
  });

  test("splits internal and community entries into their sections", () => {
    const content = generate("categorized", [internalRepo, communityFork], null);
    const internalSection = content
      .split("## Internal Projects")[1]!
      .split("## Community Repositories (community/)")[0]!;
    const communitySection = content
      .split("## Community Repositories (community/)")[1]!
      .split("## Agent Rules")[0]!;
    expect(internalSection).toContain("- `monalisa/api` — `monalisa/source/api`");
    expect(internalSection).not.toContain("octocat");
    expect(communitySection).toContain(
      "- `octocat/hello` — `community/octocat/forks/hello` (fork)",
    );
    expect(communitySection).not.toContain("monalisa");
  });

  test("appends archived and language badges", () => {
    const content = generate("categorized", [communityArchived], null);
    expect(content).toContain("- `torvalds/lib` — `community/torvalds/archived/lib` (archived, C)");
  });

  test("omits badges entirely when there are none", () => {
    const plain: AgentsMdRepo = {
      owner: "acme",
      name: "web",
      relativePath: "acme/source/web",
      internal: true,
      category: "source",
      language: null,
    };
    const content = generate("categorized", [plain], null);
    expect(content).toContain("- `acme/web` — `acme/source/web`");
    expect(content).not.toContain("`acme/web` — `acme/source/web` (");
  });

  test("uses placeholders when there are no repositories", () => {
    const content = generate("categorized", [], null);
    expect(content.match(/\*\(none yet\)\*/g)?.length).toBe(2);
    expect(content).toContain("- Total repositories: 0 (0 internal, 0 community)");
  });

  test("contains the three agent rules topics", () => {
    const content = generate("categorized", [], null);
    expect(content).toContain("independent Git project");
    expect(content).toContain("Exclude `.git/`, `node_modules/`, and `dist/`");
    expect(content).toContain("read-only");
    expect(content).toContain("never suggest commit or push");
  });

  test("only uses newline line endings", () => {
    const content = generate("categorized", [internalRepo], null);
    expect(content.includes("\r")).toBe(false);
  });
});

describe("parsePresetFromAgentsMd", () => {
  test("round-trips every preset through generate", () => {
    for (const preset of PRESET_IDS) {
      expect(parsePresetFromAgentsMd(generate(preset, [], null))).toBe(preset);
    }
  });

  test("parses a hand-written Preset line", () => {
    expect(parsePresetFromAgentsMd("- Preset: `topic-focused`\n")).toBe("topic-focused");
    expect(parsePresetFromAgentsMd("- Preset: flat-by-owner\n")).toBe("flat-by-owner");
  });

  test("returns null for missing or malformed preset lines", () => {
    expect(parsePresetFromAgentsMd("# No metadata here\n")).toBeNull();
    // A syntactically valid id may be a user-defined preset, so only
    // malformed ids (spaces, punctuation, case) must be rejected.
    expect(parsePresetFromAgentsMd("- Preset: `not a preset`\n")).toBeNull();
    expect(parsePresetFromAgentsMd("- Preset: `Bad_ID`\n")).toBeNull();
    expect(parsePresetFromAgentsMd("")).toBeNull();
  });
});

describe("custom instructions block", () => {
  const multiLine = [
    "# My project rules",
    "- Always answer in English",
    "- Never touch `community/`",
  ].join("\n");

  test("null customInstructions emits the placeholder block", () => {
    const content = generate("categorized", [], null);
    expect(content).toContain("## Custom Instructions");
    expect(content).toContain(CUSTOM_INSTRUCTIONS_BEGIN);
    expect(content).toContain(CUSTOM_INSTRUCTIONS_PLACEHOLDER);
    expect(content).toContain(CUSTOM_INSTRUCTIONS_END);
  });

  test("user text is emitted verbatim between the delimiters", () => {
    const content = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [],
      customInstructions: multiLine,
    });
    const inner = content.slice(
      content.indexOf(CUSTOM_INSTRUCTIONS_BEGIN),
      content.indexOf(CUSTOM_INSTRUCTIONS_END),
    );
    expect(inner).toContain(multiLine);
  });

  test("extract returns null for a legacy file without markers", () => {
    const legacy = [
      AGENTS_MD_MARKER,
      "",
      "# Repository Workspace Map",
      "",
      "- Preset: `categorized`",
    ].join("\n");
    expect(extractCustomInstructions(legacy)).toBeNull();
  });

  test("extract round-trips the block byte-for-byte", () => {
    const content = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [],
      customInstructions: multiLine,
    });
    const extracted = extractCustomInstructions(content);
    expect(extracted).toBe(multiLine);
    const regenerated = generateAgentsMd({
      preset: "flat-by-owner",
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: [],
      customInstructions: extracted,
    });
    expect(extractCustomInstructions(regenerated)).toBe(multiLine);
    const originalBlock = content.slice(content.indexOf(CUSTOM_INSTRUCTIONS_BEGIN));
    const regeneratedBlock = regenerated.slice(regenerated.indexOf(CUSTOM_INSTRUCTIONS_BEGIN));
    expect(regeneratedBlock).toBe(originalBlock);
  });

  test("preservation survives changes elsewhere in the document", () => {
    const content = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [],
      customInstructions: multiLine,
    });
    const extracted = extractCustomInstructions(content);
    const regenerated = generateAgentsMd({
      preset: "topic-focused",
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: [
        {
          owner: "monalisa",
          name: "web",
          relativePath: "monalisa/TypeScript/web",
          internal: true,
          category: "source",
          language: "TypeScript",
        },
      ],
      customInstructions: extracted,
    });
    expect(regenerated).toContain(multiLine);
    expect(regenerated).toContain("- Preset: `topic-focused`");
    expect(regenerated).toContain("Total repositories: 1 (1 internal, 0 community)");
  });

  test("empty custom text falls back to the placeholder", () => {
    const content = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [],
      customInstructions: "",
    });
    expect(content).toContain(CUSTOM_INSTRUCTIONS_PLACEHOLDER);
  });

  test("extract tolerates a missing end marker", () => {
    const partial = ["header", CUSTOM_INSTRUCTIONS_BEGIN, "keep this line"].join("\n");
    expect(extractCustomInstructions(partial)).toBe("keep this line");
  });
});

describe("cli + mcp guide section", () => {
  test("is embedded between versioned markers before Agent Rules", () => {
    const content = generate("categorized", [], null);
    expect(content).toContain(GUIDE_BEGIN);
    expect(content).toContain(GUIDE_END);
    expect(parseGuideVersion(content)).toBe(GUIDE_VERSION);
    expect(content.indexOf(GUIDE_BEGIN)).toBeGreaterThan(0);
    expect(content.indexOf("## Agent Rules")).toBeGreaterThan(content.indexOf(GUIDE_END));
  });

  test("covers every registry command and every MCP tool", () => {
    const guide = renderAgentsMdGuide();
    for (const spec of REGISTRY) {
      if (spec.id === "__globals__") continue;
      expect(guide).toContain(`repotruck ${spec.path}`);
    }
    for (const tool of MCP_TOOL_CATALOG) {
      expect(guide).toContain(`\`${tool.name}\``);
    }
  });

  test("renders flag docs and the MCP connection snippet", () => {
    const guide = renderAgentsMdGuide();
    expect(guide).toContain("- `-s, --scope <scope>` —");
    expect(guide).toContain('"command": "repotruck"');
    expect(guide).toContain('["mcp"]');
  });

  test("is deterministic", () => {
    expect(renderAgentsMdGuide()).toBe(renderAgentsMdGuide());
  });

  test("regenerating from a pre-guide file restores the guide but keeps custom text", () => {
    const custom = ["# House rules", "- keep commits small"].join("\n");
    // Simulate an AGENTS.md written by an older repotruck (no guide section).
    const legacy = [
      AGENTS_MD_MARKER,
      "",
      "# Repository Workspace Map",
      "",
      "## Agent Rules",
      "",
      CUSTOM_INSTRUCTIONS_BEGIN,
      custom,
      CUSTOM_INSTRUCTIONS_END,
      "",
    ].join("\n");
    expect(parseGuideVersion(legacy)).toBe(0);

    const regenerated = generateAgentsMd({
      preset: "categorized",
      lastSync: null,
      repos: [],
      customInstructions: extractCustomInstructions(legacy),
    });
    expect(parseGuideVersion(regenerated)).toBe(GUIDE_VERSION);
    expect(regenerated).toContain(custom);
  });
});
