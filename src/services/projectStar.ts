import type { Octokit } from "@octokit/rest";
import { APP_GITHUB_URL } from "./about.ts";
import { isRateLimitError, type RateLimitRetryOptions, withRateLimitRetry } from "./rateLimit.ts";

const [, owner, repo] = new URL(APP_GITHUB_URL).pathname.split("/");

function assertPublicGithub(client: Octokit) {
  if (new URL(client.request.endpoint.DEFAULTS.baseUrl).origin !== "https://api.github.com") {
    throw new Error("Give star requires a github.com session; this session uses another server.");
  }
}

function requestError(error: unknown): Error {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401) return new Error("GitHub session expired. Sign in again, then retry.");
  if (status === 429 || (status === 403 && isRateLimitError(error)))
    return new Error("GitHub rate limit reached. Wait, then retry.");
  if (status === 403)
    return new Error("GitHub denied access. Check token Starring permissions, then retry.");
  return new Error("GitHub could not confirm the star status. Check your connection and retry.");
}

function abortReason(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted();
  } catch (error) {
    return error;
  }
  return new DOMException("The operation was aborted", "AbortError");
}

function abortableSleep(
  ms: number,
  signal: AbortSignal,
  configuredSleep?: (ms: number) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  if (configuredSleep === undefined) {
    return new Promise((resolve, reject) => {
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        cleanup();
        try {
          signal.throwIfAborted();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => configuredSleep(ms))
      .then(
        () => {
          cleanup();
          try {
            signal.throwIfAborted();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
}

function retryOptions(
  options: RateLimitRetryOptions | undefined,
  signal: AbortSignal | undefined,
): RateLimitRetryOptions | undefined {
  if (signal === undefined) return options;
  return {
    ...options,
    sleep: (ms) => abortableSleep(ms, signal, options?.sleep),
  };
}

function retryRequest<T>(
  request: () => Promise<T>,
  signal: AbortSignal | undefined,
  options: RateLimitRetryOptions | undefined,
): Promise<T> {
  signal?.throwIfAborted();
  return withRateLimitRetry(
    () => {
      signal?.throwIfAborted();
      return request();
    },
    retryOptions(options, signal),
  );
}

/** Fresh account-specific check; 404 alone means not starred. */
export async function isProjectStarred(
  client: Octokit,
  signal?: AbortSignal,
  retry?: RateLimitRetryOptions,
): Promise<boolean> {
  assertPublicGithub(client);
  try {
    const response = await retryRequest(
      () =>
        client.rest.activity.checkRepoIsStarredByAuthenticatedUser({
          owner: owner!,
          repo: repo!,
          request: { signal, timeout: 10000 },
        }),
      signal,
      retry,
    );
    if (response.status !== 204) throw new Error("Unconfirmed star status");
    return true;
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as { status?: number } | null)?.status === 404) return false;
    throw requestError(error);
  }
}

/** Idempotent PUT, only called after an explicit About action. */
export async function starProject(
  client: Octokit,
  signal?: AbortSignal,
  retry?: RateLimitRetryOptions,
): Promise<void> {
  assertPublicGithub(client);
  try {
    const response = await retryRequest(
      () =>
        client.rest.activity.starRepoForAuthenticatedUser({
          owner: owner!,
          repo: repo!,
          headers: { "content-length": "0" },
          request: { signal, timeout: 10000 },
        }),
      signal,
      retry,
    );
    if (response.status !== 204) throw new Error("Unconfirmed star result");
  } catch (error) {
    signal?.throwIfAborted();
    throw requestError(error);
  }
}
