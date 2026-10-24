#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_NODE_MAJOR = 20;
const nodeMajor = Number.parseInt((process.versions.node ?? "").split(".")[0] ?? "", 10);
if (Number.isNaN(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  process.stderr.write(
    `repotruck requires Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node || "unknown"}). Install a supported Node.js version, or run the CLI with Bun instead: bunx repotruck\n`,
  );
  process.exit(1);
}

const distPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
if (!existsSync(distPath)) {
  process.stderr.write(
    "repotruck CLI bundle is missing. build first: bun install && bun run build\n",
  );
  process.exit(1);
}

try {
  await import(pathToFileURL(distPath).href);
} catch (error) {
  process.stderr.write(
    `repotruck failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
