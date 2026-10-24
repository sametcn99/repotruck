import { ChangelogSection } from "./components/ChangelogSection.tsx";
import { DocsBody } from "./components/DocsBody.tsx";
import { Faq } from "./components/Faq.tsx";
import { FeatureGrid } from "./components/FeatureGrid.tsx";
import { Footer } from "./components/Footer.tsx";
import { InstallBox } from "./components/InstallBox.tsx";
import { McpSection } from "./components/McpSection.tsx";
import { PresetTable } from "./components/PresetTable.tsx";
import { PresetTrees } from "./components/PresetTrees.tsx";
import { ShortcutsTable } from "./components/ShortcutsTable.tsx";
import { TerminalHero } from "./components/TerminalHero.tsx";

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <span className="brand">
          <svg
            className="brand-logo"
            viewBox="0 0 32 32"
            width="20"
            height="20"
            aria-hidden="true"
            focusable="false"
          >
            <rect
              x="4"
              y="8"
              width="15"
              height="11"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M19 12h5l4 4v3h-9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="22.5" r="2.5" fill="currentColor" />
            <circle cx="23" cy="22.5" r="2.5" fill="currentColor" />
          </svg>
          repotruck
        </span>
        <nav className="site-nav" aria-label="Site">
          <a href="#features">Features</a>
          <a href="#presets">Presets</a>
          <a href="#mcp">MCP</a>
          <a href="#install">Install</a>
          <a href="#cli">CLI</a>
          <a href="#shortcuts">Shortcuts</a>
          <a href="#faq">FAQ</a>
          <a href="#changelog">Changelog</a>
        </nav>
      </header>
      <main id="main">
        <TerminalHero />
        <FeatureGrid />
        <PresetTable />
        <PresetTrees />
        <McpSection />
        <InstallBox />
        <DocsBody />
        <ShortcutsTable />
        <Faq />
        <ChangelogSection />
      </main>
      <Footer />
    </>
  );
}
