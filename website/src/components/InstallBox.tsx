import { CopyButton } from "./CopyButton.tsx";

const COMMANDS: readonly string[] = [
  "npx repotruck",
  "bunx repotruck",
  "npm i -g repotruck",
  "bun add -g repotruck",
];

export function InstallBox() {
  return (
    <section className="section" id="install" aria-label="Install">
      <h2>Install</h2>
      <p className="section-sub">
        Available on{" "}
        <a href="https://www.npmjs.com/package/repotruck" target="_blank" rel="noreferrer">
          npm
        </a>
        . Run it straight from the registry, or install it globally.
      </p>
      <div className="panel terminal">
        <span className="panel-label">shell</span>
        {COMMANDS.map((command) => (
          <div key={command} className="copy-row">
            <span className="copy-command">
              <span className="prompt">$ </span>
              {command}
            </span>
            <CopyButton command={command} />
          </div>
        ))}
      </div>
    </section>
  );
}
