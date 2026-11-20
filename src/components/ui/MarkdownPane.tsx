import { theme } from "../theme.ts";

export interface MarkdownLine {
  text: string;
  fg: string | undefined;
}

/**
 * Minimal markdown-to-styled-lines renderer for previews (changelog,
 * AGENTS.md templates). Headings get the accent color, bullets and code
 * spans dim markers, quoted/fenced lines render dim.
 */
export function renderMarkdownLines(markdown: string, width: number): MarkdownLine[] {
  const inner = Math.max(10, width - 4);
  const trim = (line: string): string => {
    const clean = line.replace(/[\r\t]+/g, " ");
    return clean.length <= inner ? clean : `${clean.slice(0, Math.max(1, inner - 1))}…`;
  };
  let fenced = false;
  return markdown.split("\n").map((raw) => {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      fenced = !fenced;
      return { text: trim(line), fg: theme.dim() };
    }
    if (fenced || line.startsWith("    ")) {
      return { text: trim(raw), fg: theme.dim() };
    }
    if (/^#{1,6}\s/.test(line)) return { text: trim(line), fg: theme.accent() };
    if (/^\s*[-*•]\s/.test(line)) return { text: trim(raw), fg: theme.normal() };
    return { text: trim(raw), fg: undefined };
  });
}
