const FEATURES: readonly { title: string; body: string }[] = [
  {
    title: "Bulk clone & update",
    body: "repotruck sync clones every repository in scope and keeps the workspace fresh with fast-forward pulls on every later run.",
  },
  {
    title: "Presets",
    body: "sixteen layouts, from categorized to language-first; repotruck reorganize re-files everything when you change your mind.",
  },
  {
    title: "AGENTS.md workspace map",
    body: "An auto-generated map with workspace metadata, the internal/community split and agent rules, rewritten on every run.",
  },
  {
    title: "Built-in MCP server",
    body: "repotruck mcp exposes the whole workspace to coding agents as native MCP tools: discovery, search, sync, clone, create, move and reorganize.",
  },
  {
    title: "Workspace memory",
    body: "One central repotruck.json in the app config dir remembers every workspace: preset, repository inventory, last sync and last use. Jump between them from the dashboard.",
  },
  {
    title: "Move with automatic AGENTS.md updates",
    body: "repotruck move relocates any tracked repository to a custom path and marks it manually placed; the inventory and map rewrite themselves.",
  },
  {
    title: "Create & import repositories",
    body: "Create new GitHub repositories directly into their target layout, or import an existing local directory with a clean Git tree.",
  },
  {
    title: "Cross-platform npx",
    body: "One command on Windows, macOS and Linux. Node.js 20+ for the headless CLI; no installation required via npx or bunx.",
  },
];

export function FeatureGrid() {
  return (
    <section className="section" id="features" aria-label="Features">
      <h2>Features</h2>
      <p className="section-sub">Everything the dashboard and the headless CLI share.</p>
      <div className="feature-grid">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="panel feature">
            <span className="panel-label">{feature.title}</span>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
