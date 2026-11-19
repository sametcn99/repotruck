import { theme } from "../theme.ts";
import type { ViewSpec } from "./viewRegistry.ts";

/**
 * Temporary page body for views whose implementing ticket has not landed
 * yet. Every placeholder shows what the page will do and which ticket
 * builds it, so the nav rail is complete from day one.
 */
export function PlaceholderView({ spec }: { spec: ViewSpec; width: number }) {
  return (
    <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
      <text fg={theme.accent()}>{spec.title}</text>
      <text fg={theme.normal()}>{spec.summary}</text>
      <text fg={theme.dim()}>
        {`arriving with ${spec.ticket} — reach the palette with : meanwhile`}
      </text>
    </box>
  );
}
