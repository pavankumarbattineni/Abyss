/**
 * Guards the native visual formats (src/lib/visuals, src/components/visuals):
 * a realistic spec for every format -- written the loose way models write
 * them (numbers as strings, ranges as objects, formulas with implicit
 * multiplication) -- must validate, render on the server without throwing,
 * draw no NaN/Infinity coordinates, and copy as text. The new trench-ui
 * charts (area, scatter, histogram, box plot) must validate too.
 * Runs before every build. Run on its own: node scripts/check-visuals.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SAMPLES } from "./visual-samples.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RENDERERS = {
  plot: "PlotVisual",
  geometry: "GeometryVisual",
  "vector-field": "VectorFieldVisual",
  "number-line": "NumberLineVisual",
  venn: "VennVisual",
  molecule: "MoleculeVisual",
  "periodic-table": "PeriodicTableVisual",
  "energy-levels": "EnergyLevelsVisual",
  circuit: "CircuitVisual",
  steps: "StepsVisual",
  map: "MapVisual",
  image: "ImageVisual",
};
const entry = [
  'export { parseVisual } from "@/lib/visuals/parse";',
  'export { visualToText } from "@/lib/visuals/registry";',
  'export { VISUAL_SCHEMAS } from "@/lib/visuals/schemas";',
  'export { parseInteractiveBlock, interactiveBlockToText, histogramBins, quartiles } from "@/lib/interactive";',
  'export { renderToStaticMarkup } from "react-dom/server";',
  'export { createElement } from "react";',
  ...Object.entries(RENDERERS).map(([file, name]) => `export { ${name} } from "@/components/visuals/${file}";`),
].join("\n");

const cacheDir = join(root, "node_modules", ".cache");
mkdirSync(cacheDir, { recursive: true });
const outfile = join(cacheDir, "check-visuals.mjs");
await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  outfile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outfile).href);


const BAD_COORDINATE = /="[^"]*(NaN|Infinity)[^"]*"/;
for (const [key, spec] of Object.entries(SAMPLES)) {
  const parsed = m.parseVisual(JSON.stringify(spec));
  assert.ok(parsed.ok, `${key}: ${parsed.ok ? "" : parsed.errors.join("; ")}`);
  const Renderer = m[RENDERERS[parsed.format]];
  let html;
  try {
    html = m.renderToStaticMarkup(m.createElement(Renderer, { data: parsed.data }));
  } catch (err) {
    assert.fail(`${key}: render threw ${err.stack}`);
  }
  assert.ok(html.length > 50, `${key}: rendered almost nothing`);
  const bad = BAD_COORDINATE.exec(html);
  assert.ok(!bad, `${key}: bad coordinate ${bad?.[0].slice(0, 120)}`);
  assert.ok(m.visualToText(parsed.data).trim().length > 0, `${key}: empty copy-as-text`);
}
assert.deepEqual(Object.keys(RENDERERS).filter((f) => !(f in SAMPLES)), [], "a format has no sample");

// Unsafe or broken specs are rejected with a readable reason.
const rejects = [
  [{ format: "image", src: "https://evil.example.com/a.png" }, "src"],
  [{ format: "image", src: "http://upload.wikimedia.org/a.png" }, "src"],
  [{ format: "venn", sets: [{ id: "a", label: "A" }] }, "sets"],
];
for (const [spec, field] of rejects) {
  const parsed = m.parseVisual(JSON.stringify(spec));
  assert.ok(!parsed.ok && parsed.errors.some((e) => e.startsWith(field)), `should reject ${JSON.stringify(spec)}: ${JSON.stringify(parsed)}`);
}

// Lenient: a misspelt molecule key still draws; an entry with no structure is dropped.
const typo = m.parseVisual(JSON.stringify({ format: "molecule", molecules: [{ smiles: "O" }, { smils: "C", name: "Methane" }, { name: "nothing" }] }));
assert.ok(typo.ok && typo.data.molecules.length === 2 && typo.data.molecules[1].smiles === "C", JSON.stringify(typo));

// Lenient: a reversed or broken range is dropped (auto range), not fatal.
const lenient = m.parseVisual(JSON.stringify({ format: "plot", x: [5, 1], y: [0, "2pi"], functions: [{ y: "x" }] }));
assert.ok(lenient.ok && lenient.data.x === undefined && Math.abs(lenient.data.y[1] - 2 * Math.PI) < 1e-9, JSON.stringify(lenient));

// trench-ui charts.
const block = m.parseInteractiveBlock(
  JSON.stringify({
    version: 1,
    components: [
      { type: "area_chart", x: ["Q1", "Q2", "Q3"], series: [{ name: "Users", data: [1, 3, 2] }] },
      { type: "scatter_chart", series: [{ name: "Trials", points: [[1, 2], { x: 2, y: 4.1 }, [3, 6.2]] }], trend: true, xLabel: "dose" },
      { type: "histogram", values: [1, 2, 2, 3, 3, 3, 4, 9], bins: "4" },
      { type: "box_plot", groups: [{ name: "A", values: [1, 2, 3, 4, 10] }, { name: "B", values: [2, 3, 3, 5] }] },
    ],
  }),
);
assert.ok(block && block.skipped === 0, `trench-ui: ${JSON.stringify(block)}`);
assert.equal(block.components.length, 4);
assert.ok(m.interactiveBlockToText(block).includes("Trials"));
assert.deepEqual(m.histogramBins([0, 1, 2, 3], 2).map((b) => b.count), [2, 2]);
assert.deepEqual(m.quartiles([1, 2, 3, 4, 5]), { min: 1, q1: 2, median: 3, q3: 4, max: 5 });

console.log(`visuals: ${Object.keys(SAMPLES).length} specs rendered, ${rejects.length} rejected, 4 charts parsed`);
