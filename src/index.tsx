import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { resolveThemeName } from "./components/theme.ts";
import { readSettings, resolveRootForSession } from "./services/settings.ts";

async function bootstrap(): Promise<void> {
  // Resolve the palette BEFORE importing the components: modals capture
  // theme colors in module-level constants at import time.
  const [{ activateTheme }, settings] = await Promise.all([
    import("./components/theme.ts"),
    readSettings(),
  ]);
  activateTheme(resolveThemeName(process.env.REPOTRUCK_THEME, settings.theme));
  const [{ Dashboard }, { Store }] = await Promise.all([
    import("./components/Dashboard.tsx"),
    import("./components/store.ts"),
  ]);
  await startTui(Dashboard, Store);
}

type DashboardComponent = typeof import("./components/Dashboard.tsx").Dashboard;
type StoreConstructor = typeof import("./components/store.ts").Store;

export async function startTui(
  Dashboard: DashboardComponent,
  Store: StoreConstructor,
): Promise<void> {
  const root = await resolveRootForSession();
  let resumeRequested = true;
  while (resumeRequested) {
    resumeRequested = false;
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      clearOnShutdown: true,
      // Wheel + click reporting; the store maps events to list rows/focus.
      useMouse: true,
    });
    const store = new Store(root);
    createRoot(renderer).render(
      <Dashboard
        store={store}
        onQuit={() => void renderer.destroy()}
        onSuspendAndRun={async (run) => {
          resumeRequested = true;
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
