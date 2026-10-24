import { describe, expect, test } from "bun:test";
import type { Octokit } from "@octokit/rest";
import { GitHubService } from "../src/services/github.ts";
import {
  isRateLimitError,
  isTransientNetworkError,
  rateLimitResetDeltaMs,
  retryAfterHeaderSeconds,
  withRateLimitRetry,
} from "../src/services/rateLimit.ts";

function rateLimitError(status: number, headers: Record<string, string> = {}): Error {
  const error = new Error(`Request failed with status code ${status}`);
  Object.assign(error, { status, headers });
  return error;
}

function networkError(code: string): Error {
  const error = new Error(`request failed: ${code}`);
  Object.assign(error, { code });
  return error;
}

function recordingSleep(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

describe("error classification", () => {
  test("429 is always a rate limit error", () => {
    expect(isRateLimitError(rateLimitError(429))).toBe(true);
  });

  test("403 with Retry-After is a rate limit error", () => {
    expect(isRateLimitError(rateLimitError(403, { "retry-after": "2" }))).toBe(true);
  });

  test("403 with x-ratelimit-reset is a rate limit error", () => {
    expect(isRateLimitError(rateLimitError(403, { "x-ratelimit-reset": "1999999999" }))).toBe(true);
  });

  test("bare 403 is a permission error, not a rate limit", () => {
    expect(isRateLimitError(rateLimitError(403))).toBe(false);
  });

  test("Retry-After parses as seconds; junk does not", () => {
    expect(retryAfterHeaderSeconds(rateLimitError(429, { "retry-after": "3" }))).toBe(3);
    expect(retryAfterHeaderSeconds(rateLimitError(429, { "retry-after": "soon" }))).toBeNull();
  });

  test("x-ratelimit-reset yields a delta against now", () => {
    const now = 1_000_000_000_000;
    const resetSeconds = Math.floor(now / 1000) + 5;
    expect(
      rateLimitResetDeltaMs(
        rateLimitError(403, { "x-ratelimit-reset": String(resetSeconds) }),
        () => now,
      ),
    ).toBe(5000);
  });

  test("transient network codes include cause chains", () => {
    expect(isTransientNetworkError(networkError("ECONNRESET"))).toBe(true);
    expect(isTransientNetworkError(networkError("ETIMEDOUT"))).toBe(true);
    expect(isTransientNetworkError(networkError("EPIPE"))).toBe(true);
    expect(isTransientNetworkError(networkError("EACCES"))).toBe(false);
    const wrapped = new Error("fetch failed", {
      cause: networkError("UND_ERR_CONNECT_TIMEOUT"),
    });
    expect(isTransientNetworkError(wrapped)).toBe(true);
  });
});

describe("withRateLimitRetry", () => {
  test("429 with Retry-After waits the header value once, then succeeds", async () => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    const result = await withRateLimitRetry(
      () => {
        calls += 1;
        if (calls === 1) throw rateLimitError(429, { "retry-after": "2" });
        return Promise.resolve("ok");
      },
      { sleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  test("bare 403 is never retried", async () => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    await expect(
      withRateLimitRetry(
        () => {
          calls += 1;
          throw rateLimitError(403);
        },
        { sleep },
      ),
    ).rejects.toThrow("403");
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test("429 without headers uses exponential backoff capped at maxDelayMs", async () => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    await expect(
      withRateLimitRetry(
        () => {
          calls += 1;
          throw rateLimitError(429);
        },
        { sleep, maxDelayMs: 4000 },
      ),
    ).rejects.toThrow("429");
    expect(calls).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  test("x-ratelimit-reset in the past waits zero and still counts the retry", async () => {
    const { sleeps, sleep } = recordingSleep();
    const now = 2_000_000_000_000;
    const resetSeconds = Math.floor(now / 1000) - 10;
    let calls = 0;
    const result = await withRateLimitRetry(
      () => {
        calls += 1;
        if (calls === 1) {
          throw rateLimitError(403, { "x-ratelimit-reset": String(resetSeconds) });
        }
        return Promise.resolve("ok");
      },
      { sleep, now: () => now },
    );
    expect(result).toBe("ok");
    expect(sleeps).toEqual([]);
    expect(calls).toBe(2);
  });

  test("transient network errors retry at most twice, then succeed", async () => {
    const { sleeps, sleep } = recordingSleep();
    let calls = 0;
    const result = await withRateLimitRetry(
      () => {
        calls += 1;
        if (calls <= 2) throw networkError("ECONNRESET");
        return Promise.resolve("ok");
      },
      { sleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test("network errors beyond the budget propagate the last error", async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    await expect(
      withRateLimitRetry(
        () => {
          calls += 1;
          throw networkError("ETIMEDOUT");
        },
        { sleep },
      ),
    ).rejects.toThrow("ETIMEDOUT");
    expect(calls).toBe(3);
  });

  test("non-retryable non-network errors propagate immediately", async () => {
    const { sleep } = recordingSleep();
    let calls = 0;
    await expect(
      withRateLimitRetry(
        () => {
          calls += 1;
          return Promise.reject(new Error("not found"));
        },
        { sleep },
      ),
    ).rejects.toThrow("not found");
    expect(calls).toBe(1);
  });
});

describe("GitHubService retry wiring", () => {
  function fakeOctokit(getAuthenticated: () => Promise<unknown>): Octokit {
    return { rest: { users: { getAuthenticated } } } as unknown as Octokit;
  }

  test("read calls retry through withRateLimitRetry (429 x2 then success = 3 calls)", async () => {
    let calls = 0;
    const octokit = fakeOctokit(() => {
      calls += 1;
      if (calls <= 2) throw rateLimitError(429, { "retry-after": "1" });
      return Promise.resolve({ data: { login: "octocat" } });
    });
    const service = new GitHubService("token", {
      octokit,
      retry: { sleep: () => Promise.resolve() },
    });
    expect(await service.getUserLogin()).toBe("octocat");
    expect(calls).toBe(3);
  });

  test("paginated listUserRepos retries only the failing page (429 x2 then success = 3 requests)", async () => {
    let requests = 0;
    const octokit = {
      request: async () => {
        requests += 1;
        if (requests <= 2) throw rateLimitError(429, { "retry-after": "1" });
        return { data: [{ id: 1, name: "api", owner: { login: "acme" } }] };
      },
    } as unknown as Octokit;
    const service = new GitHubService("token", {
      octokit,
      retry: { sleep: () => Promise.resolve() },
    });
    const repos = await service.listUserRepos();
    expect(repos.map((repo) => `${repo.owner}/${repo.name}`)).toEqual(["acme/api"]);
    expect(requests).toBe(3);
  });

  test("paginated getActiveOrgs retries only the failing page (429 x2 then success = 3 requests)", async () => {
    let requests = 0;
    const octokit = {
      request: async () => {
        requests += 1;
        if (requests <= 2) throw rateLimitError(429, { "retry-after": "1" });
        return { data: [{ organization: { login: "acme-org" } }] };
      },
    } as unknown as Octokit;
    const service = new GitHubService("token", {
      octokit,
      retry: { sleep: () => Promise.resolve() },
    });
    expect(await service.getActiveOrgs()).toEqual(["acme-org"]);
    expect(requests).toBe(3);
  });

  test("createRepo is never retried even on persistent 429", async () => {
    let calls = 0;
    const octokit = {
      rest: {
        users: { getAuthenticated: () => Promise.resolve({ data: { login: "octocat" } }) },
        repos: {
          createForAuthenticatedUser: () => {
            calls += 1;
            throw rateLimitError(429, { "retry-after": "1" });
          },
        },
      },
    } as unknown as Octokit;
    const service = new GitHubService("token", {
      octokit,
      retry: { sleep: () => Promise.resolve() },
    });
    await expect(service.createRepo("demo", { private: true })).rejects.toThrow("429");
    expect(calls).toBe(1);
  });
});
