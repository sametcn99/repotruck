import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GRAMMAR_MANIFEST, type GrammarLang } from "../src/services/grammarStore.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(repoRoot, "vendor", "grammars");

export interface GrammarManifestRecord {
  file: string;
  url: string;
  sha256: string;
  size: number;
}

export const VENDOR_GRAMMARS: Record<GrammarLang, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
};

export async function computeVendorGrammarManifest(): Promise<
  Record<GrammarLang, GrammarManifestRecord>
> {
  const result: Partial<Record<GrammarLang, GrammarManifestRecord>> = {};
  for (const [lang, file] of Object.entries(VENDOR_GRAMMARS) as [GrammarLang, string][]) {
    const fullPath = path.join(vendorDir, file);
    const content = await readFile(fullPath);
    const hash = createHash("sha256").update(content).digest("hex").toLowerCase();
    result[lang] = {
      file,
      url: `https://github.com/sametcn99/repotruck/releases/download/grammars-v1/${file}`,
      sha256: hash,
      size: content.byteLength,
    };
  }
  return result as Record<GrammarLang, GrammarManifestRecord>;
}

export async function verifyGrammarManifest(): Promise<{
  ok: boolean;
  errors: string[];
}> {
  const computed = await computeVendorGrammarManifest();
  const errors: string[] = [];
  for (const [lang, record] of Object.entries(computed) as [GrammarLang, GrammarManifestRecord][]) {
    const defaultEntry = DEFAULT_GRAMMAR_MANIFEST[lang];
    if (!defaultEntry) {
      errors.push(`missing entry for '${lang}' in DEFAULT_GRAMMAR_MANIFEST`);
      continue;
    }
    if (defaultEntry.sha256 !== record.sha256) {
      errors.push(
        `mismatch for '${lang}' sha256: expected ${record.sha256}, manifest has ${defaultEntry.sha256}`,
      );
    }
    if (defaultEntry.size !== record.size) {
      errors.push(
        `mismatch for '${lang}' size: expected ${record.size}, manifest has ${defaultEntry.size}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--check")) {
    const verification = await verifyGrammarManifest();
    if (!verification.ok) {
      console.error("Grammar manifest verification failed:");
      for (const err of verification.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log("✓ grammar manifest matches vendor binaries (6/6)");
  } else {
    const manifest = await computeVendorGrammarManifest();
    console.log(JSON.stringify(manifest, null, 2));
  }
}
