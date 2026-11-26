import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { act, type ReactNode } from "react";
import { StoreBase } from "../../src/components/store/StoreBase.ts";

// Flush external Store/input notifications and their promise continuations.
// React diagnostics remain enabled; the coverage gate rejects unexpected ones.
const pendingActs = new Set<Promise<unknown>>();
let activeScopes = 0,
  flushing = false;
async function runAct(fn: () => void | Promise<void>): Promise<void> {
  if (activeScopes) {
    await fn();
    return;
  }
  activeScopes++;
  try {
    await act(fn);
  } finally {
    activeScopes--;
  }
}
function syncAct(fn: () => void, forceFlush = false): void {
  if (activeScopes || flushing) {
    if (forceFlush && !flushing) {
      flushing = true;
      try {
        flushSync(fn);
      } finally {
        flushing = false;
      }
    } else fn();
    return;
  }
  const pending = runAct(async () => {
    flushing = true;
    try {
      flushSync(fn);
    } finally {
      flushing = false;
    }
    await Promise.resolve();
  });
  pendingActs.add(pending);
  void pending.finally(() => pendingActs.delete(pending));
}
async function drainActs(): Promise<void> {
  while (pendingActs.size) await Promise.all([...pendingActs]);
}
const prototype = StoreBase.prototype as unknown as {
  set: (...args: unknown[]) => void;
  __actWrapped?: boolean;
};
if (!prototype.__actWrapped) {
  const original = prototype.set;
  prototype.set = function (...args) {
    if ((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT)
      syncAct(() => original.apply(this, args));
    else original.apply(this, args);
  };
  prototype.__actWrapped = true;
}
export async function testRender(node: ReactNode, options: TestRendererOptions) {
  await drainActs();
  const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  let root: ReturnType<typeof createRoot> | null = null;
  const setup = await createTestRenderer({
    ...options,
    onDestroy() {
      syncAct(() => {
        root?.unmount();
        root = null;
      });
      options.onDestroy?.();
      actGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    },
  });
  root = createRoot(setup.renderer);
  await runAct(async () => {
    flushing = true;
    try {
      flushSync(() => root!.render(node));
    } finally {
      flushing = false;
    }
  });
  for (const target of [setup.mockInput, setup.mockMouse])
    for (const name of Object.keys(target)) {
      const record = target as unknown as Record<string, unknown>,
        original = record[name];
      if (typeof original !== "function") continue;
      record[name] = (...values: unknown[]) => {
        let result: unknown;
        syncAct(() => {
          result = original.apply(target, values);
        });
        return result;
      };
    }
  for (const emitter of [setup.renderer, setup.renderer.keyInput]) {
    const original = emitter.emit.bind(emitter);
    emitter.emit = ((...values: Parameters<typeof original>) => {
      let result = false;
      syncAct(() => {
        result = original(...values);
      }, emitter === setup.renderer.keyInput);
      return result;
    }) as typeof emitter.emit;
  }
  const destroy = setup.renderer.destroy.bind(setup.renderer);
  setup.renderer.destroy = () => syncAct(destroy);
  const resize = setup.resize;
  setup.resize = (...values) => syncAct(() => resize(...values));
  const renderOnce = setup.renderOnce;
  setup.renderOnce = async () => {
    await drainActs();
    await runAct(renderOnce);
  };
  const flush = setup.flush.bind(setup);
  setup.flush = async (...values) => {
    await drainActs();
    await runAct(async () => {
      await flush(...values);
    });
  };
  return setup;
}
export async function settleRender(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await drainActs();
  await runAct(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    await setup.flush({ maxPasses: 4 });
  });
}

// Keep loading animations and the transition to the ready dashboard inside act.
export async function waitForDashboardReady(
  setup: Awaited<ReturnType<typeof testRender>>,
  store: StoreBase,
): Promise<void> {
  const deadline = performance.now() + 2500;
  do {
    await settleRender(setup);
    const { phase, errorMessage } = store.getSnapshot();
    if (phase === "ready") return;
    if (phase === "error") throw new Error(errorMessage ?? "Dashboard initialization failed");
  } while (performance.now() < deadline);
  throw new Error("Timed out waiting for the dashboard to become ready");
}
