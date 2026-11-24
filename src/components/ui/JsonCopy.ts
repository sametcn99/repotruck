import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `--json` parity for data views: copy a JSON payload to the system
 * clipboard via OSC 52 (supported by most modern terminals), falling back
 * to a temp file whose path is reported back.
 */
export interface JsonCopyResult {
  ok: boolean;
  /** Clipboard sequence was emitted. */
  clipboard: boolean;
  /** Temp file written as a fallback (or when explicitly requested). */
  filePath: string | null;
  message: string;
}

function osc52Sequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`;
}

/** Copy an arbitrary text payload (OSC 52, temp-file fallback). */
export interface ClipboardOutput {
  isTTY?: boolean;
  write: (text: string) => unknown;
}
export const MAX_OSC52_BYTES = 100_000;

export function copyText(
  label: string,
  payload: string,
  output: ClipboardOutput = process.stdout,
): JsonCopyResult {
  let clipboard = false;
  if (output.isTTY === true && Buffer.byteLength(payload, "utf8") <= MAX_OSC52_BYTES) {
    try {
      output.write(osc52Sequence(payload));
      clipboard = true;
    } catch {
      clipboard = false;
    }
  }
  if (clipboard) {
    return {
      ok: true,
      clipboard: true,
      filePath: null,
      message: `${label} clipboard copy requested (OSC 52; terminal acceptance is unverified)`,
    };
  }
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "repotruck-copy-"));
    const filePath = path.join(dir, "payload.txt");
    writeFileSync(filePath, payload, "utf8");
    return {
      ok: true,
      clipboard: false,
      filePath,
      message: `${label} written to ${filePath} (terminal has no OSC 52 clipboard)`,
    };
  } catch (error) {
    return {
      ok: false,
      clipboard: false,
      filePath: null,
      message: `${label} copy failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function copyJson(label: string, data: unknown, writeFile = false): JsonCopyResult {
  const json = JSON.stringify(data, null, 2);
  let clipboard = false;
  if (
    !writeFile &&
    process.stdout.isTTY === true &&
    Buffer.byteLength(json, "utf8") <= MAX_OSC52_BYTES
  ) {
    try {
      process.stdout.write(osc52Sequence(json));
      clipboard = true;
    } catch {
      clipboard = false;
    }
  }
  if (clipboard && !writeFile) {
    return {
      ok: true,
      clipboard: true,
      filePath: null,
      message: `${label} JSON clipboard copy requested (OSC 52; terminal acceptance is unverified)`,
    };
  }
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "repotruck-json-"));
    const filePath = path.join(dir, "payload.json");
    writeFileSync(filePath, json, "utf8");
    return {
      ok: true,
      clipboard: false,
      filePath,
      message: clipboard
        ? `${label} JSON copied and written to ${filePath}`
        : `${label} JSON written to ${filePath} (terminal has no OSC 52 clipboard)`,
    };
  } catch (error) {
    return {
      ok: false,
      clipboard: false,
      filePath: null,
      message: `${label} JSON copy failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
