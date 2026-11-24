import { expect, test } from "bun:test";
import path from "node:path";
import { testConfigDir } from "./helpers/test-environment.ts";

test("the next test file restores config isolation after prior afterAll deletion", () => {
  expect(process.env.REPOTRUCK_CONFIG_DIR).toBe(testConfigDir);
  expect(path.basename(testConfigDir)).toMatch(/^repotruck-test-config-/);
});
