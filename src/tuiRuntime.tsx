import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { Dashboard } from "./components/Dashboard.tsx";
import type { Store } from "./components/store.ts";
import { firstErrorLine } from "./services/cloner.ts";
import { logDiag } from "./services/diagnostics.ts";
import { resolveRootForSession } from "./services/settings.ts";

export function installRuntimeErrorCapture(): () => void {
  const rejected = (reason: unknown) => {
    logDiag("error", "[runtime]", `unhandled rejection: ${firstErrorLine(reason)}`);
  };
  const uncaught = (error: Error) => {
    logDiag("error", "[runtime]", `uncaught exception: ${firstErrorLine(error)}`);
  };
  process.on("unhandledRejection", rejected);
  process.on("uncaughtException", uncaught);
  return () => {
    process.off("unhandledRejection", rejected);
    process.off("uncaughtException", uncaught);
  };
}

export async function startTui(
  DashboardComp: typeof Dashboard,
  StoreCtor: typeof Store,
  deps: {
    resolveRoot?: typeof resolveRootForSession;
    createRenderer?: typeof createCliRenderer;
  } = {},
): Promise<void> {
  const uninstall = installRuntimeErrorCapture();
  let store: Store | undefined;
  try {
    store = new StoreCtor(await (deps.resolveRoot ?? resolveRootForSession)());
    let resumeRequested = true;
    let resumedFromApp = false;
    while (resumeRequested) {
      resumeRequested = false;
      if (resumedFromApp) {
        await store.refreshLocalState();
        resumedFromApp = false;
      }
      const renderer = await (deps.createRenderer ?? createCliRenderer)({
        exitOnCtrlC: true,
        clearOnShutdown: true,
        useMouse: true,
      });
      let pendingApp: Promise<void> | undefined;
      let suspending = false;
      try {
        createRoot(renderer).render(
          <DashboardComp
            store={store}
            onQuit={() => void renderer.destroy()}
            onSuspendAndRun={(run) => {
              if (suspending) return pendingApp ?? Promise.resolve();
              suspending = true;
              resumeRequested = true;
              resumedFromApp = true;
              pendingApp = (async () => {
                renderer.destroy();
                await renderer.closed;
                try {
                  const code = await run();
                  if (code !== 0)
                    store!.pushStatus("FAILED", "[app]", `exit ${code} — application closed`);
                } catch (error) {
                  store!.pushStatus("FAILED", "[app]", firstErrorLine(error));
                }
              })();
              return pendingApp;
            }}
          />,
        );
        while (!renderer.isDestroyed) await new Promise((resolve) => setTimeout(resolve, 40));
        await pendingApp;
      } finally {
        if (!renderer.isDestroyed) renderer.destroy();
        await renderer.closed;
      }
    }
  } finally {
    store?.dispose();
    uninstall();
  }
}
