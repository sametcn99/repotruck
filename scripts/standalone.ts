import path from "node:path";
import { runCli } from "../src/cli/run.ts";
import { distributionDirectory } from "../src/services/distribution.ts";

await runCli(async () => {
  const directory = distributionDirectory();
  if (!directory) throw new Error("standalone build version is missing");
  process.env.OTUI_ASSET_ROOT = path.join(directory, "assets", "opentui");
  return import("../src/index.tsx");
});
