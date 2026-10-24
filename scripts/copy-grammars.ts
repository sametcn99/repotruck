import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repoRoot, "vendor", "grammars");
const target = path.join(repoRoot, "dist", "grammars");

await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(
  `copied vendored grammars to ${path.relative(repoRoot, target).split(path.sep).join("/")}`,
);
