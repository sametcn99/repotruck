/**
 * Website docs generator — writes the generated modules checked in under
 * website/src/components from the registry and help sources.
 *
 *   bun run docs:gen     write the files
 *   bun run docs:check   verify the checked-in copies are up to date
 *
 * Part of the docs chain: CLI tree → src/commands/registry.ts (enforced by
 * tests/parity.test.ts) → generated website tables (enforced by
 * scripts/docs-check.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateWebsiteFiles } from "./docs-generate.ts";

const files = await generateWebsiteFiles();
for (const file of files) {
  const target = path.join(import.meta.dir, "..", file.path);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  process.stdout.write(`generated ${file.path}\n`);
}
