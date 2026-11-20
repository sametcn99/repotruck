import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Dashboard } from "./components/Dashboard.tsx";
import { Store } from "./components/store.ts";
import { activateTheme, resolveThemeName } from "./components/theme.ts";
import { firstErrorLine } from "./services/cloner.ts";
import { logDiag } from "./services/diagnostics.ts";
import { readSettings, resolveRootForSession } from "./services/settings.ts";

async function bootstrap(): Promise<void> {
  const settings = await readSettings();
  activateTheme(resolveThemeName(process.env.REPOTRUCK_THEME, settings.theme));
  await startTui(Dashboard, Store);
}

/**
 * Safety net for anything no layer caught: rejections and exceptions land in
 * the diagnostics log (Log view + error toast) instead of tearing down the
 * renderer mid-session.
 */
function installRuntimeErrorCapture(): void {
  process.on("unhandledRejection", (reason) => {
    logDiag("error", "[runtime]", `unhandled rejection: ${firstErrorLine(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    logDiag("error", "[runtime]", `uncaught exception: ${firstErrorLine(error)}`);
  });
}

type DashboardComponent = typeof Dashboard;
type StoreConstructor = typeof Store;

export async function startTui(
  DashboardComp: DashboardComponent,
  StoreCtor: StoreConstructor,
): Promise<void> {
  installRuntimeErrorCapture();
  const root = await resolveRootForSession();
  // Create Store once outside the resume loop so selections, cursor, filters,
  // undo stack, and status log persist across foreground app launches (o key).
  const store = new StoreCtor(root);
  let resumeRequested = true;
  let resumedFromApp = false;
  while (resumeRequested) {
    resumeRequested = false;
    if (resumedFromApp) {
      await store.refreshLocalState();
      resumedFromApp = false;
    }
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      clearOnShutdown: true,
      useMouse: true,
    });
    createRoot(renderer).render(
      <DashboardComp
        store={store}
        onQuit={() => void renderer.destroy()}
        onSuspendAndRun={async (run) => {
          resumeRequested = true;
          resumedFromApp = true;
          await renderer.destroy();
          try {
            await run();
          } catch {
            /* the app failed to start; resume the dashboard anyway */
          }
        }}
      />,
    );
    while (!renderer.isDestroyed) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
}

await bootstrap();
