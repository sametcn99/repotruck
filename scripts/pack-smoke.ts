// [E65/E67] Clean package installation and capabilities under the selected Node.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const directory =
  process.env.REPOTRUCK_PACKAGE_RESULTS_DIR ??
  mkdtempSync(path.join(tmpdir(), "repotruck-package-"));
mkdirSync(directory, { recursive: true });
const run = (command: string[], cwd = process.cwd()) => {
  const result = Bun.spawnSync(command, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  writeFileSync(
    path.join(directory, `${command[1]?.replace(/[^a-z0-9]/gi, "-") ?? "run"}.log`),
    result.stdout.toString() + result.stderr.toString(),
  );
  if (result.exitCode !== 0)
    throw new Error(`${command.slice(0, 2).join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
};
const packed = JSON.parse(
  run(["npm", "pack", "--json", "--pack-destination", directory]).replace(
    /^[\s\S]*?(?=\[\s*\{\s*"id")/,
    "",
  ),
);
const filename = path.join(directory, packed[0].filename),
  clean = mkdtempSync(path.join(directory, "clean-install-"));
writeFileSync(
  path.join(clean, "package.json"),
  JSON.stringify({ name: "repotruck-clean-smoke", version: "1.0.0", private: true }),
);
run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", filename], clean);
const installed = path.join(clean, "node_modules/repotruck");
const output = run(
  [Bun.which("node") ?? "node", path.resolve("scripts/smoke-installed.mjs"), installed],
  clean,
);
writeFileSync(path.join(directory, "installed-path.txt"), installed);
process.stdout.write(output);
console.log(`package evidence: ${directory}`);
