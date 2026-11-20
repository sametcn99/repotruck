import { useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

/**
 * Non-blocking GitHub device-flow login (`repotruck auth login`): shows
 * the verification URL and user code prominently while the token exchange
 * polls in the background; completing re-initializes the workspace.
 */
export function DeviceFlowModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const flow = snapshot.deviceFlow;
  const accent = theme.launcher();

  return (
    <ModalShell
      store={store}
      title="GitHub login · device flow"
      hint="authorization continues in the background · Esc cancels"
      borderColor={accent}
    >
      {flow === null ? (
        <text fg={theme.dim()}>{"starting…"}</text>
      ) : flow.error !== null ? (
        <box flexDirection="column" gap={1}>
          <text fg={theme.error()}>{flow.error}</text>
          <text fg={theme.dim()}>
            {"set REPOTRUCK_OAUTH_CLIENT_ID or use 'gh auth login' instead"}
          </text>
        </box>
      ) : flow.loading ? (
        <text fg={theme.dim()}>{"requesting a device code from GitHub…"}</text>
      ) : (
        <box flexDirection="column" gap={1} alignItems="center">
          <text fg={theme.normal()}>{"open in your browser:"}</text>
          <text fg={accent}>{flow.verificationUri ?? ""}</text>
          <text fg={theme.normal()}>{"enter this code:"}</text>
          <text fg={accent}>{`  ${flow.userCode ?? ""}  `}</text>
          <text fg={theme.dim()}>{"waiting for authorization…"}</text>
        </box>
      )}
      <text
        fg={theme.dim()}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          store.cancelDeviceFlow();
        }}
      >
        {"[ Cancel ]"}
      </text>
    </ModalShell>
  );
}
