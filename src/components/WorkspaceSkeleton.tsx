import { useEffect, useState } from "react";
import { theme } from "./theme.ts";
import { sidebarWidth, statusWidth } from "./windowing.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SkeletonPattern {
  nameLen: number;
  langLen: number;
  badge?: string;
}

const SKELETON_PATTERNS: readonly SkeletonPattern[] = [
  { nameLen: 16, langLen: 4, badge: "internal" },
  { nameLen: 12, langLen: 6 },
  { nameLen: 22, langLen: 4, badge: "archived" },
  { nameLen: 14, langLen: 5 },
  { nameLen: 9, langLen: 4 },
  { nameLen: 18, langLen: 6, badge: "fork" },
  { nameLen: 24, langLen: 4 },
  { nameLen: 13, langLen: 5 },
  { nameLen: 15, langLen: 4, badge: "internal" },
  { nameLen: 20, langLen: 6 },
  { nameLen: 11, langLen: 4 },
  { nameLen: 17, langLen: 5, badge: "archived" },
  { nameLen: 23, langLen: 4 },
  { nameLen: 10, langLen: 6 },
  { nameLen: 19, langLen: 4, badge: "fork" },
  { nameLen: 14, langLen: 5 },
  { nameLen: 21, langLen: 4 },
  { nameLen: 12, langLen: 6, badge: "internal" },
  { nameLen: 16, langLen: 5 },
  { nameLen: 25, langLen: 4 },
  { nameLen: 15, langLen: 6 },
  { nameLen: 18, langLen: 4, badge: "archived" },
];

const DISCOVERY_STEPS = [
  "Authenticate GitHub",
  "Discover organizations",
  "Fetch repositories",
  "Load workspace config",
];

export interface WorkspaceSkeletonProps {
  width: number;
  height: number;
  preset?: string;
}

export function WorkspaceSkeleton({
  width,
  height,
  preset = "categorized",
}: WorkspaceSkeletonProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % 60);
    }, 100);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
    return () => {
      clearInterval(timer);
    };
  }, []);

  const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
  const shimmerIndex = frame % 5;
  const currentStep = Math.min(DISCOVERY_STEPS.length - 1, Math.floor(frame / 6));

  const sWidth = sidebarWidth(width);
  const stWidth = statusWidth(width);
  const centerWidth = Math.max(16, width - sWidth - stWidth - 4);

  // Available vertical rows inside Repositories box:
  const availableRows = Math.max(3, Math.min(SKELETON_PATTERNS.length, (height ?? 24) - 13));
  const visiblePatterns = SKELETON_PATTERNS.slice(0, availableRows);

  const innerScopeW = Math.max(8, sWidth - 4);
  const innerStatusW = Math.max(8, stWidth - 4);

  const titleText = centerWidth < 25 ? "Loading…" : "Loading workspace…";
  const subText = centerWidth < 25 ? "Discovering…" : "Discovering repositories…";

  return (
    <box flexDirection="row" flexGrow={1} width="100%">
      {/* 1. Scope Skeleton Panel */}
      <box title="Scope" border borderColor={theme.border()} width={sWidth} flexDirection="column">
        <text fg={theme.dim()}>SCOPE</text>
        <text fg={theme.dim()}> [ ] Personal repos</text>
        <text fg={theme.border()}>{`  [ ] ${"░".repeat(Math.min(10, innerScopeW - 6))}`}</text>
        <text fg={theme.border()}>{`  [ ] ${"░".repeat(Math.min(14, innerScopeW - 6))}`}</text>
        <text fg={theme.dim()}>PRESET</text>
        <text fg={theme.muted()}>{`      ${preset}`}</text>
        <text fg={theme.dim()}>FILTERS</text>
        <text fg={theme.border()}> [x] active</text>
        <text fg={theme.border()}> [x] forks</text>
        <text fg={theme.border()}> [x] archived</text>
      </box>

      {/* 2. Repositories Skeleton Panel */}
      <box
        title="Repositories"
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg={theme.accent()}>{`  ${spinner} ${titleText}`}</text>
        <text fg={theme.dim()}>{`   ${subText}`}</text>
        <text> </text>
        {visiblePatterns.map((pattern, idx) => {
          const isShimmer = idx % 5 === shimmerIndex;
          const barChar = isShimmer ? "▒" : "░";
          const rowFg = isShimmer ? theme.dim() : theme.border();
          const maxNameBar = Math.max(6, centerWidth - 22);
          const nameLen = Math.min(pattern.nameLen, maxNameBar);
          const nameBar = barChar.repeat(nameLen);

          const showLang = centerWidth > 32;
          const showBadge = centerWidth > 46 && pattern.badge !== undefined;

          const langPart = showLang ? ` [${barChar.repeat(pattern.langLen)}]` : "";
          const badgePart = showBadge ? ` [${barChar.repeat(pattern.badge!.length)}]` : "";

          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows have no unique entity id
            <text key={idx} fg={rowFg}>
              {`  [ ] ${nameBar}${langPart}${badgePart}`}
            </text>
          );
        })}
        <text> </text>
        <text fg={theme.dim()}>{`  ${spinner} Scanning repositories…`}</text>
      </box>

      {/* 3. Status Skeleton Panel */}
      <box
        title="Status"
        border
        borderColor={theme.border()}
        width={stWidth}
        flexDirection="column"
      >
        <text fg={theme.dim()}>0 cloning · 0 pulling · 0 done · 0 failed</text>
        <text> </text>
        <text fg={theme.dim()}>DISCOVERY</text>
        {DISCOVERY_STEPS.map((stepLabel, idx) => {
          if (idx < currentStep) {
            return (
              <text key={stepLabel} fg={theme.success()}>
                {`  ✓ ${stepLabel}`}
              </text>
            );
          }
          if (idx === currentStep) {
            return (
              <text key={stepLabel} fg={theme.accent()}>
                {`  ${spinner} ${stepLabel}`}
              </text>
            );
          }
          return (
            <text key={stepLabel} fg={theme.border()}>
              {`  · ${stepLabel}`}
            </text>
          );
        })}
        <text> </text>
        <text fg={theme.dim()}>ACTIVITY</text>
        <text fg={theme.border()}>{`  ${"░".repeat(Math.min(20, innerStatusW - 4))}`}</text>
        <text fg={theme.border()}>{`  ${"░".repeat(Math.min(14, innerStatusW - 4))}`}</text>
        <text fg={theme.border()}>{`  ${"░".repeat(Math.min(17, innerStatusW - 4))}`}</text>
      </box>
    </box>
  );
}
