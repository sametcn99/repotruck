import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { isOgImageCurrent, writeOgImageAssets } from "../scripts/og-image.ts";

const fixtures: string[] = [];
const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#112233"/></svg>';
const CHANGED_SOURCE = SOURCE.replace("#112233", "#332211");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "repotruck-og-image-"));
  fixtures.push(root);
  return {
    root,
    svg: join(root, "og-image.svg"),
    png: join(root, "og-image.png"),
    manifest: join(root, "og-image.manifest.json"),
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("valid generated PNG passes regardless of fresh-checkout and touched timestamp order", () => {
  const f = fixture();
  writeFileSync(f.svg, SOURCE);
  writeOgImageAssets(f.svg, f.png, f.manifest);

  // Simulate checkout/touch ordering where the SVG appears newer than its valid PNG.
  utimesSync(f.svg, 20, 20);
  utimesSync(f.png, 10, 10);
  expect(statSync(f.svg).mtimeMs).toBeGreaterThan(statSync(f.png).mtimeMs);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(true);

  // A touch of either generated asset changes only metadata and remains valid.
  utimesSync(f.png, 30, 30);
  expect(statSync(f.png).mtimeMs).toBeGreaterThan(statSync(f.svg).mtimeMs);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(true);
  utimesSync(f.svg, 30, 30);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(true);
});

test("same-time source edits and corrupted outputs are rejected by content", () => {
  const f = fixture();
  writeFileSync(f.svg, SOURCE);
  writeOgImageAssets(f.svg, f.png, f.manifest);
  utimesSync(f.svg, 100, 100);
  utimesSync(f.png, 100, 100);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(true);

  writeFileSync(f.svg, CHANGED_SOURCE);
  utimesSync(f.svg, 100, 100);
  utimesSync(f.png, 100, 100);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(false);

  // Restoring the original source does not make a malformed PNG acceptable,
  // even when its timestamp is newer than the SVG.
  writeFileSync(f.svg, SOURCE);
  writeFileSync(f.png, Buffer.from("not a PNG"));
  utimesSync(f.svg, 100, 100);
  utimesSync(f.png, 200, 200);
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(false);
});

test("missing or invalid source/output files fail the image check", () => {
  const f = fixture();
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(false);
  writeFileSync(f.svg, "<svg>");
  writeFileSync(f.png, Buffer.from("bad"));
  expect(isOgImageCurrent(f.svg, f.png, f.manifest)).toBe(false);
});

test("checked-in OG assets match their content manifest", () => {
  expect(
    isOgImageCurrent(
      join(websiteRoot, "public", "og-image.svg"),
      join(websiteRoot, "public", "og-image.png"),
      join(websiteRoot, "scripts", "og-image.manifest.json"),
    ),
  ).toBe(true);
});
