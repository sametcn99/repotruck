import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  label: string;
  level: 1 | 2;
}

function readSections(): TocItem[] {
  const items: TocItem[] = [];
  const sections = Array.from(document.querySelectorAll<HTMLElement>("main section[id]"));

  for (const section of sections) {
    items.push({
      id: section.id,
      label:
        section.querySelector("h2")?.textContent?.trim() ??
        section.getAttribute("aria-label") ??
        section.id,
      level: 1,
    });

    const subElements = Array.from(
      section.querySelectorAll<HTMLElement>("[data-toc-sub], .command-group[id]"),
    );
    for (const sub of subElements) {
      if (!sub.id) continue;
      const label =
        sub.getAttribute("data-toc-sub") ||
        sub.querySelector("h3")?.textContent?.trim() ||
        sub.getAttribute("aria-label") ||
        sub.id;
      items.push({
        id: sub.id,
        label,
        level: 2,
      });
    }
  }

  return items;
}

export function TocRail() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    setItems(readSections());
  }, []);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const threshold = window.innerHeight * 0.3;
      let current = items[0]?.id ?? "";
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (element === null) {
          continue;
        }
        if (element.getBoundingClientRect().top <= threshold) {
          current = item.id;
        } else {
          break;
        }
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 20) {
        current = items[items.length - 1]?.id ?? current;
      }
      setActiveId(current);
    };
    const requestUpdate = (): void => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="toc-rail" aria-label="Sections">
      <div className="toc-rail-header">
        <a href="#main" className="toc-brand" aria-label="repotruck home">
          <svg
            className="toc-brand-logo"
            viewBox="0 0 32 32"
            width="18"
            height="18"
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
          <span className="toc-brand-name">repotruck</span>
        </a>
      </div>
      <div className="toc-rail-list">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={[
              item.id === activeId ? "active" : "",
              item.level === 2 ? "toc-rail-sub" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-level={item.level}
          >
            <span className="toc-rail-bar" aria-hidden="true" />
            <span className="toc-rail-label">{item.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
