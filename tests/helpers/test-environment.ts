import { afterAll, afterEach, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OWNER_PID = "REPOTRUCK_TEST_CONFIG_OWNER_PID";
const TEST_CONFIG_DIR = "REPOTRUCK_TEST_CONFIG_DIR";
const PREFIX = "repotruck-test-config-";

function isTestOwnedDirectory(value: string): boolean {
  const resolved = path.resolve(value);
  const base = path.resolve(tmpdir());
  return resolved.startsWith(`${base}${path.sep}`) && path.basename(resolved).startsWith(PREFIX);
}

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Redirects test processes away from user configuration, including direct
 * `bun test` runs. An explicit REPOTRUCK_TEST_CONFIG_DIR is accepted only when
 * it has the test-owned temp-directory shape used by local test wrappers.
 */
export function initializeTestEnvironment(): string {
  const inheritedDir = process.env[TEST_CONFIG_DIR];
  const inheritedOwner = Number(process.env[OWNER_PID]);
  if (inheritedDir && isTestOwnedDirectory(inheritedDir) && inheritedOwner > 0) {
    // A spawned process reuses its parent's private directory and must not
    // remove it when the child exits. A fixture-specific config directory is
    // explicit test input and must keep winning in that child.
    if (!process.env.REPOTRUCK_CONFIG_DIR) process.env.REPOTRUCK_CONFIG_DIR = inheritedDir;
    return inheritedDir;
  }

  if (inheritedDir && !isTestOwnedDirectory(inheritedDir)) {
    throw new Error(`${TEST_CONFIG_DIR} must point inside tmpdir to ${PREFIX}*`);
  }

  const previous = {
    REPOTRUCK_CONFIG_DIR: process.env.REPOTRUCK_CONFIG_DIR,
    [TEST_CONFIG_DIR]: process.env[TEST_CONFIG_DIR],
    [OWNER_PID]: process.env[OWNER_PID],
  };
  const configDir = inheritedDir ?? mkdtempSync(path.join(tmpdir(), PREFIX));
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  process.env[TEST_CONFIG_DIR] = configDir;
  process.env[OWNER_PID] = String(process.pid);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    restoreEnvironment(previous);
    rmSync(configDir, { recursive: true, force: true });
  };
  process.once("beforeExit", cleanup);
  process.once("exit", cleanup);
  return configDir;
}

export const testConfigDir = initializeTestEnvironment();

function restoreMissingConfigEnv(): void {
  mkdirSync(testConfigDir, { recursive: true });
  if (!process.env.REPOTRUCK_CONFIG_DIR) process.env.REPOTRUCK_CONFIG_DIR = testConfigDir;
}

function cleanupOwnedConfigAfterSuite(): void {
  restoreMissingConfigEnv();
  if (Number(process.env[OWNER_PID]) === process.pid)
    rmSync(testConfigDir, { recursive: true, force: true });
}

// A number of legacy suite teardowns restore an originally absent env value.
// Keep every following test and test file in the same task-owned config scope;
// explicit non-empty fixture envs remain untouched.
beforeEach(restoreMissingConfigEnv);
afterEach(restoreMissingConfigEnv);
afterAll(cleanupOwnedConfigAfterSuite);
