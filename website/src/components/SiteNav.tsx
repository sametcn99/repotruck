import { useEffect, useRef, useState } from "react";

export interface NavSubItem {
  id: string;
  label: string;
}

export interface NavSection {
  id: string;
  label: string;
  items?: NavSubItem[];
  alignRight?: boolean;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "features",
    label: "Features",
  },
  {
    id: "presets",
    label: "Presets",
    items: [
      { id: "presets", label: "Overview" },
      { id: "trees", label: "Example trees" },
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    items: [
      { id: "mcp", label: "Overview" },
      { id: "mcp-tools", label: "Tools" },
      { id: "mcp-resources", label: "Resources" },
      { id: "mcp-prompts", label: "Prompts" },
    ],
  },
  {
    id: "install",
    label: "Install",
  },
  {
    id: "cli",
    label: "CLI",
    items: [
      { id: "cli", label: "Overview" },
      { id: "sync-and-clone", label: "Sync and clone" },
      { id: "lifecycle", label: "Repository lifecycle" },
      { id: "workspace", label: "Workspace & layout" },
      { id: "search-and-run", label: "Search & automation" },
      { id: "platform", label: "Auth & diagnostics" },
      { id: "cli-settings", label: "CLI settings" },
      { id: "settings", label: "Config settings" },
      { id: "divergence", label: "Divergence strategies" },
    ],
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
  },
  {
    id: "reference",
    label: "Reference",
    alignRight: true,
    items: [
      { id: "reference", label: "Overview" },
      { id: "ref-auth", label: "Authentication" },
      { id: "ref-memory", label: "Workspace memory" },
      { id: "ref-backups", label: "Backups" },
      { id: "ref-prune", label: "Pruning" },
      { id: "ref-agents", label: "AGENTS.md" },
      { id: "ref-enterprise", label: "GitHub Enterprise" },
      { id: "ref-transports", label: "MCP transports" },
      { id: "ref-apps", label: "Custom apps" },
      { id: "ref-env", label: "Environment variables" },
      { id: "ref-inventory", label: "repotruck.json" },
      { id: "ref-terminal", label: "Terminal compatibility" },
    ],
  },
  {
    id: "faq",
    label: "FAQ",
    alignRight: true,
  },
];

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = (id: string) => {
    setOpenDropdown((prev) => (prev === id ? null : id));
  };

  const handleLinkClick = () => {
    setMobileOpen(false);
    setOpenDropdown(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setOpenDropdown(null);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setMobileOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  return (
    <div className="site-nav-container" ref={containerRef}>
      <button
        type="button"
        className="nav-toggle"
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((prev) => !prev)}
      >
        <svg
          className="nav-toggle-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {mobileOpen ? (
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          ) : (
            <>
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </>
          )}
        </svg>
      </button>

      <nav className={`site-nav ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Site">
        {NAV_SECTIONS.map((section) => {
          const hasDropdown = Boolean(section.items && section.items.length > 0);
          const isOpen = openDropdown === section.id;

          return (
            <div
              key={section.id}
              className={`nav-item ${hasDropdown ? "has-dropdown" : ""} ${isOpen ? "is-open" : ""}`}
            >
              <div className="nav-item-row">
                <a href={`#${section.id}`} className="nav-link" onClick={handleLinkClick}>
                  {section.label}
                </a>
                {hasDropdown && (
                  <button
                    type="button"
                    className="nav-caret-btn"
                    aria-label={`Toggle ${section.label} subheadings`}
                    aria-expanded={isOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleDropdown(section.id);
                    }}
                  >
                    <svg
                      className="nav-caret"
                      viewBox="0 0 12 12"
                      width="10"
                      height="10"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 4.5 6 7.5 9 4.5" />
                    </svg>
                  </button>
                )}
              </div>

              {hasDropdown && (
                <div
                  className={`nav-dropdown ${section.alignRight ? "align-right" : ""}`}
                  role="menu"
                >
                  {section.items!.map((subItem) => (
                    <a
                      key={subItem.id}
                      href={`#${subItem.id}`}
                      className="nav-dropdown-item"
                      role="menuitem"
                      onClick={handleLinkClick}
                    >
                      {subItem.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
