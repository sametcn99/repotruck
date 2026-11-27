import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

declare const REPOTRUCK_BUILD_VERSION: string | undefined;

export const standaloneVersion =
  typeof REPOTRUCK_BUILD_VERSION === "string" ? REPOTRUCK_BUILD_VERSION : undefined;
export const RELEASES_URL = "https://github.com/sametcn99/repotruck/releases";
export const LATEST_RELEASE_API =
  "https://api.github.com/repos/sametcn99/repotruck/releases/latest";

export function distributionDirectory(): string | undefined {
  return standaloneVersion === undefined ? undefined : path.dirname(realpathSync(process.execPath));
}

export function standaloneUpdateCommand(): string | undefined {
  const directory = distributionDirectory();
  if (!directory) return undefined;
  let channel = "";
  try {
    channel = readFileSync(path.join(directory, "install-channel"), "utf8").trim();
  } catch {
    // An extracted release archive has no install channel marker.
  }
  switch (channel) {
    case "homebrew":
      return "brew upgrade sametcn99/repotruck/repotruck";
    case "scoop":
      return "scoop update repotruck";
    case "installer":
      return process.platform === "win32"
        ? `irm ${RELEASES_URL}/latest/download/install.ps1 | iex`
        : `curl -fsSL ${RELEASES_URL}/latest/download/install.sh | sh`;
    default:
      return undefined;
  }
}

export function standaloneUpdateInstructions(): string {
  if (!standaloneVersion) return "";
  const command = standaloneUpdateCommand();
  return command
    ? `Run this update command:\n${command}`
    : `Download and extract the new archive from ${RELEASES_URL}/latest`;
}
