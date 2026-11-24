/** Shared product identity for the headless CLI and the dashboard. */
export const APP_NAME = "Repotruck";
export const APP_DESCRIPTION =
  "Clone, organize and sync your GitHub repositories in one local workspace.";
export const APP_GITHUB_URL = "https://github.com/sametcn99/repotruck";

export function formatAbout(): string {
  return `${APP_NAME}\n${APP_DESCRIPTION}\nGitHub: ${APP_GITHUB_URL}\n`;
}
