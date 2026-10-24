import path from "node:path";
import type { PresetRef } from "../presets/index.ts";
import type { AgentsMdRepo, AgentsMdTemplateBlock } from "./agentsMd.ts";
import { AGENTS_MD_FILENAME, writeAgentsMd } from "./config.ts";

export interface AgentsMdTemplateDefinition {
  name: string;
  description: string;
  rules: readonly string[];
}

export const AGENTS_MD_TEMPLATES: readonly AgentsMdTemplateDefinition[] = [
  {
    name: "node",
    description: "Node/JavaScript/TypeScript projects (Bun-first commands)",
    rules: [
      "Use Bun as the runtime and package manager (`bun install`, `bun run <script>`, `bun test`); do not introduce npm/yarn/pnpm commands.",
      "Run `bun run typecheck` and `bun test` before declaring work done.",
      "Prefer built-in modules over new dependencies; keep the dependency list small.",
      "Follow the existing module style (ESM, TypeScript, `.ts` import extensions).",
      "Never commit generated artifacts (`dist/`, `coverage/`, lockfile churn unrelated to the change).",
    ],
  },
  {
    name: "python",
    description: "Python projects (venv + pytest conventions)",
    rules: [
      "Isolate work in the project's virtual environment (`python -m venv`, activate before running commands).",
      "Install with `pip install -e .` (or the project's documented equivalent) before running tests.",
      "Run the project's test command (`pytest` or `python -m pytest`) before declaring work done.",
      "Follow PEP 8 and the existing import style; do not reformat unrelated code.",
      "Never commit `venv/`, `__pycache__/`, or generated artifacts.",
    ],
  },
  {
    name: "monorepo",
    description: "Multi-package workspaces (package-scoped commands)",
    rules: [
      "Identify the package you are changing before running commands; run builds and tests from that package, not the workspace root.",
      "Use the workspace tool's package filters (e.g. workspace filters in the lockfile manager) for installs and test runs.",
      "Keep shared packages backward compatible; other packages may pin older versions.",
      "Run the affected packages' test suites, then the root suite if one exists, before declaring work done.",
      "Do not add root-level dependencies for code that only one package uses.",
    ],
  },
];

export function listAgentsMdTemplates(): readonly AgentsMdTemplateDefinition[] {
  return [...AGENTS_MD_TEMPLATES]
    .map((template) => ({ ...template, rules: [...template.rules] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentsMdTemplate(name: string): AgentsMdTemplateDefinition | null {
  return AGENTS_MD_TEMPLATES.find((template) => template.name === name) ?? null;
}

export function renderAgentsMdTemplateBlock(name: string): AgentsMdTemplateBlock | null {
  const template = getAgentsMdTemplate(name);
  if (template === null) return null;
  return { name: template.name, body: template.rules.join("\n") };
}

export function templateNames(): string[] {
  return listAgentsMdTemplates().map((template) => template.name);
}

export interface ApplyAgentsMdTemplateInput {
  root: string;
  repos: readonly AgentsMdRepo[];
  preset: PresetRef;
  lastSync: string | null;
  aliases?: Record<string, string>;
}

export interface ApplyAgentsMdTemplateResult {
  ok: boolean;
  message: string;
}

export async function applyAgentsMdTemplate(
  input: ApplyAgentsMdTemplateInput,
  templateName: string,
): Promise<ApplyAgentsMdTemplateResult> {
  const block = renderAgentsMdTemplateBlock(templateName);
  if (block === null) {
    return {
      ok: false,
      message: `unknown template: ${templateName} (available: ${templateNames().join(", ")})`,
    };
  }
  await writeAgentsMd(input.root, input.repos, input.preset, input.lastSync, input.aliases, block);
  return {
    ok: true,
    message: `applied template "${block.name}" to ${path.join(input.root, AGENTS_MD_FILENAME)}`,
  };
}

export async function clearAgentsMdTemplate(
  input: ApplyAgentsMdTemplateInput,
): Promise<ApplyAgentsMdTemplateResult> {
  await writeAgentsMd(input.root, input.repos, input.preset, input.lastSync, input.aliases, null);
  return {
    ok: true,
    message: `removed the instructions template from ${path.join(input.root, AGENTS_MD_FILENAME)}`,
  };
}
