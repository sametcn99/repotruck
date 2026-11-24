import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import { APP_DESCRIPTION, APP_GITHUB_URL, APP_NAME } from "../../services/about.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

export function AboutView({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const compact = useTerminalDimensions().height < 26;
  const star = snapshot.projectStar;
  useEffect(() => {
    void store.refreshProjectStar();
    return () => store.cancelProjectStar();
  }, [store]);
  const activate = () => {
    if (
      store.getSnapshot().modal !== null ||
      store.getSnapshot().dialog !== null ||
      store.getSnapshot().contextMenu !== null ||
      store.getSnapshot().navFocused
    )
      return;
    void store.giveProjectStar();
  };
  useKeyboard((key) => {
    const current = store.getSnapshot();
    if (
      current.modal !== null ||
      current.dialog !== null ||
      current.contextMenu !== null ||
      current.navFocused ||
      key.ctrl ||
      key.meta ||
      key.shift
    )
      return;
    if (key.name === "s" || key.name === "return") activate();
    if (key.name === "r") void store.refreshProjectStar();
  });
  return (
    <scrollbox
      flexGrow={1}
      focused={
        snapshot.modal === null &&
        snapshot.dialog === null &&
        snapshot.contextMenu === null &&
        !snapshot.navFocused
      }
      contentOptions={{ flexDirection: "column", gap: compact ? 0 : 1, padding: compact ? 0 : 1 }}
    >
      <text flexShrink={0} fg={theme.accent()}>
        {APP_NAME}
      </text>
      <text flexShrink={0} fg={theme.normal()}>
        {APP_DESCRIPTION}
      </text>
      <text flexShrink={0} fg={theme.normal()}>
        GitHub
      </text>
      <text flexShrink={0} fg={theme.accent()}>
        {APP_GITHUB_URL}
      </text>
      {star.status === "available" && (
        <box
          id="give-star"
          border
          borderColor={theme.accent()}
          paddingLeft={1}
          paddingRight={1}
          alignSelf="flex-start"
          flexShrink={0}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            activate();
          }}
        >
          <text fg={theme.accent()}>Give star [s / Enter]</text>
        </box>
      )}
      {star.status === "checking" && (
        <text flexShrink={0} fg={theme.muted()}>
          Checking GitHub star status…
        </text>
      )}
      {star.status === "submitting" && (
        <text flexShrink={0} fg={theme.muted()}>
          Giving star and verifying…
        </text>
      )}
      {star.status === "starred" && (
        <text flexShrink={0} fg={theme.success()}>
          Thanks for your star!
        </text>
      )}
      {(star.status === "error" || star.status === "unavailable") && (
        <text flexShrink={0} fg={theme.muted()}>
          {star.message} [r] Retry check
        </text>
      )}
      <text flexShrink={0} fg={theme.muted()}>
        CLI: repotruck --about · Esc returns to Cockpit
      </text>
    </scrollbox>
  );
}
