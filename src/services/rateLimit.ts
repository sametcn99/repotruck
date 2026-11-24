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
  const record = error as { headers?: unknown; response?: { headers?: unknown } };
  const headers = record.response?.headers ?? record.headers;
  if (headers === null || typeof headers !== "object") return null;
  if (headers instanceof Headers) return headers.get(name);
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (entry) {
    const value = entry[1];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  const direct = (headers as Record<string, unknown>)[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];
  const lowercase = (headers as Record<string, unknown>)[name.toLowerCase()];
  if (typeof lowercase === "string") return lowercase;
  if (Array.isArray(lowercase) && typeof lowercase[0] === "string") return lowercase[0];
  return null;
}

export function retryAfterHeaderSeconds(
  error: unknown,
  now: () => number = Date.now,
): number | null {
  const raw = headerValue(error, "retry-after");
  if (raw === null) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw.trim())) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      raw.trim(),
    )
  )
    return null;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, (date - now()) / 1000) : null;
}

export function rateLimitResetDeltaMs(error: unknown, now: () => number): number | null {
  const raw = headerValue(error, "x-ratelimit-reset");
  if (raw === null) return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const resetEpochSeconds = Number(raw);
  if (!Number.isFinite(resetEpochSeconds)) return null;
  return (resetEpochSeconds - Math.floor(now() / 1000)) * 1000;
}

export function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status !== 403 && status !== 429) return false;
  if (status === 429) return true;
  const remaining = headerValue(error, "x-ratelimit-remaining");
  if (remaining !== null && Number(remaining) > 0 && retryAfterHeaderSeconds(error) === null)
    return false;
  return retryAfterHeaderSeconds(error) !== null || rateLimitResetDeltaMs(error, Date.now) !== null;
}

export function isTransientNetworkError(error: unknown): boolean {
  const record = error as { status?: unknown; response?: unknown } | null;
  if (record?.status !== undefined) {
    // Octokit normalizes a fetch rejection into HttpError(status=500), but
    // leaves `response` unset and retains the socket/DNS failure as `cause`.
    // Only that recognizable wrapper is a transport failure; a real HTTP
    // response (including 500) and all other statuses remain non-retryable.
    return (
      record.status === 500 &&
      record.response == null &&
      errorCodes(error).some((code) => TRANSIENT_NETWORK_CODES.has(code))
    );
  }
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
  for (const [name, value] of Object.entries({ maxRateLimitRetries, maxNetworkRetries })) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${name} must be a non-negative integer`);
  }
  for (const [name, value] of Object.entries({
    initialDelayMs,
    maxDelayMs,
    maxHeaderWaitMs,
    backoffFactor,
  })) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be finite and non-negative`);
  }
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
        const retryAfterSeconds = retryAfterHeaderSeconds(error, now);
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
