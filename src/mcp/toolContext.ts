import { existsSync } from "node:fs";
import path from "node:path";
import type { CustomPreset, PresetRef } from "../presets/index.ts";
import { getAuthInfo } from "../services/auth.ts";
import type { EnvLike } from "../services/config.ts";
import { appConfigDir, CONFIG_FILENAME } from "../services/config.ts";
import { fileEtagCache, GitHubService } from "../services/github.ts";
import { effectiveRoot, readCustomPresets, resolveGithubBaseUrl } from "../services/settings.ts";
import { isRegisteredWorkspace, resolveWorkspaceRoot } from "../services/workspaceRegistry.ts";
import { makeRequirePreset } from "./toolHelpers.ts";

export interface ToolContext {
  env: EnvLike;
  customPresets: readonly CustomPreset[];
  requirePresetRef: (value: string) => PresetRef;
  resolveRoot: (rootArg?: string) => Promise<string>;
  requireWorkspaceRoot: (rootArg?: string) => Promise<string>;
  requireAuth: () => Promise<{ token: string; github: GitHubService }>;
}

export async function createToolContext(options: {
  env?: EnvLike;
  cwd?: string;
  baseUrl?: string;
}): Promise<ToolContext> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const customPresets = await readCustomPresets(env);
  const requirePresetRef = makeRequirePreset(customPresets);

  async function resolveRoot(rootArg?: string): Promise<string> {
    if (rootArg !== undefined && rootArg.length > 0) return path.resolve(rootArg);
    const walked = await resolveWorkspaceRoot(cwd, env);
    if (walked.found) return walked.root;
    return (await effectiveRoot(env)).root;
  }

  async function requireWorkspaceRoot(rootArg?: string): Promise<string> {
    const root = await resolveRoot(rootArg);
    const registered = await isRegisteredWorkspace(root, env);
    const legacy = existsSync(path.join(root, CONFIG_FILENAME));
    if (!registered && !legacy) {
      throw new Error(
        `not a repotruck workspace (no record for it in the central repotruck.json): ${root} — pass an explicit root, or create the workspace first with repotruck_sync / repotruck_clone`,
      );
    }
    return root;
  }

  async function requireAuth(): Promise<{ token: string; github: GitHubService }> {
    // The MCP server never has an interactive terminal for the device flow,
    // so authentication must come from the environment, gh, or a cached login.
    const auth = await getAuthInfo(env, { interactive: false });
    const baseUrl = await resolveGithubBaseUrl(env, options.baseUrl);
    return {
      token: auth.token,
      github: new GitHubService(auth.token, {
        baseUrl,
        ...(env.REPOTRUCK_NO_API_CACHE
          ? {}
          : { etagCache: fileEtagCache(path.join(appConfigDir(env), "github-cache.json")) }),
      }),
    };
  }

  return { env, customPresets, requirePresetRef, resolveRoot, requireWorkspaceRoot, requireAuth };
}
