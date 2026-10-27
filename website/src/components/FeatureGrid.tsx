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
    body: "repotruck mcp exposes the whole workspace to coding agents as native MCP tools, resources, and prompt workflows.",
  },
  {
    title: "Worktree manager",
    body: "repotruck worktree lists, scans orphaned, creates linked checkouts, and safely removes git worktrees with interactive TUI modal (Shift+W) and CLI commands.",
  },
  {
    title: "Sync & rebase resolution",
    body: "repotruck sync resolve inspects diverged merges, rebases, and cherry-picks, offering guided step-by-step resolution with continue and abort helpers.",
  },
  {
    title: "Multi-agent rules export",
    body: "repotruck instructions export writes customized workspace guides to .cursorrules, CLAUDE.md, .github/copilot-instructions.md, and AGENTS.md.",
  },
  {
    title: "Cross-repo changelog",
    body: "repotruck changelog aggregates git commits across all tracked repositories into grouped conventional release notes in Markdown or JSON.",
  },
  {
    title: "Workspace health scoreboard",
    body: "repotruck stats --health evaluates cleanliness, sync, focus, hygiene, and doctor diagnostics with actionable remediation tips and letter grades (A+ to F).",
  },
  {
    title: "Commit signature verification",
    body: "repotruck doctor --check-signing verifies GPG/SSH commit signatures and git signing configuration, surfaced in the TUI Inspector status bar.",
  },
  {
    title: "Sparse monorepo clone",
    body: "repotruck clone <url> --sparse <dirs...> clones only the subdirectories you need, keeping monorepo disk footprints minimal across background syncs.",
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
    title: "Deep git status & diff bars",
    body: "repotruck status -D analyzes dirty files, diff histograms (+/- bars), and unpushed commits at a glance, with CI status check and filter flags.",
  },
  {
    title: "Tree-sitter symbol search",
    body: "repotruck search-code indexes symbols across every tracked repo with Tree-sitter for fast lookups by kind (function, class, const, ...) or language.",
  },
  {
    title: "Parallel command runner",
    body: "repotruck run executes arbitrary shell commands across all or targeted repositories concurrently, reporting per-repo exit codes and timings.",
  },
  {
    title: "Discovery & layout adoption",
    body: "repotruck scan discovers untracked git repositories across directories and automatically moves them into your workspace's preset structure.",
  },
  {
    title: "Automatic snapshots & restore",
    body: "repotruck backup preserves 5 generations of timestamped inventory snapshots on every save, with instant recovery via repotruck backup restore.",
  },
  {
    title: "Aliases & app launcher",
    body: "Assign short names with repotruck alias and launch directly into Claude, Cursor, VS Code, or custom tools via repotruck open.",
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
