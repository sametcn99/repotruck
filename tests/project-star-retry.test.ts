import { describe, expect, test } from "bun:test";
import { GitHubService } from "../src/services/github.ts";
import type { RateLimitRetryOptions } from "../src/services/rateLimit.ts";

type FakeFetch = (url: string | URL | Request, options?: RequestInit) => Promise<Response>;

function service(fetch: FakeFetch, retry: RateLimitRetryOptions | undefined) {
  return new GitHubService("test-session-only", { request: { fetch }, retry });
}

function response(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ message: "test-session-only" }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("project star uses bounded Octokit retry with cancellation", () => {
  for (const method of ["GET", "PUT"] as const) {
    for (const status of [429, 403] as const) {
      test(`${method} retries transient ${status} once using Retry-After`, async () => {
        const requests: { method: string; url: string; authorization: string | null }[] = [];
        const delays: number[] = [];
        let calls = 0;
        const github = service(
          async (url, options) => {
            const request =
              url instanceof Request
                ? new Request(url, options)
                : new Request(String(url), options);
            requests.push({
              method: request.method,
              url: request.url,
              authorization: request.headers.get("authorization"),
            });
            calls++;
            if (calls === 1) {
              return response(status, {
                "retry-after": "2",
                "x-ratelimit-remaining": "0",
              });
            }
            return new Response(null, { status: 204 });
          },
          { maxRateLimitRetries: 1, sleep: async (ms) => void delays.push(ms) },
        );

        if (method === "GET") expect(await github.isProjectStarred()).toBe(true);
        else await github.starProject();

        expect(calls).toBe(2);
        expect(delays).toEqual([2000]);
        expect(requests.map((request) => request.method)).toEqual([method, method]);
        expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
          "/user/starred/sametcn99/repotruck",
          "/user/starred/sametcn99/repotruck",
        ]);
        expect(
          requests.every((request) => request.authorization === "token test-session-only"),
        ).toBe(true);
      });
    }
  }

  for (const method of ["GET", "PUT"] as const) {
    test(`${method} ordinary permission 403 is not retried`, async () => {
      let calls = 0;
      const delays: number[] = [];
      const github = service(
        async () => {
          calls++;
          return response(403, { "x-ratelimit-remaining": "49" });
        },
        { sleep: async (ms) => void delays.push(ms) },
      );

      if (method === "GET")
        await expect(github.isProjectStarred()).rejects.toThrow("Starring permissions");
      else await expect(github.starProject()).rejects.toThrow("Starring permissions");
      expect(calls).toBe(1);
      expect(delays).toEqual([]);
    });
  }

  for (const status of [429, 403] as const) {
    test(`${status} rate-limit exhaustion is bounded and sanitizes the last error`, async () => {
      let calls = 0;
      const delays: number[] = [];
      const github = service(
        async () => {
          calls++;
          return response(status, {
            "retry-after": "0",
            ...(status === 403 ? { "x-ratelimit-remaining": "0" } : {}),
          });
        },
        { maxRateLimitRetries: 2, sleep: async (ms) => void delays.push(ms) },
      );

      await expect(github.starProject()).rejects.toThrow("GitHub rate limit reached");
      expect(calls).toBe(3);
      // Retry-After: 0 is a valid immediate retry, so no timer is needed.
      expect(delays).toEqual([]);
    });
  }

  test("abort before a request sends no authenticated Octokit call", async () => {
    let calls = 0;
    const github = service(async () => {
      calls++;
      return new Response(null, { status: 204 });
    }, undefined);
    const controller = new AbortController();
    controller.abort();

    await expect(github.isProjectStarred(controller.signal)).rejects.toThrow();
    await expect(github.starProject(controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test("abort during a configured retry wait prevents the delayed PUT", async () => {
    let calls = 0;
    let signalSleepStarted!: () => void;
    const sleepStarted = new Promise<void>((resolve) => {
      signalSleepStarted = resolve;
    });
    const github = service(
      async () => {
        calls++;
        return response(429, { "retry-after": "900" });
      },
      {
        maxRateLimitRetries: 2,
        sleep: async () => {
          signalSleepStarted();
          return new Promise<void>(() => {});
        },
      },
    );
    const controller = new AbortController();
    const request = github.starProject(controller.signal);
    await sleepStarted;
    controller.abort(new Error("About view closed"));

    await expect(request).rejects.toThrow("About view closed");
    expect(calls).toBe(1);
  });

  test("abort clears the default long Retry-After wait rather than leaving a timer behind", async () => {
    let calls = 0;
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const github = service(async () => {
      calls++;
      requestStarted();
      return response(429, { "retry-after": "900" });
    }, undefined);
    const controller = new AbortController();
    const request = github.starProject(controller.signal);
    await started;
    controller.abort();

    await expect(request).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(1);
  });

  for (const method of ["GET", "PUT"] as const) {
    test(`${method} retries a real Octokit transport wrapper using the network budget`, async () => {
      let calls = 0;
      const delays: number[] = [];
      const github = service(
        async () => {
          calls++;
          if (calls === 1) {
            throw Object.assign(new TypeError("socket failed: test-session-only"), {
              code: "ECONNRESET",
            });
          }
          return new Response(null, { status: 204 });
        },
        {
          maxNetworkRetries: 1,
          initialDelayMs: 37,
          sleep: async (ms) => void delays.push(ms),
        },
      );

      if (method === "GET") expect(await github.isProjectStarred()).toBe(true);
      else await github.starProject();

      expect(calls).toBe(2);
      expect(delays).toEqual([37]);
    });
  }

  test("an actual HTTP 500 response is not mistaken for a transport failure", async () => {
    let calls = 0;
    const delays: number[] = [];
    const github = service(
      async () => {
        calls++;
        return response(500, { "x-debug-token": "test-session-only" });
      },
      { maxNetworkRetries: 2, sleep: async (ms) => void delays.push(ms) },
    );

    await expect(github.starProject()).rejects.toThrow("GitHub could not confirm the star status");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  test("abort during network backoff prevents a delayed PUT", async () => {
    let calls = 0;
    let notifySleep!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      notifySleep = resolve;
    });
    const github = service(
      async () => {
        calls++;
        throw Object.assign(new TypeError("temporary"), { code: "ECONNRESET" });
      },
      {
        maxNetworkRetries: 2,
        sleep: async () => {
          notifySleep();
          return new Promise<void>(() => {});
        },
      },
    );
    const controller = new AbortController();
    const request = github.starProject(controller.signal);
    await sleeping;
    controller.abort(new Error("workspace changed"));

    await expect(request).rejects.toThrow("workspace changed");
    expect(calls).toBe(1);
  });

  test("network exhaustion is bounded and exposes neither cause text nor token", async () => {
    let calls = 0;
    const github = service(
      async () => {
        calls++;
        throw Object.assign(new TypeError("socket reset; bearer test-session-only"), {
          code: "ECONNRESET",
          headers: {
            authorization: "token test-session-only",
            "x-private-response": "header-secret",
          },
        });
      },
      { maxNetworkRetries: 2, sleep: async () => {} },
    );

    let message = "";
    try {
      await github.starProject();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(
      "GitHub could not confirm the star status. Check your connection and retry.",
    );
    expect(message).not.toContain("test-session-only");
    expect(message).not.toContain("socket reset");
    expect(message).not.toContain("header-secret");
    expect(calls).toBe(3);
  });
});
