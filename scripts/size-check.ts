// Enforces the Faz 6 file-size budget: no file under src/ may exceed 600 lines.
// Documented temporary exceptions (removed as Faz 6 progresses):
//   - components/store.ts  — async actions extracted in Faz 6d (optional step)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.join(import.meta.dir, "..", "src");
const LIMIT = 600;
const EXCEPTIONS = new Set(["components/store.ts"]);

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

let failed = false;
for (const file of walk(SRC_ROOT)) {
  const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
  const lineCount = readFileSync(file, "utf8").split("\n").length;
  if (lineCount > LIMIT && !EXCEPTIONS.has(rel)) {
    console.error(`size-check: FAIL — src/${rel} is ${lineCount} lines (limit ${LIMIT})`);
    failed = true;
  }
}

if (failed) process.exit(1);
const exceptions = [...EXCEPTIONS].map((e) => `src/${e}`).join(", ");
console.log(`size-check: PASS (limit ${LIMIT} lines; exceptions: ${exceptions})`);
