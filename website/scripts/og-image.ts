import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, "..", "public", "og-image.svg");
const pngPath = join(here, "..", "public", "og-image.png");

const mode = process.argv[2] ?? "render";

if (mode === "check") {
  if (!existsSync(pngPath)) {
    console.error(
      "og-image.png is missing. Run `bun run og` to render it from public/og-image.svg.",
    );
    process.exit(1);
  }
  if (statSync(svgPath).mtimeMs > statSync(pngPath).mtimeMs) {
    console.error(
      "og-image.svg is newer than og-image.png — the social preview image is stale. Run `bun run og` to re-render it.",
    );
    process.exit(1);
  }
  console.log("og-image.png is up to date with og-image.svg.");
  process.exit(0);
}

const svg = readFileSync(svgPath, "utf8");
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
});
const png = resvg.render().asPng();
writeFileSync(pngPath, png);
console.log(`Rendered ${pngPath} (${String(png.length)} bytes)`);
