import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AUTH_FILENAME,
  AuthError,
  cachedLoginExists,
  deviceLogin,
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
  test("AuthError correctly sets name and message", () => {
    const error = new AuthError("test error message");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthError");
    expect(error.message).toBe("test error message");
  });

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

  test("non-interactive getAuthInfo throws AuthError when no credentials exist", async () => {
    const { env } = tempEnv();
    await expect(getAuthInfo(env, { interactive: false })).rejects.toThrow(
      /no GitHub token available.*interactive device flow is disabled here/,
    );
  });

  test("readCachedAuth gracefully handles malformed or invalid cached files", async () => {
    const { dir, env } = tempEnv();
    const authFile = path.join(dir, AUTH_FILENAME);

    // Not JSON
    writeFileSync(authFile, "{not-valid-json", "utf8");
    expect(await cachedLoginExists(env)).toBe(false);

    // Null JSON
    writeFileSync(authFile, "null", "utf8");
    expect(await cachedLoginExists(env)).toBe(false);

    // Number or primitive JSON
    writeFileSync(authFile, "12345", "utf8");
    expect(await cachedLoginExists(env)).toBe(false);

    // Object with missing token
    writeFileSync(authFile, JSON.stringify({ other: "field" }), "utf8");
    expect(await cachedLoginExists(env)).toBe(false);

    // Object with empty string token
    writeFileSync(authFile, JSON.stringify({ token: "" }), "utf8");
    expect(await cachedLoginExists(env)).toBe(false);

    // Object with non-string token
    writeFileSync(authFile, JSON.stringify({ token: 999 }), "utf8");
    expect(await cachedLoginExists(env)).toBe(false);
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

  test("deviceLogin rejects if REPOTRUCK_OAUTH_CLIENT_ID is missing or empty", async () => {
    const { env } = tempEnv();
    await expect(deviceLogin({ env })).rejects.toThrow(/GitHub authentication is not available/);

    env.REPOTRUCK_OAUTH_CLIENT_ID = "";
    await expect(deviceLogin({ env })).rejects.toThrow(/GitHub authentication is not available/);
  });

  test("C22: deviceLogin executes hermetic OAuth device flow with mock request and persists cached token", async () => {
    const { dir, env } = tempEnv();
    env.REPOTRUCK_OAUTH_CLIENT_ID = "mock-client-id-xyz";

    // biome-ignore lint/suspicious/noExplicitAny: mock octokit request function shape
    const mockRequest: any = async (route: string) => {
      if (route.includes("device/code")) {
        return {
          data: {
            device_code: "mock_device_code_123",
            user_code: "MOCK-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 1,
          },
        };
      }
      if (route.includes("oauth/access_token")) {
        return {
          data: {
            access_token: "mock_gho_access_token_hermetic",
            token_type: "bearer",
            scope: "repo,read:org,workflow",
          },
        };
      }
      throw new Error(`Unexpected request route in mock: ${route}`);
    };
    mockRequest.endpoint = {
      DEFAULTS: {
        baseUrl: "https://github.com",
      },
    };

    const info = await deviceLogin({
      env,
      requestImpl: mockRequest,
    });

    expect(info.token).toBe("mock_gho_access_token_hermetic");
    expect(info.method).toBe("device");

    // Verify written to disk
    expect(await cachedLoginExists(env)).toBe(true);
    const writtenRaw = readFileSync(path.join(dir, AUTH_FILENAME), "utf8");
    const parsed = JSON.parse(writtenRaw);
    expect(parsed.token).toBe("mock_gho_access_token_hermetic");
    expect(parsed.method).toBe("device");

    // Verify getAuthInfo now picks it up
    const resolved = await getAuthInfo(env);
    expect(resolved.token).toBe("mock_gho_access_token_hermetic");
    expect(resolved.method).toBe("cached");
  });
});
