// Central palette for the TUI. The active palette is selected with
// REPOTRUCK_THEME or the `theme` setting (`default`, `light`, `contrast`);
// NO_COLOR still wins over every color by resolving them to undefined.
function colorDisabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const noColor = env?.env?.NO_COLOR;
  return noColor !== undefined && noColor !== "";
}

type Fg = string | undefined;

function fg(value: string): Fg {
  return colorDisabled() ? undefined : value;
}

export type ThemeName = "default" | "light" | "contrast";

export const THEME_NAMES: readonly ThemeName[] = ["default", "light", "contrast"];

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && (THEME_NAMES as readonly string[]).includes(value);
}

/** Environment always wins over the persisted `theme` setting. */
export function resolveThemeName(
  envValue?: string | undefined,
  settingsValue?: string | undefined,
): ThemeName {
  if (isThemeName(envValue)) return envValue;
  if (isThemeName(settingsValue)) return settingsValue;
  return "default";
}

export interface Palette {
  dim: string;
  normal: string;
  muted: string;
  cursorFg: string;
  cursorBg: string;
  focusBorder: string;
  border: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  toast: string;
  launcher: string;
}

const DEFAULT_PALETTE: Palette = {
  dim: "#6e7681",
  normal: "#c9d1d9",
  muted: "#8b949e",
  cursorFg: "#ffffff",
  cursorBg: "#21262d",
  focusBorder: "#d2a8ff",
  border: "#30363d",
  accent: "#58a6ff",
  error: "#f85149",
  warning: "#e3b341",
  success: "#3fb950",
  info: "#39c5cf",
  toast: "#f78166",
  launcher: "#f78166",
};

const LIGHT_PALETTE: Palette = {
  dim: "#57606a",
  normal: "#24292f",
  muted: "#6e7781",
  cursorFg: "#ffffff",
  cursorBg: "#0969da",
  focusBorder: "#8250df",
  border: "#d0d7de",
  accent: "#0969da",
  error: "#cf222e",
  warning: "#9a6700",
  success: "#116329",
  info: "#1b7c83",
  toast: "#bc4c00",
  launcher: "#bc4c00",
};

const CONTRAST_PALETTE: Palette = {
  dim: "#b0b0b0",
  normal: "#ffffff",
  muted: "#d0d0d0",
  cursorFg: "#000000",
  cursorBg: "#ffffff",
  focusBorder: "#ffff00",
  border: "#808080",
  accent: "#00e5ff",
  error: "#ff6b6b",
  warning: "#ffe066",
  success: "#6bff8f",
  info: "#7fe9ff",
  toast: "#ffb066",
  launcher: "#ffb066",
};

const PALETTES: Record<ThemeName, Palette> = {
  default: DEFAULT_PALETTE,
  light: LIGHT_PALETTE,
  contrast: CONTRAST_PALETTE,
};

// Raw palette values for the default theme (tests assert these equal the
// legacy inline constants).
export const PALETTE = DEFAULT_PALETTE;

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

let active: ThemeName = resolveThemeName(ENV?.REPOTRUCK_THEME);

/** Switches the active palette; called once at dashboard startup. */
export function activateTheme(name: ThemeName): void {
  if (PALETTES[name] !== undefined) active = name;
}

export function activeThemeName(): ThemeName {
  return active;
}

function c(key: keyof Palette): Fg {
  return fg(PALETTES[active][key]);
}

export const theme = {
  dim: (): Fg => c("dim"),
  normal: (): Fg => c("normal"),
  muted: (): Fg => c("muted"),
  cursorFg: (): Fg => c("cursorFg"),
  cursorBg: (): Fg => c("cursorBg"),
  focusBorder: (): Fg => c("focusBorder"),
  border: (): Fg => c("border"),
  accent: (): Fg => c("accent"),
  error: (): Fg => c("error"),
  warning: (): Fg => c("warning"),
  success: (): Fg => c("success"),
  info: (): Fg => c("info"),
  toast: (): Fg => c("toast"),
  // Warm accent for the launch-flavored modals (open-in-app, alias, root,
  // start preview). Same value as the toast color but a distinct semantic.
  launcher: (): Fg => c("launcher"),
  phaseColor: (phase: "CLONING" | "PULLING" | "DONE" | "FAILED"): Fg => {
    if (phase === "CLONING") return c("warning");
    if (phase === "PULLING") return c("info");
    if (phase === "DONE") return c("success");
    return c("error");
  },
};
