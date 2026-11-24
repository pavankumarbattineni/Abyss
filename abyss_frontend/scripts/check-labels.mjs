/**
 * Guards diagram label placement (src/lib/visuals/label-placement.ts): a label
 * never sits on a line, arrow or point when there is room beside it, labels
 * don't overlap each other, they stay inside the drawing, and one moved away
 * from its anchor gets a leader line. Runs before every build.
 * Run on its own: node scripts/check-labels.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src/lib/visuals/label-placement.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  logLevel: "silent",
});
const { placeLabels, segmentHitsBox } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

const bounds = { x0: 0, y0: 0, x1: 700, y1: 360 };
const overlap = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

// The production suspension-bridge diagram, in pixels: a tower, an arrow down
// its top (Force C), a backstay arrow from the anchorage to that top, a deck,
// and a weight arrow under mid-span.
const towerTop = { x: 260, y: 80 };
const tower = [{ x: 260, y: 300 }, towerTop];
const forceC = [towerTop, { x: 260, y: 130 }];
const backstay = [{ x: 180, y: 300 }, towerTop];
const deck = [{ x: 230, y: 270 }, { x: 560, y: 270 }];
const mid = { x: 400, y: 230 };
const weight = [mid, { x: 400, y: 255 }];
const segments = [tower, forceC, backstay, deck, weight];
const points = [towerTop, mid, { x: 180, y: 300 }];
const center = (s) => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 });

const requests = [
  { text: "T1_top", anchor: towerTop, fontSize: 12.5 },
  { text: "mid", anchor: mid, fontSize: 12.5 },
  { text: "Force C", anchor: center(forceC), fontSize: 12.5, own: forceC },
  { text: "Weight w", anchor: center(weight), fontSize: 12.5, own: weight },
  { text: "Backstay (T)", anchor: center(backstay), fontSize: 12.5, own: backstay },
  { text: "Tower (Comp.)", anchor: center(tower), fontSize: 12, own: tower },
  { text: "Deck", anchor: center(deck), fontSize: 12, own: deck },
];
const placed = placeLabels(requests, { segments, points, boxes: [] }, bounds);

const cases = [
  ["no label sits on a line or arrow", () => placed.forEach((l, i) => segments.forEach((s) =>
    assert.ok(!segmentHitsBox(s[0], s[1], l.box), `${requests[i].text} crosses a line`)))],
  ["no label covers a point", () => placed.forEach((l, i) => points.forEach((p) =>
    assert.ok(!(p.x >= l.box.x0 && p.x <= l.box.x1 && p.y >= l.box.y0 && p.y <= l.box.y1), `${requests[i].text} covers a point`)))],
  ["labels don't overlap each other", () => placed.forEach((a, i) => placed.slice(i + 1).forEach((b, j) =>
    assert.ok(!overlap(a.box, b.box), `${requests[i].text} overlaps ${requests[i + 1 + j].text}`)))],
  ["labels stay inside the drawing", () => placed.forEach((l, i) =>
    assert.ok(l.box.x0 >= 0 && l.box.y0 >= 0 && l.box.x1 <= 700 && l.box.y1 <= 360, `${requests[i].text} leaves the drawing`))],
  ["a label away from its anchor has a leader line to it", () => placed.forEach((l, i) => {
    const edge = { x: Math.min(Math.max(requests[i].anchor.x, l.box.x0), l.box.x1), y: Math.min(Math.max(requests[i].anchor.y, l.box.y0), l.box.y1) };
    if (Math.hypot(edge.x - requests[i].anchor.x, edge.y - requests[i].anchor.y) > 16) assert.ok(l.leader, `${requests[i].text} has no leader`);
  })],
  ["a label with room stays close and needs no leader", () => {
    const [alone] = placeLabels([{ text: "P", anchor: { x: 350, y: 180 }, fontSize: 12.5 }], { segments: [], points: [], boxes: [] }, bounds);
    assert.equal(alone.leader, null);
    assert.ok(Math.hypot(alone.x - 350, alone.y - 180) < 20);
  }],
];
for (const [name, check] of cases) {
  try {
    check();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}
console.log(`label placement check: all ${cases.length} cases pass`);
