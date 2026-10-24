import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUTH_FILENAME,
  cachedLoginExists,
  getAuthInfo,
  logout,
  probeAuth,
} from "../src/services/auth.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

function tempEnv(): { dir: string; env: Record<string, string> } {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-auth-test-"));
  tempRoots.push(dir);
  return { dir, env: { REPOTRUCK_CONFIG_DIR: dir, PATH: dir } };
}

describe("auth credential resolution and precedence", () => {
  test("REPOTRUCK_TOKEN environment variable takes highest precedence", async () => {
    const { env } = tempEnv();
    env.REPOTRUCK_TOKEN = "test-token-from-env";
    const info = await getAuthInfo(env);
    expect(info.token).toBe("test-token-from-env");
    expect(info.method).toBe("env");

    const probe = await probeAuth(env);
    expect(probe.method).toBe("env");
  });

  test("cached token is used when REPOTRUCK_TOKEN is absent and cached auth exists", async () => {
    const { dir, env } = tempEnv();
    writeFileSync(
      path.join(dir, AUTH_FILENAME),
      JSON.stringify({ token: "cached-token-123", method: "device" }),
      "utf8",
    );
    expect(await cachedLoginExists(env)).toBe(true);

    const probe = await probeAuth(env);
    expect(probe.method).toBe("cached");

    const info = await getAuthInfo(env);
    expect(info.token).toBe("cached-token-123");
    expect(info.method).toBe("cached");
  });

  test("logout removes cached auth file", async () => {
    const { dir, env } = tempEnv();
    writeFileSync(
      path.join(dir, AUTH_FILENAME),
      JSON.stringify({ token: "cached-token-xyz" }),
      "utf8",
    );
    expect(await cachedLoginExists(env)).toBe(true);

    const loggedOut = await logout(env);
    expect(loggedOut).toBe(true);
    expect(await cachedLoginExists(env)).toBe(false);

    const secondLogout = await logout(env);
    expect(secondLogout).toBe(false);
  });

  test("probeAuth returns none when no token, gh cli or cache exist", async () => {
    const { env } = tempEnv();
    const probe = await probeAuth(env);
    expect(probe.method).toBe("none");
  });
});
