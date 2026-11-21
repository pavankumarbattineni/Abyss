/**
 * Builds the libraries live previews may use into public/preview-runtime/lib
 * (generated, git-ignored; runs before `next dev` and `next build`).
 *
 * The preview frame has no network (src/lib/code-preview.ts), so a page that
 * loads three.js or GSAP from a CDN would break. Instead its CDN URLs and
 * bare imports are pointed at these pinned copies, served by this app:
 *
 * - ESM, for <script type="module"> / import maps: three (+ examples/jsm
 *   addons), gsap (+ every plugin), chart.js, d3, lucide.
 * - Classic scripts, for <script src>: the same libraries as globals
 *   (THREE with common addons, gsap + plugins, Chart, d3, lucide).
 * - For React previews (`require` in the compiled component): the globals
 *   above plus framer-motion and lucide-react, bundled against the preview's
 *   own React 18 (window.React).
 *
 * Versions are the exact devDependencies in package.json.
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const out = join(root, "public", "preview-runtime", "lib");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copy = (from, to, filter) => cpSync(join(modules, from), join(out, to), { recursive: true, filter });

// ── three: ESM build + addons (the decoders that need network/wasm are left out) ──
for (const file of readdirSync(join(modules, "three", "build"))) {
  if (file.endsWith(".js")) copy(`three/build/${file}`, `three/build/${file}`);
}
const SKIPPED_ADDON_DIRS = ["libs/draco", "libs/basis", "inspector"];
copy("three/examples/jsm", "three/examples/jsm", (src) => {
  const rel = src.replaceAll("\\", "/");
  return !SKIPPED_ADDON_DIRS.some((dir) => rel.includes(`/examples/jsm/${dir}`)) && !rel.endsWith(".map");
});

// The addons a classic-script page (THREE global) or a React component
// (require) is most likely to use, attached to THREE.
const THREE_ADDONS = {
  "controls/OrbitControls.js": ["OrbitControls"],
  "controls/TrackballControls.js": ["TrackballControls"],
  "controls/PointerLockControls.js": ["PointerLockControls"],
  "controls/FlyControls.js": ["FlyControls"],
  "controls/MapControls.js": ["MapControls"],
  "controls/DragControls.js": ["DragControls"],
  "controls/TransformControls.js": ["TransformControls"],
  "postprocessing/EffectComposer.js": ["EffectComposer"],
  "postprocessing/RenderPass.js": ["RenderPass"],
  "postprocessing/ShaderPass.js": ["ShaderPass"],
  "postprocessing/UnrealBloomPass.js": ["UnrealBloomPass"],
  "postprocessing/OutputPass.js": ["OutputPass"],
  "postprocessing/FilmPass.js": ["FilmPass"],
  "postprocessing/GlitchPass.js": ["GlitchPass"],
  "postprocessing/BokehPass.js": ["BokehPass"],
  "postprocessing/AfterimagePass.js": ["AfterimagePass"],
  "postprocessing/SMAAPass.js": ["SMAAPass"],
  "postprocessing/OutlinePass.js": ["OutlinePass"],
  "shaders/RGBShiftShader.js": ["RGBShiftShader"],
  "shaders/FXAAShader.js": ["FXAAShader"],
  "shaders/CopyShader.js": ["CopyShader"],
  "shaders/VignetteShader.js": ["VignetteShader"],
  "geometries/RoundedBoxGeometry.js": ["RoundedBoxGeometry"],
  "geometries/TextGeometry.js": ["TextGeometry"],
  "geometries/ParametricGeometry.js": ["ParametricGeometry"],
  "geometries/ConvexGeometry.js": ["ConvexGeometry"],
  "loaders/FontLoader.js": ["FontLoader", "Font"],
  "loaders/GLTFLoader.js": ["GLTFLoader"],
  "loaders/OBJLoader.js": ["OBJLoader"],
  "loaders/SVGLoader.js": ["SVGLoader"],
  "loaders/RGBELoader.js": ["RGBELoader"],
  "environments/RoomEnvironment.js": ["RoomEnvironment"],
  "objects/Sky.js": ["Sky"],
  "objects/Water.js": ["Water"],
  "objects/Reflector.js": ["Reflector"],
  "math/ImprovedNoise.js": ["ImprovedNoise"],
  "math/SimplexNoise.js": ["SimplexNoise"],
  "misc/GPUComputationRenderer.js": ["GPUComputationRenderer"],
  "renderers/CSS2DRenderer.js": ["CSS2DRenderer", "CSS2DObject"],
  "renderers/CSS3DRenderer.js": ["CSS3DRenderer", "CSS3DObject", "CSS3DSprite"],
  "utils/BufferGeometryUtils.js": ["mergeGeometries", "mergeVertices"],
  "libs/lil-gui.module.min.js": ["GUI"],
};
// Names removed from three over the years that older code still uses.
const THREE_ALIASES = {
  PlaneBufferGeometry: "PlaneGeometry",
  BoxBufferGeometry: "BoxGeometry",
  SphereBufferGeometry: "SphereGeometry",
  CylinderBufferGeometry: "CylinderGeometry",
  ConeBufferGeometry: "ConeGeometry",
  TorusBufferGeometry: "TorusGeometry",
  TorusKnotBufferGeometry: "TorusKnotGeometry",
  RingBufferGeometry: "RingGeometry",
  CircleBufferGeometry: "CircleGeometry",
  IcosahedronBufferGeometry: "IcosahedronGeometry",
  OctahedronBufferGeometry: "OctahedronGeometry",
  DodecahedronBufferGeometry: "DodecahedronGeometry",
  TetrahedronBufferGeometry: "TetrahedronGeometry",
  ExtrudeBufferGeometry: "ExtrudeGeometry",
  LatheBufferGeometry: "LatheGeometry",
  ShapeBufferGeometry: "ShapeGeometry",
  TubeBufferGeometry: "TubeGeometry",
};
const addonImports = Object.entries(THREE_ADDONS)
  .map(([file, names], i) => `import { ${names.map((n) => `${n} as a${i}_${n}`).join(", ")} } from "three/examples/jsm/${file}";`)
  .join("\n");
const addonObject = Object.entries(THREE_ADDONS)
  .flatMap(([, names], i) => names.map((n) => `${n}: a${i}_${n}`))
  .join(", ");
const threeGlobal = `import * as core from "three";
${addonImports}
const THREE = Object.assign({}, core, { ${addonObject} });
const aliases = ${JSON.stringify(THREE_ALIASES)};
for (const [old, now] of Object.entries(aliases)) if (!THREE[old]) THREE[old] = THREE[now];
// Classic examples/js addons (THREE.OrbitControls...) are already attached.
window.THREE = THREE;`;

const iife = (name, contents, extra = {}) =>
  build({
    stdin: { contents, resolveDir: root, loader: "js" },
    bundle: true,
    format: "iife",
    minify: true,
    legalComments: "none",
    target: "es2020",
    logLevel: "warning",
    outfile: join(out, name),
    ...extra,
  });
const esm = (name, contents) =>
  build({
    stdin: { contents, resolveDir: root, loader: "js" },
    bundle: true,
    format: "esm",
    minify: true,
    legalComments: "none",
    target: "es2020",
    logLevel: "warning",
    outfile: join(out, name),
  });

// React components use the preview's own React 18 (window.React / ReactDOM).
const JSX_RUNTIME = `const R = window.React;
function make(type, props, key, spread) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  if (children === undefined) return R.createElement(type, rest);
  return spread && Array.isArray(children) ? R.createElement(type, rest, ...children) : R.createElement(type, rest, children);
}
export const Fragment = R.Fragment;
export const jsx = (t, p, k) => make(t, p, k, false);
export const jsxs = (t, p, k) => make(t, p, k, true);
export const jsxDEV = jsx;`;
const reactGlobals = {
  name: "preview-react-globals",
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "preview-react" }));
    b.onLoad({ filter: /.*/, namespace: "preview-react" }, (args) => {
      if (args.path === "react/jsx-runtime" || args.path === "react/jsx-dev-runtime") {
        return { contents: JSX_RUNTIME, loader: "js" };
      }
      const global = args.path.startsWith("react-dom") ? "ReactDOM" : "React";
      return { contents: `module.exports = window.${global};`, loader: "js" };
    });
  },
};

// gsap: every plugin (all free since 3.13), registered once.
const GSAP_PLUGINS = readdirSync(join(modules, "gsap", "dist"))
  .filter((f) => f.endsWith(".min.js") && f !== "gsap.min.js" && f !== "all.min.js")
  .map((f) => f.replace(".min.js", ""));
const gsapAll = `import * as all from "gsap/all";
export * from "gsap/all";
export default all.gsap;
try { all.gsap.registerPlugin(${GSAP_PLUGINS.filter((p) => !["EasePack", "CustomBounce", "CustomWiggle", "MotionPathHelper", "GSDevTools", "PixiPlugin", "EaselPlugin", "CSSRulePlugin"].includes(p))
  .map((p) => `all.${p}`)
  .join(", ")}); } catch (e) {}`;

await Promise.all([
  iife("three.global.js", threeGlobal),
  esm("gsap.mjs", gsapAll),
  esm("chart.mjs", `import { Chart, registerables } from "chart.js";\nChart.register(...registerables);\nexport * from "chart.js";\nexport default Chart;`),
  esm("lucide.mjs", `export * from "lucide";`),
  esm("d3.mjs", `export * from "d3";`),
  // React previews: require("gsap"), require("chart.js"), require("framer-motion")...
  iife("react/gsap.js", gsapAll, { globalName: "__previewGsap" }),
  iife(
    "react/chart.js",
    `import { Chart, registerables } from "chart.js";\nChart.register(...registerables);\nexport * from "chart.js";\nexport default Chart;`,
    { globalName: "__previewChart" },
  ),
  iife("react/framer-motion.js", `export * from "framer-motion";`, { globalName: "__previewMotion", plugins: [reactGlobals] }),
  iife("react/lucide-react.js", `export * from "lucide-react";`, { globalName: "__previewLucideReact", plugins: [reactGlobals] }),
]);

// Classic builds published by the packages themselves.
copy("gsap/dist/gsap.min.js", "gsap/gsap.min.js");
for (const plugin of GSAP_PLUGINS) copy(`gsap/dist/${plugin}.min.js`, `gsap/${plugin}.min.js`);
copy("chart.js/dist/chart.umd.min.js", "chart.umd.min.js");
copy("d3/dist/d3.min.js", "d3.min.js");
copy("lucide/dist/umd/lucide.min.js", "lucide.min.js");
// Stands in for old classic three addon scripts (examples/js/...): THREE.* already has them.
writeFileSync(join(out, "noop.js"), "/* provided by three.global.js */\n");

const versions = Object.fromEntries(
  ["three", "gsap", "chart.js", "d3", "lucide", "framer-motion", "lucide-react"].map((name) => [
    name,
    JSON.parse(readFileSync(join(modules, name, "package.json"), "utf8")).version,
  ]),
);
writeFileSync(join(out, "versions.json"), JSON.stringify({ gsapPlugins: GSAP_PLUGINS, ...versions }, null, 2));
if (!existsSync(join(out, "three.global.js"))) throw new Error("three.global.js was not built");
console.log(`preview runtime built: ${Object.entries(versions).map(([n, v]) => `${n}@${v}`).join(", ")}`);
