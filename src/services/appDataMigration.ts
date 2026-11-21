import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { appConfigDir, appUserHome, CONFIG_FILENAME, type EnvLike } from "./config.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";

export const SETTINGS_FILENAME = "config.json";
const MIGRATION_MARKER = ".layout-v1-migrated";
const FILES = [
  CONFIG_FILENAME,
  `${CONFIG_FILENAME}.bak`,
  "workspaces.json",
  "auth.json",
  "apps.json",
  "update.json",
];

function migrationSources(env: EnvLike, target: string): Map<string, string[]> {
  const settings = [path.join(target, "settings.json")];
  const sources = new Map([[SETTINGS_FILENAME, settings]]);
  if (env.REPOTRUCK_CONFIG_DIR) return sources;

  const home = appUserHome(env);
  const splitSettings = path.join(home, ".repotruck", SETTINGS_FILENAME);
  if (path.dirname(splitSettings) !== target) settings.unshift(splitSettings);

  const formerDirs: string[] = [];
  if (process.platform === "win32") {
    if (env.APPDATA && path.isAbsolute(env.APPDATA))
      formerDirs.push(path.join(env.APPDATA, "repotruck"));
    formerDirs.push(path.join(home, "AppData", "Roaming", "repotruck"));
  } else if (process.platform !== "darwin") {
    if (env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)) {
      formerDirs.push(path.join(env.XDG_CONFIG_HOME, "repotruck"));
    }
    formerDirs.push(path.join(home, ".config", "repotruck"));
  }
  const legacyDirs = [...new Set(formerDirs)].filter((dir) => dir !== target);
  for (const dir of legacyDirs) settings.push(path.join(dir, "settings.json"));
  for (const file of FILES)
    sources.set(
      file,
      legacyDirs.map((dir) => path.join(dir, file)),
    );
  return sources;
}

export async function migrateAppData(env: EnvLike = process.env): Promise<void> {
  const target = appConfigDir(env);
  const marker = path.join(target, MIGRATION_MARKER);
  const isolated = Boolean(env.REPOTRUCK_CONFIG_DIR);
  if (existsSync(marker)) return;
  const sources = migrationSources(env, target);
  const hasLegacyData = [...sources].some(
    ([file, candidates]) =>
      (!isolated || !existsSync(path.join(target, file))) && candidates.some(existsSync),
  );
  if (!hasLegacyData) return;

  await mkdir(target, { recursive: true, mode: 0o700 });
  await withWorkspaceLock(
    async () => {
      if (existsSync(marker)) return;
      for (const [file, candidates] of sources) {
        const destination = path.join(target, file);
        if (existsSync(destination)) continue;
        for (const candidate of candidates) {
          let bytes: Uint8Array;
          try {
            bytes = await readFile(candidate);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          await writeFileAtomic(destination, bytes, 0o600);
          break;
        }
      }
      if (!isolated) await writeFileAtomic(marker, "1\n", 0o600);
    },
    { env: { REPOTRUCK_CONFIG_DIR: target }, lockName: "app-data-migration" },
  );
}
