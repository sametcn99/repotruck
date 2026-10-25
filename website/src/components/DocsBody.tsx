import { COMMAND_GROUPS, DIVERGENCE_ROWS, GLOBAL_FLAGS, SETTING_ROWS } from "./CommandReference.ts";
import { CopyButton } from "./CopyButton.tsx";

function FlagTable({ flags }: { flags: readonly { flag: string; description: string }[] }) {
  return (
    <table className="data-table flag-table">
      <thead>
        <tr>
          <th scope="col">Flag</th>
          <th scope="col">Effect</th>
        </tr>
      </thead>
      <tbody>
        {flags.map((flag) => (
          <tr key={flag.flag}>
            <td data-label="Flag" className="path">
              {flag.flag}
            </td>
            <td data-label="Effect">{flag.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommandBlock({
  command,
}: {
  command: (typeof COMMAND_GROUPS)[number]["commands"][number];
}) {
  return (
    <div className="panel command-doc" id={`cmd-${command.name}`}>
      <span className="panel-label">command</span>
      <h3>
        <code className="path">{command.usage}</code>
      </h3>
      <p>{command.summary}</p>
      <div className="cli-examples">
        {command.examples.map((example) => (
          <div className="cli-example" key={example}>
            <span className="copy-command wrap">
              <span className="prompt">$ </span>
              {example}
            </span>
            <CopyButton command={example} />
          </div>
        ))}
      </div>
      {command.flags !== undefined && command.flags.length > 0 ? (
        <FlagTable flags={command.flags} />
      ) : null}
    </div>
  );
}

export function DocsBody() {
  return (
    <>
      <section className="section" id="cli" aria-label="Headless CLI reference">
        <h2>Headless CLI</h2>
        <p className="section-sub">
          The dashboard is optional. Every workspace operation is a plain subcommand — scriptable,
          CI-friendly and happy without a TTY. The full reference below covers all 27 commands in
          six groups; run <code>repotruck &lt;command&gt; --help</code> for the live flag list.
        </p>
        {COMMAND_GROUPS.map((group) => (
          <div className="command-group" key={group.id} id={group.id} data-toc-sub={group.title}>
            <h3>{group.title}</h3>
            <p className="section-sub">{group.blurb}</p>
            {group.commands.map((command) => (
              <CommandBlock key={command.name} command={command} />
            ))}
          </div>
        ))}
        <div className="panel">
          <span className="panel-label">Global flags</span>
          <p>
            Most workspace commands accept these; they select where the operation runs and which
            layout new clones follow.
          </p>
          <FlagTable flags={GLOBAL_FLAGS} />
        </div>
        <p className="cli-footnote">
          All subcommands exit non-zero on failure so you can chain them in scripts and CI.
        </p>
      </section>

      <section className="section" id="settings" aria-label="Settings">
        <h2>Settings</h2>
        <p className="section-sub">
          <code>repotruck config get/set/list</code> reads and writes <code>settings.json</code> in
          the app config dir. Every key prints its current value and whether it comes from settings
          or the default.
        </p>
        <div className="panel">
          <span className="panel-label">Keys</span>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Default</th>
                <th scope="col">Controls</th>
              </tr>
            </thead>
            <tbody>
              {SETTING_ROWS.map((row) => (
                <tr key={row.key}>
                  <td data-label="Key" className="path">
                    {row.key}
                  </td>
                  <td data-label="Default">{row.value}</td>
                  <td data-label="Controls">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" id="divergence" aria-label="Divergence strategies">
        <h2>Divergence strategies</h2>
        <p className="section-sub">
          When a repository has local commits ahead of its origin, <code>sync --divergence</code>{" "}
          decides what happens. Dirty trees are stashed first when <code>--stash</code> is set.
        </p>
        <div className="panel">
          <span className="panel-label">Strategies</span>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col">Behavior</th>
              </tr>
            </thead>
            <tbody>
              {DIVERGENCE_ROWS.map((row) => (
                <tr key={row.strategy}>
                  <td data-label="Strategy" className="path">
                    {row.strategy}
                  </td>
                  <td data-label="Behavior">{row.behavior}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
