import { firstErrorLine } from "./cloner.ts";
import type { EnvLike } from "./config.ts";

export function verboseEnabled(env: EnvLike = process.env): boolean {
  const flag = env.REPOTRUCK_VERBOSE;
  return flag === "1" || flag === "true";
}

/**
 * Reports a swallowed error when verbose mode is on (--verbose or
 * REPOTRUCK_VERBOSE=1); silent otherwise. Behavior never changes — only
 * visibility does.
 */
export function warnQuiet(label: string, error: unknown, env: EnvLike = process.env): void {
  if (!verboseEnabled(env)) return;
  process.stderr.write(`warning: ${label} (${firstErrorLine(error)})\n`);
}
