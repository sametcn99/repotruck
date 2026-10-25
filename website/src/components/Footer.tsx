export function Footer() {
  return (
    <>
      <footer className="site-footer">
        <div>
          <a href="https://github.com/sametcn99/repotruck">github.com/sametcn99/repotruck</a>
          {" · "}
          <a href="https://www.npmjs.com/package/repotruck">npmjs.com/package/repotruck</a>
          {" · "}
          <span>MIT License</span>
        </div>
        <div className="muted">built with Vite + React</div>
      </footer>

      <aside className="side-footer" aria-label="Project links">
        <div className="side-footer-content">
          <div className="side-footer-group">
            <span className="side-footer-heading">Links</span>
            <a
              href="https://github.com/sametcn99/repotruck"
              target="_blank"
              rel="noopener noreferrer"
              className="side-footer-link"
            >
              <svg
                className="side-footer-icon"
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span>GitHub</span>
            </a>
            <a
              href="https://www.npmjs.com/package/repotruck"
              target="_blank"
              rel="noopener noreferrer"
              className="side-footer-link"
            >
              <svg
                className="side-footer-icon"
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M0 0v16h16V0H0zm13 13h-2V5H8v8H3V3h10v10z" />
              </svg>
              <span>npm</span>
            </a>
          </div>

          <div className="side-footer-group">
            <span className="side-footer-heading">Project</span>
            <span className="side-footer-text">MIT License</span>
            <span className="side-footer-text muted">Vite + React</span>
          </div>

          <div className="side-footer-group">
            <a href="#main" className="side-footer-top-link">
              <span className="side-footer-arrow" aria-hidden="true">
                ↑
              </span>
              <span>Back to top</span>
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
