import { useState } from "react";
import { useCopy } from "../hooks.ts";
import { CommandBuilder } from "./CommandBuilder.tsx";

/**
 * Page hero: the pitch, a one-click copy chip for `npx repotruck` and the
 * command builder entry point.
 */
export function TerminalHero() {
  const { state: copyState, copy } = useCopy("npx repotruck");
  const [builderOpen, setBuilderOpen] = useState(false);

  return (
    <section className="section hero" aria-label="Introduction">
      <h1>
        Bulk-clone and organize your <span className="accent">GitHub repositories</span>
      </h1>
      <p className="hero-sub">
        repotruck mirrors your repositories into predictable directory layouts, keeps them up to
        date, and writes an AGENTS.md map so coding agents can navigate the workspace.
      </p>
      <span className="hero-chips">
        <button
          type="button"
          className={`install-chip${copyState === "copied" ? " copied" : ""}`}
          aria-label="Copy command: npx repotruck"
          onClick={copy}
        >
          <span className="chip-command">$ npx repotruck</span>
          <span className="chip-action">{copyState === "copied" ? "copied!" : "copy"}</span>
        </button>
        <button type="button" className="builder-open" onClick={() => setBuilderOpen(true)}>
          ⚙ Command builder
        </button>
      </span>
      <CommandBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />
      <p className="hero-meta">No install required. Works on Windows, macOS and Linux.</p>
    </section>
  );
}
