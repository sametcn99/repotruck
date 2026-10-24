import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENTS_MD_FILENAME,
  appConfigDir,
  defaultConfig,
  type EnvLike,
  readAgentsMd,
  writeAgentsMd,
} from "../src/services/config.ts";
import { resolveWorkspacePreset, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
let configDir: string;
let env: EnvLike;

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-config-test-"));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  configDir = mkdtempSync(path.join(tmpdir(), "repotruck-config-cfgdir-"));
  tempRoots.push(configDir);
  env = { REPOTRUCK_CONFIG_DIR: configDir };
});

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("appConfigDir", () => {
  test("explicit REPOTRUCK_CONFIG_DIR override wins on every platform", () => {
    expect(appConfigDir({ REPOTRUCK_CONFIG_DIR: "C:\\custom" }, "win32")).toBe("C:\\custom");
    expect(appConfigDir({ REPOTRUCK_CONFIG_DIR: "/custom" }, "linux")).toBe("/custom");
    expect(appConfigDir({ REPOTRUCK_CONFIG_DIR: "/custom" }, "darwin")).toBe("/custom");
  });

  test("win32 uses APPDATA", () => {
    expect(appConfigDir({ APPDATA: "C:\\Users\\sam\\AppData\\Roaming" }, "win32")).toBe(
      path.join("C:\\Users\\sam\\AppData\\Roaming", "repotruck"),
    );
  });

  test("win32 falls back to USERPROFILE\\AppData\\Roaming", () => {
    expect(appConfigDir({ USERPROFILE: "C:\\Users\\sam" }, "win32")).toBe(
      path.join("C:\\Users\\sam", "AppData", "Roaming", "repotruck"),
    );
  });

  test("darwin uses HOME Library Application Support", () => {
    expect(appConfigDir({ HOME: "/Users/sam" }, "darwin")).toBe(
      path.join("/Users/sam", "Library", "Application Support", "repotruck"),
    );
  });

  test("linux prefers XDG_CONFIG_HOME", () => {
    expect(appConfigDir({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/sam" }, "linux")).toBe(
      path.join("/xdg", "repotruck"),
    );
  });

  test("linux falls back to HOME/.config", () => {
    expect(appConfigDir({ HOME: "/home/sam" }, "linux")).toBe(
      path.join("/home/sam", ".config", "repotruck"),
    );
  });

  test("documented single-argument call works with the real platform", () => {
    const dir = appConfigDir({});
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });
});

describe("defaultConfig", () => {
  test("uses categorized preset by default and empty inventory", () => {
    expect(defaultConfig("C:\\ws")).toEqual({
      version: 1,
      root: "C:\\ws",
      preset: "categorized",
      lastSync: null,
      repos: [],
    });
  });

  test("accepts an explicit preset", () => {
    expect(defaultConfig("/ws", "topic-focused").preset).toBe("topic-focused");
  });
});

describe("readAgentsMd and writeAgentsMd", () => {
  test("missing AGENTS.md reads as null", async () => {
    const root = makeTempRoot();
    expect(await readAgentsMd(root)).toBeNull();
  });

  test("writeAgentsMd writes newline-only content that reads back", async () => {
    const root = makeTempRoot();
    const content = await writeAgentsMd(root, [], "topic-focused", "2026-10-23T10:00:00.000Z");
    expect(content.includes("\r")).toBe(false);
    const raw = await readAgentsMd(root);
    expect(raw).toBe(content);
    expect(raw).toContain(`- Preset: \`topic-focused\``);
  });

  test("writes the AGENTS_MD_FILENAME constant name", async () => {
    expect(AGENTS_MD_FILENAME).toBe("AGENTS.md");
  });
});

describe("resolveWorkspacePreset", () => {
  test("central record wins over AGENTS.md and fallback", async () => {
    const root = makeTempRoot();
    await writeWorkspaceConfig(root, defaultConfig(root, "flat-by-owner"), env);
    await writeAgentsMd(root, [], "topic-focused", null);
    expect(await resolveWorkspacePreset(root, "categorized", env)).toBe("flat-by-owner");
  });

  test("AGENTS.md preset wins over fallback when no record exists", async () => {
    const root = makeTempRoot();
    await writeAgentsMd(root, [], "topic-focused", null);
    expect(await resolveWorkspacePreset(root, "categorized", env)).toBe("topic-focused");
  });

  test("falls back when neither a record nor AGENTS.md exists", async () => {
    const root = makeTempRoot();
    expect(await resolveWorkspacePreset(root, "categorized", env)).toBe("categorized");
  });
});
