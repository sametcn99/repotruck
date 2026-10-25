import { DocsBody } from "./components/DocsBody.tsx";
import { Faq } from "./components/Faq.tsx";
import { FeatureGrid } from "./components/FeatureGrid.tsx";
import { Footer } from "./components/Footer.tsx";
import { InstallBox } from "./components/InstallBox.tsx";
import { McpSection } from "./components/McpSection.tsx";
import { PresetTable } from "./components/PresetTable.tsx";
import { PresetTrees } from "./components/PresetTrees.tsx";
import { ReferenceSection } from "./components/ReferenceSection.tsx";
import { ShortcutsTable } from "./components/ShortcutsTable.tsx";
import { SiteNav } from "./components/SiteNav.tsx";
import { TerminalHero } from "./components/TerminalHero.tsx";
import { TocRail } from "./components/TocRail.tsx";

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TocRail />
      <header className="site-header">
        <div className="site-header-inner">
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
          <SiteNav />
        </div>
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
        <ReferenceSection />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
