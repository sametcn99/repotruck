const ITEMS: readonly { question: string; answer: string }[] = [
  {
    question: "How does repotruck authenticate?",
    answer:
      "The GitHub CLI is preferred: run `gh auth login` once and repotruck picks up its token. Without gh, repotruck falls back to a cached device-flow token, or starts a device flow when REPOTRUCK_OAUTH_CLIENT_ID is set (an OAuth App client ID; no callback URL needed).",
  },
  {
    question: "Is my token safe?",
    answer:
      "Tokens are never written into workspace files or .git/config. Clones and pulls use a one-shot credential header, the clone origin is reset to the clean HTTPS URL immediately, and failures print the first error line with the token redacted.",
  },
  {
    question: "What is AGENTS.md for?",
    answer:
      "It is a machine-readable map of the workspace for coding agents: metadata (preset, last sync, counts), the internal/community split with relative paths, and agent rules (independent Git projects, search exclusions, community repos are read-only). It is rewritten on every sync, clone, move and create.",
  },
  {
    question: "Can agents use repotruck directly?",
    answer:
      'Yes. `repotruck mcp` runs a Model Context Protocol server on stdio that exposes the workspace as agent tools: list and search repositories, resolve owner/name or alias to an absolute path, read AGENTS.md, and run sync, clone, create, move and reorganize. Add it to Claude Code with `claude mcp add repotruck -- repotruck mcp`, or to any MCP client\'s mcpServers config with command `npx` and args ["-y", "repotruck", "mcp"].',
  },
  {
    question: "Does changing the preset move my repositories?",
    answer:
      "No. The preset affects new clones and creates only. To re-file existing repositories, run `repotruck reorganize <preset>` — preview it with --dry-run and spare manually placed repositories with --keep-custom.",
  },
  {
    question: "What are the requirements?",
    answer:
      "The interactive dashboard needs Node.js >= 26.4 or Bun >= 1.3.14. The headless CLI commands run on Node.js >= 20. git must be on your PATH; the GitHub CLI is optional but is the easiest authentication path.",
  },
];

export function Faq() {
  return (
    <section className="section" id="faq" aria-label="Frequently asked questions">
      <h2>FAQ</h2>
      <p className="section-sub">Short answers to the questions that come up first.</p>
      {ITEMS.map((item) => (
        <div key={item.question} className="faq-item panel">
          <span className="panel-label">Q</span>
          <h3>{item.question}</h3>
          <p>{item.answer}</p>
        </div>
      ))}
    </section>
  );
}
