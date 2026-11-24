import { Dashboard } from "./components/Dashboard.tsx";
import { Store } from "./components/store.ts";
import { activateTheme, resolveThemeName } from "./components/theme.ts";
import { startTui } from "./tuiRuntime.tsx";

export { startTui } from "./tuiRuntime.tsx";

import { readSettings } from "./services/settings.ts";

async function bootstrap(): Promise<void> {
  const settings = await readSettings();
  activateTheme(resolveThemeName(process.env.REPOTRUCK_THEME, settings.theme));
  // Upgrade AGENTS.md guide sections written by older repotruck versions
  // before the session starts (custom instructions are preserved). House-
  // keeping at interactive startup only — never in headless commands, so
  // scripts and tests can't mutate workspaces as a side effect.
  if (process.env.REPOTRUCK_NO_AGENTS_MD_MIGRATE !== "1") {
    try {
      const { migrateAgentsMdGuides } = await import("./services/agentsMdMigration.ts");
      await migrateAgentsMdGuides();
    } catch {
      // a failed guide migration must never block the dashboard
    }
  }
  await startTui(Dashboard, Store);
}

await bootstrap();
