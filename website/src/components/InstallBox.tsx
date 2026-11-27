import { CopyButton } from "./CopyButton.tsx";

const RELEASES = "https://github.com/sametcn99/repotruck/releases/latest";
const CHANNELS = [
  {
    label: "Linux, macOS, or Git Bash",
    commands: [`curl -fsSL ${RELEASES}/download/install.sh | sh`],
  },
  {
    label: "Windows PowerShell",
    commands: [`irm ${RELEASES}/download/install.ps1 | iex`],
  },
  {
    label: "Homebrew on macOS",
    commands: [
      "brew tap sametcn99/repotruck https://github.com/sametcn99/repotruck.git && brew install sametcn99/repotruck/repotruck",
    ],
  },
  {
    label: "Scoop on Windows",
    commands: [
      "scoop bucket add repotruck https://github.com/sametcn99/repotruck.git; if ($LASTEXITCODE -eq 0) { scoop install repotruck/repotruck }",
    ],
  },
  {
    label: "npm and Bun",
    commands: ["npx repotruck", "bunx repotruck", "npm i -g repotruck", "bun add -g repotruck"],
  },
];

export function InstallBox() {
  return (
    <section className="section" id="install" aria-label="Install">
      <h2>Install</h2>
      <p className="section-sub">
        Install for x64 or ARM64 without Node.js or Bun. Download an{" "}
        <a href={RELEASES}>archive from GitHub Releases</a> or use one of the commands below. The{" "}
        <a href="https://www.npmjs.com/package/repotruck" target="_blank" rel="noreferrer">
          npm package
        </a>{" "}
        is also available.
      </p>
      <div className="panel terminal">
        {CHANNELS.map(({ label, commands }) => (
          <div key={label} role="group" aria-label={label}>
            <span className="panel-label">{label}</span>
            {commands.map((command) => (
              <div key={command} className="copy-row">
                <span className="copy-command wrap">{command}</span>
                <CopyButton command={command} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
