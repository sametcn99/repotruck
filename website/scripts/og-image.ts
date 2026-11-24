import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, "..", "public", "og-image.svg");
const pngPath = join(here, "..", "public", "og-image.png");
const manifestPath = join(here, "og-image.manifest.json");
const RENDER_PROFILE = "resvg-width-1200-v1";

interface OgImageManifest {
  format: 1;
  renderProfile: typeof RENDER_PROFILE;
  sourceSha256: string;
  outputSha256: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Render the source SVG with the exact settings used by the checked-in image. */
export function renderOgImage(svg: string): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng());
}

/** Render the source asset and write its content-binding manifest. */
export function writeOgImageAssets(
  sourcePath: string,
  outputPath: string,
  bindingPath: string,
): void {
  const source = readFileSync(sourcePath);
  const output = renderOgImage(source.toString("utf8"));
  const binding: OgImageManifest = {
    format: 1,
    renderProfile: RENDER_PROFILE,
    sourceSha256: sha256(source),
    outputSha256: sha256(output),
  };
  writeFileSync(outputPath, output);
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`);
}

/**
 * Timestamp order is not a reliable signal in checkouts, archives, or CI.
 * Verify the source and generated output against the hashes recorded by `og`.
 */
export function isOgImageCurrent(
  sourcePath: string,
  outputPath: string,
  bindingPath: string,
): boolean {
  if (!existsSync(sourcePath) || !existsSync(outputPath) || !existsSync(bindingPath)) return false;
  try {
    const source = readFileSync(sourcePath);
    const output = readFileSync(outputPath);
    const binding = JSON.parse(readFileSync(bindingPath, "utf8")) as Partial<OgImageManifest>;
    return (
      binding.format === 1 &&
      binding.renderProfile === RENDER_PROFILE &&
      binding.sourceSha256 === sha256(source) &&
      binding.outputSha256 === sha256(output)
    );
  } catch {
    return false;
  }
}

function main(): void {
  const mode = process.argv[2] ?? "render";
  if (mode === "check") {
    if (!existsSync(pngPath)) {
      console.error(
        "og-image.png is missing. Run `bun run og` to render it from public/og-image.svg.",
      );
      process.exitCode = 1;
      return;
    }
    if (!existsSync(manifestPath)) {
      console.error("og-image.manifest.json is missing. Run `bun run og` to regenerate it.");
      process.exitCode = 1;
      return;
    }
    if (!isOgImageCurrent(svgPath, pngPath, manifestPath)) {
      console.error(
        "og-image.png or og-image.svg does not match og-image.manifest.json. Run `bun run og` to regenerate them.",
      );
      process.exitCode = 1;
      return;
    }
    console.log("og-image.svg and og-image.png match og-image.manifest.json.");
    return;
  }

  writeOgImageAssets(svgPath, pngPath, manifestPath);
  console.log(`Rendered ${pngPath} and updated ${manifestPath}`);
}

// Keep the renderer importable by focused filesystem tests without invoking the CLI.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) main();
