import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useReducedMotion, useTypewriter } from "../hooks.ts";

interface StatusLine {
  phase: "CLONING" | "PULLING" | "DONE";
  key: string;
  message: string;
}

const STATUS_SEQUENCE: readonly StatusLine[] = [
  { phase: "CLONING", key: "acme/api", message: "cloning into acme/source/api" },
  { phase: "PULLING", key: "monalisa/web", message: "fast-forward" },
  { phase: "DONE", key: "acme/api", message: "cloned" },
  { phase: "CLONING", key: "octo/lib", message: "cloning into community/octo/source/lib" },
  { phase: "DONE", key: "monalisa/web", message: "updated" },
  { phase: "PULLING", key: "acme/cli", message: "fast-forward" },
  { phase: "DONE", key: "octo/lib", message: "cloned" },
  { phase: "DONE", key: "acme/cli", message: "updated" },
];

const PHASE_CLASS: Record<StatusLine["phase"], string> = {
  CLONING: "status-cloning",
  PULLING: "status-pulling",
  DONE: "status-done",
};

const STATIC_FINAL: readonly StatusLine[] = [
  { phase: "DONE", key: "acme/api", message: "cloned" },
  { phase: "DONE", key: "monalisa/web", message: "updated" },
  { phase: "DONE", key: "octo/lib", message: "cloned" },
];

function DashboardMock(): ReactElement {
  return (
    <div className="dash-frame" aria-hidden="true">
      <div className="dash-header">
        repotruck · monalisa (auth: gh-cli) · preset: categorized · root: ~/work · 3 repos
      </div>
      <div className="dash-row">
        <div className="dash-col dash-sidebar">
          <div className="label">SCOPE</div>
          <div>[x] Personal (monalisa)</div>
          <div>[ ] acme-org</div>
          <div className="label">PRESET</div>
          <div>Preset: categorized</div>
          <div className="label">FILTERS</div>
          <div>[x] Active</div>
          <div>[x] Forks</div>
          <div>[x] Archived</div>
        </div>
        <div className="dash-col dash-list">
          <div>&gt; [x] api [Private] [TypeScript]</div>
          <div>&nbsp;&nbsp;[x] web</div>
          <div>&nbsp;&nbsp;[ ] cli [Go]</div>
          <div>3 repositories · 1 selected</div>
        </div>
        <div className="dash-col dash-status">
          <div className="label">STATUS</div>
          <StatusFeed />
        </div>
      </div>
    </div>
  );
}

function StatusFeed(): ReactElement {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState<number>(reduced ? STATUS_SEQUENCE.length : 1);

  useEffect(() => {
    if (reduced) {
      setIndex(STATUS_SEQUENCE.length);
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current >= STATUS_SEQUENCE.length ? 1 : current + 1));
    }, 1200);
    return () => {
      window.clearInterval(timer);
    };
  }, [reduced]);

  const visible = reduced ? STATIC_FINAL : STATUS_SEQUENCE.slice(Math.max(0, index - 3), index);

  return (
    <>
      {visible.map((line, position) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: animated terminal lines position index
        <div key={`${line.key}-${position}`} className={`status-line ${PHASE_CLASS[line.phase]}`}>
          {`[${line.phase}] ${line.key} — ${line.message}`}
        </div>
      ))}
    </>
  );
}

export function TerminalHero() {
  const reduced = useReducedMotion();
  const { typed, done } = useTypewriter("npx repotruck", 40);

  return (
    <section className="section hero" aria-label="Introduction">
      <div className="terminal">
        <div className="terminal-bar">
          <span className="terminal-dot" />
          <span className="terminal-dot" />
          <span className="terminal-dot" />
          <span className="terminal-title">repotruck — terminal</span>
        </div>
        <div className="terminal-body">
          <p className="typed-line">
            <span className="prompt">$ </span>
            {typed}
            {done ? null : <span className="caret">▍</span>}
          </p>
          {done ? <DashboardMock /> : null}
        </div>
      </div>
      <h1>
        Bulk-clone and organize your <span className="accent">GitHub repositories</span>
      </h1>
      <p className="hero-sub">
        repotruck mirrors your repositories into predictable directory layouts, keeps them up to
        date, and writes an AGENTS.md map so coding agents can navigate the workspace.
      </p>
      <span className="install-chip">$ npx repotruck</span>
      <p className="hero-meta">
        {reduced
          ? "Reduced motion: showing the final terminal frame."
          : "No install required. Works on Windows, macOS and Linux."}
      </p>
    </section>
  );
}
