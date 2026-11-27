import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCli } from "./cli/run.ts";

await runCli(async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of ["index.tsx", "index.js"]) {
    const file = path.join(here, candidate);
    if (existsSync(file)) return import(pathToFileURL(file).href);
  }
  throw new Error("the TUI module is missing. Build first: bun install && bun run build");
});
