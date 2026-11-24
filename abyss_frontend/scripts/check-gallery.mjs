/**
 * Guards the image gallery's card shape (src/lib/visuals/gallery-frame.ts):
 * posters get tall cards, landscapes wide ones, a mix something in between,
 * an extreme image can't stretch the gallery, 4:3 until anything has loaded.
 * Runs before every build. Run on its own: node scripts/check-gallery.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src/lib/visuals/gallery-frame.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  logLevel: "silent",
});
const { galleryFrame, DEFAULT_FRAME, MIN_FRAME, MAX_FRAME } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

const poster = 2 / 3;
const cases = [
  ["nothing loaded yet: 4:3", () => assert.equal(galleryFrame([]), DEFAULT_FRAME)],
  ["posters: tall cards (no side bands)", () => assert.ok(Math.abs(galleryFrame([poster, poster]) - MIN_FRAME) < 1e-9)],
  ["landscapes: wide cards", () => assert.equal(galleryFrame([1.5, 1.5, 1.6]), 1.5)],
  ["a mix: the middle shape", () => assert.equal(galleryFrame([poster, 1.0, 1.5]), 1.0)],
  ["one panorama can't stretch the gallery", () => assert.equal(galleryFrame([5]), MAX_FRAME)],
  ["bad values are ignored", () => assert.equal(galleryFrame([NaN, 0, -1, 1.5]), 1.5)],
];
for (const [name, check] of cases) {
  try {
    check();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}
console.log(`gallery frame check: all ${cases.length} cases pass`);
