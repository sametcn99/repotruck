import { spawn } from "node:child_process";
import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { type CustomPreset, isPresetId, PRESET_IDS, type PresetRef } from "../presets/index.ts";
import { AuthError } from "../services/auth.ts";
import { firstErrorLine } from "../services/cloner.ts";
import type { RepoInventoryEntry, RepotruckConfig } from "../services/config.ts";
import type { SpawnRequest } from "../services/launcher.ts";
import { type createProgressHub, isRepoProgressEvent } from "../services/progressHub.ts";
import { quoteForShell } from "../services/shellQuote.ts";

const ROOT_PARAM_DESCRIPTION =
  "Workspace root directory. Default: the nearest registered workspace found walking up from the MCP server's working directory (records live in the central repotruck.json in the app config dir), otherwise the configured default root (settings.json), otherwise the OS default.";

export const rootParam = z.string().optional().describe(ROOT_PARAM_DESCRIPTION);

export const presetParam = z
  .string()
  .optional()
  .describe(
    `Directory layout preset for the target placement: ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add'`,
  );

export const presetRequired = z
  .string()
  .describe(`Target preset: ${PRESET_IDS.join(", ")}, or a custom preset id`);

export function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function okText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function guarded(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message);
    return fail(firstErrorLine(error));
  }
}

export function makeRequirePreset(customPresets: readonly CustomPreset[]) {
  return (value: string): PresetRef => {
    if (isPresetId(value)) return value;
    if (customPresets.some((preset) => preset.id === value)) return value;
    throw new Error(
      `invalid preset: ${value} (expected ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add')`,
    );
  };
}

export function aliasesByPath(config: RepotruckConfig): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    const key = target.toLowerCase();
    const current = map.get(key) ?? [];
    current.push(alias);
    map.set(key, current);
  }
  return map;
}

export function pinnedKeySet(config: RepotruckConfig): Set<string> {
  return new Set((config.pinned ?? []).map((key) => key.toLowerCase()));
}

export function repoView(
  root: string,
  entry: RepoInventoryEntry,
  aliases: Map<string, string[]>,
  pinnedKeys?: ReadonlySet<string>,
): Record<string, unknown> {
  const absolutePath = path.join(root, ...entry.relativePath.split("/"));
  const key = `${entry.owner}/${entry.name}`;
  return {
    key,
    owner: entry.owner,
    name: entry.name,
    relativePath: entry.relativePath,
    absolutePath,
    onDisk: existsSync(absolutePath),
    category: entry.category,
    internal: entry.internal,
    language: entry.language,
    updatedAt: entry.updatedAt,
    custom: entry.custom === true,
    pinned: pinnedKeys?.has(key.toLowerCase()) ?? false,
    aliases: (aliases.get(entry.relativePath.toLowerCase()) ?? []).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

export type ProgressSink = (progress: number, total: number | undefined, message: string) => void;

interface ProgressCapableRequest {
  _meta?: Record<string, unknown>;
  notify?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
}

export function progressSinkFromContext(ctx: unknown): ProgressSink | null {
  const mcpReq = (ctx as { mcpReq?: ProgressCapableRequest } | null | undefined)?.mcpReq;
  if (mcpReq === undefined || typeof mcpReq.notify !== "function") return null;
  const token = mcpReq._meta?.progressToken;
  if (typeof token !== "string" && typeof token !== "number") return null;
  const notify = mcpReq.notify.bind(mcpReq);
  return (progress, total, message) => {
    void notify({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress,
        ...(total !== undefined ? { total } : {}),
        ...(message.length > 0 ? { message } : {}),
      },
    }).catch(() => {});
  };
}

export function bridgeHubToSink(
  hub: ReturnType<typeof createProgressHub>,
  sink: ProgressSink,
): void {
  hub.subscribe((event) => {
    if (!isRepoProgressEvent(event)) return;
    sink(
      event.index ?? 0,
      event.total,
      `${event.key} — ${event.phase}${event.message ? `: ${event.message}` : ""}`,
    );
  });
}

export function detachedSpawnImpl(request: SpawnRequest): Promise<number> {
  const attempt = (useShell: boolean): Promise<number> =>
    new Promise((resolve, reject) => {
      const child = useShell
        ? spawn(quoteForShell(request.command, request.args), {
            cwd: request.cwd,
            stdio: "ignore",
            detached: true,
            shell: true,
            windowsHide: false,
          })
        : spawn(request.command, request.args, {
            cwd: request.cwd,
            stdio: "ignore",
            detached: true,
            windowsHide: false,
          });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve(0);
      });
    });
  return attempt(false).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return attempt(true);
    }
    throw error;
  });
}

export function workspaceTreeText(root: string): Promise<string> {
  const MAX_DEPTH = 3;
  const MAX_ENTRIES = 200;

  async function walk(dir: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return ["(unreadable directory)"];
    }
    const visible = entries
      .filter((item) => item.name !== ".git" && item.name !== "node_modules")
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const shown = visible.slice(0, MAX_ENTRIES);
    const out: string[] = [];
    for (const [index, entry] of shown.entries()) {
      const last = index === shown.length - 1 && visible.length <= MAX_ENTRIES;
      const branch = last ? "└── " : "├── ";
      out.push(`${branch}${entry.name}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory() && depth < MAX_DEPTH) {
        const nested = await walk(path.join(dir, entry.name), depth + 1);
        const pad = last ? "    " : "│   ";
        out.push(...nested.map((line) => `${pad}${line}`));
      }
    }
    if (visible.length > MAX_ENTRIES) {
      out.push(`└── … ${visible.length - MAX_ENTRIES} more`);
    }
    return out;
  }

  return walk(root, 1).then((out) => [root, ...out].join("\n"));
}
