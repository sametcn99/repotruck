import { warnQuiet } from "./diagnostics.ts";

export interface RateLimitRetryOptions {
  maxRateLimitRetries?: number;
  maxNetworkRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  maxHeaderWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3;
export const DEFAULT_MAX_NETWORK_RETRIES = 2;
export const DEFAULT_INITIAL_DELAY_MS = 1000;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_MAX_DELAY_MS = 30_000;
/**
 * Primary rate-limit resets can be 15-60 minutes away; waiting up to this
 * ceiling beats failing the run, so it is intentionally much larger than the
 * network backoff caps. Waits beyond a minute are surfaced via warnQuiet.
 */
export const DEFAULT_MAX_HEADER_WAIT_MS = 15 * 60_000;

/** Waits longer than this are announced so a long pause is never silent. */
const ANNOUNCE_THRESHOLD_MS = 60_000;

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== null && typeof current === "object" && depth < 4; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") codes.push(record.code);
    current = record.cause;
  }
  return codes;
}

function headerValue(error: unknown, name: string): string | null {
  if (typeof error !== "object" || error === null) return null;
  const headers = (error as { headers?: unknown }).headers;
  if (headers === null || typeof headers !== "object") return null;
  const direct = (headers as Record<string, unknown>)[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];
  const lowercase = (headers as Record<string, unknown>)[name.toLowerCase()];
  if (typeof lowercase === "string") return lowercase;
  if (Array.isArray(lowercase) && typeof lowercase[0] === "string") return lowercase[0];
  return null;
}

export function retryAfterHeaderSeconds(error: unknown): number | null {
  const raw = headerValue(error, "retry-after");
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
}

export function rateLimitResetDeltaMs(error: unknown, now: () => number): number | null {
  const raw = headerValue(error, "x-ratelimit-reset");
  if (raw === null) return null;
  const resetEpochSeconds = Number.parseInt(raw, 10);
  if (Number.isNaN(resetEpochSeconds)) return null;
  return (resetEpochSeconds - Math.floor(now() / 1000)) * 1000;
}

export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  return retryAfterHeaderSeconds(error) !== null || rateLimitResetDeltaMs(error, Date.now) !== null;
}

export function isTransientNetworkError(error: unknown): boolean {
  if ((error as { status?: unknown } | null)?.status !== undefined) return false;
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { headers?: unknown }).headers !== undefined
  ) {
    return false;
  }
  return errorCodes(error).some((code) => TRANSIENT_NETWORK_CODES.has(code));
}

export interface RetryAttempt {
  retry: number;
  delayMs: number;
  kind: "rate-limit" | "network";
}

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const maxRateLimitRetries = options.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
  const maxNetworkRetries = options.maxNetworkRetries ?? DEFAULT_MAX_NETWORK_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxHeaderWaitMs = options.maxHeaderWaitMs ?? DEFAULT_MAX_HEADER_WAIT_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  let rateLimitAttempts = 0;
  let networkAttempts = 0;
  let lastError: unknown;

  for (;;) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      let delayMs: number | null = null;

      if (isRateLimitError(error)) {
        if (rateLimitAttempts >= maxRateLimitRetries) break;
        rateLimitAttempts += 1;
        const retryAfterSeconds = retryAfterHeaderSeconds(error);
        if (retryAfterSeconds !== null) {
          delayMs = Math.min(retryAfterSeconds * 1000, maxHeaderWaitMs);
        } else {
          const resetDelta = rateLimitResetDeltaMs(error, now);
          if (resetDelta !== null) {
            delayMs = resetDelta > 0 ? Math.min(resetDelta, maxHeaderWaitMs) : 0;
          }
        }
        if (delayMs === null) {
          delayMs = Math.min(initialDelayMs * backoffFactor ** (rateLimitAttempts - 1), maxDelayMs);
        }
      } else if (isTransientNetworkError(error)) {
        if (networkAttempts >= maxNetworkRetries) break;
        networkAttempts += 1;
        delayMs = Math.min(initialDelayMs * backoffFactor ** (networkAttempts - 1), maxDelayMs);
      } else {
        break;
      }

      if (delayMs > 0) {
        if (delayMs >= ANNOUNCE_THRESHOLD_MS) {
          warnQuiet(
            `rate limited by GitHub — waiting ${Math.round(delayMs / 1000)}s before retrying`,
            undefined,
            process.env,
          );
        }
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}
