import { execFile } from "node:child_process";
import { chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createOAuthDeviceAuth } from "@octokit/auth-oauth-device";
import { Octokit } from "@octokit/rest";
import { appConfigDir, type EnvLike } from "./config.ts";
import { warnQuiet } from "./diagnostics.ts";
import { writeFileAtomic } from "./fsUtils.ts";

const execFileAsync = promisify(execFile);

export const AUTH_FILENAME = "auth.json";

export type AuthMethod = "env" | "gh-cli" | "cached" | "device";

export interface AuthInfo {
  token: string;
  method: AuthMethod;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

async function readCachedAuth(env: EnvLike): Promise<AuthInfo | null> {
  try {
    const raw = await readFile(path.join(appConfigDir(env), AUTH_FILENAME), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const token = (parsed as { token?: unknown }).token;
    if (typeof token !== "string" || token.length === 0) return null;
    return { token, method: "cached" };
  } catch (error) {
    warnQuiet("auth: cached login read failed", error, env);
    return null;
  }
}

async function writeCachedAuth(env: EnvLike, token: string): Promise<void> {
  const dir = appConfigDir(env);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, AUTH_FILENAME);
  const body = {
    token,
    method: "device",
    createdAt: new Date().toISOString(),
  };
  await writeFileAtomic(file, `${JSON.stringify(body, null, 2)}\n`);
  try {
    await chmod(file, 0o600);
  } catch {
    /* no-op on filesystems without POSIX modes (e.g. Windows) */
  }
}

/** Scopes requested from the device flow; `workflow` lets created repos push GitHub Actions files. */
const DEVICE_FLOW_SCOPES = ["repo", "read:org", "workflow"];

async function deviceFlowAuth(
  env: EnvLike,
  baseUrl?: string,
  requestImpl?: unknown,
): Promise<AuthInfo> {
  const clientId = env.REPOTRUCK_OAUTH_CLIENT_ID;
  if (clientId === undefined || clientId.length === 0) {
    throw new AuthError(
      "GitHub authentication is not available. Install the GitHub CLI and run 'gh auth login', or set REPOTRUCK_OAUTH_CLIENT_ID to the client ID of your OAuth App (an OAuth App needs no callback URL).",
    );
  }
  const request =
    requestImpl !== undefined
      ? requestImpl
      : baseUrl !== undefined
        ? new Octokit({ baseUrl }).request
        : undefined;

  // biome-ignore lint/suspicious/noExplicitAny: the library types each clientType variant as a separate option shape; this oauth-app form is valid at runtime
  const authOptions: any = {
    clientType: "oauth-app",
    clientId,
    scopes: DEVICE_FLOW_SCOPES,
    onVerification: (verification: { verification_uri: string; user_code: string }) => {
      process.stderr.write(
        `Open ${verification.verification_uri} in your browser and enter this code: ${verification.user_code}\n`,
      );
    },
  };
  if (request !== undefined) {
    authOptions.request = request;
  }
  const auth = createOAuthDeviceAuth(authOptions);
  const result = (await auth({ type: "oauth" })) as { token: string };
  return { token: result.token, method: "device" };
}

export interface GetAuthInfoOptions {
  /** Refuse to fall back to the interactive device flow (for MCP servers, CI, …). */
  interactive?: boolean;
}

export async function getAuthInfo(
  env: EnvLike,
  options: GetAuthInfoOptions = {},
): Promise<AuthInfo> {
  const envToken = env.REPOTRUCK_TOKEN;
  if (envToken !== undefined && envToken.length > 0) {
    return { token: envToken, method: "env" };
  }
  try {
    const gh = await execFileAsync("gh", ["auth", "token"], {
      timeout: 10_000,
      windowsHide: true,
      env: env as NodeJS.ProcessEnv,
    });
    const token = gh.stdout.trim();
    if (token.length > 0) return { token, method: "gh-cli" };
  } catch {
    /* noop */
  }
  const cached = await readCachedAuth(env);
  if (cached !== null) return cached;
  if (options.interactive === false) {
    throw new AuthError(
      "no GitHub token available (set REPOTRUCK_TOKEN, run 'gh auth login', or 'repotruck auth login') — interactive device flow is disabled here",
    );
  }
  const device = await deviceFlowAuth(env);
  await writeCachedAuth(env, device.token);
  return device;
}

export interface AuthProbe {
  method: "env" | "gh-cli" | "cached" | "device" | "none";
}

/** Resolves the auth method without ever running the device flow. */
export async function probeAuth(env: EnvLike): Promise<AuthProbe> {
  const envToken = env.REPOTRUCK_TOKEN;
  if (envToken !== undefined && envToken.length > 0) return { method: "env" };
  try {
    const gh = await execFileAsync("gh", ["auth", "token"], {
      timeout: 10_000,
      windowsHide: true,
      env: env as NodeJS.ProcessEnv,
    });
    if (gh.stdout.trim().length > 0) return { method: "gh-cli" };
  } catch {
    /* noop */
  }
  if ((await readCachedAuth(env)) !== null) return { method: "cached" };
  return { method: "none" };
}

export async function cachedLoginExists(env: EnvLike): Promise<boolean> {
  return (await readCachedAuth(env)) !== null;
}

export async function logout(env: EnvLike): Promise<boolean> {
  const { rm } = await import("node:fs/promises");
  const file = path.join(appConfigDir(env), AUTH_FILENAME);
  try {
    await rm(file);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

export interface DeviceLoginOptions {
  env: EnvLike;
  baseUrl?: string;
  requestImpl?: unknown;
}

export async function deviceLogin(options: DeviceLoginOptions): Promise<AuthInfo> {
  const info = await deviceFlowAuth(options.env, options.baseUrl, options.requestImpl);
  await writeCachedAuth(options.env, info.token);
  return info;
}
