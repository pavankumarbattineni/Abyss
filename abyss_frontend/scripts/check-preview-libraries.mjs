/**
 * Guards the live preview's library rewriting (src/lib/code-preview.ts):
 * every way a page may link a supported library -- CDN, GitHub build, scoped
 * or former package name, legacy file name, any host -- must resolve to a file
 * this app really serves (public/preview-runtime/lib), as a classic script, a
 * module or a stylesheet. Runs before every build (after the runtime is
 * built); a shape that stops resolving fails the build instead of breaking
 * pages. Run on its own: node scripts/check-preview-libraries.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src/lib/code-preview.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  external: ["sucrase"],
  logLevel: "silent",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const BASE = "https://app.example/preview-runtime";
const LIB = `${BASE}/lib/`;

const served = (url) => existsSync(join(root, "public/preview-runtime", url.slice(BASE.length + 1).replace(/\/$/, "")));
const rewrite = (html) => mod.withLocalLibraries(html, BASE);
const scriptSrc = (html) => /src="([^"]+)"/.exec(rewrite(html))[1];

let checked = 0;
const failures = [];
function expectLocal(kind, url, expected) {
  checked++;
  const html =
    kind === "classic" ? `<script src="${url}"></script>`
    : kind === "module" ? `<script type="module">import x from "${url}";</script>`
    : `<link rel="stylesheet" href="${url}">`;
  const out = rewrite(html);
  const got = (kind === "module" ? /from "([^"]+)"/ : kind === "css" ? /href="([^"]+)"/ : /src="([^"]+)"/).exec(out)?.[1];
  if (!got?.startsWith(LIB)) return failures.push(`${kind} ${url}\n    -> not rewritten (${got})`);
  if (!served(got)) return failures.push(`${kind} ${url}\n    -> ${got} (file missing)`);
  if (expected && !got.endsWith(expected)) failures.push(`${kind} ${url}\n    -> ${got} (expected …${expected})`);
}

// Classic <script src>: every CDN and URL shape seen in generated pages.
for (const [url, file] of [
  // Lenis: current name, former scoped name, jsDelivr GitHub builds (the reported page), bare package.
  ["https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/bundled/lenis.min.js", "lenis/lenis.min.js"],
  ["https://cdn.jsdelivr.net/gh/darkroomengineering/lenis@1.1.13/dist/lenis.min.js", "lenis/lenis.min.js"],
  ["https://unpkg.com/@studio-freight/lenis@1.0.42/dist/lenis.min.js", "lenis/lenis.min.js"],
  ["https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.min.js", "lenis/lenis.min.js"],
  ["https://unpkg.com/lenis@1.1.13/dist/lenis.min.js", "lenis/lenis.min.js"],
  ["https://cdn.jsdelivr.net/npm/lenis@1", "lenis/lenis.min.js"],
  ["https://unpkg.com/lenis", "lenis/lenis.min.js"],
  // three: cdnjs r-versions, npm builds, old global addons.
  ["https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "three.global.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js", "three.global.js"],
  ["https://unpkg.com/three@0.128.0/build/three.min.js", "three.global.js"],
  ["https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.js", "three.global.js"],
  ["https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js", "noop.js"],
  ["https://threejs.org/build/three.min.js", "three.global.js"],
  ["https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/build/three.min.js", "three.global.js"],
  // GSAP 3 and 2 (TweenMax), plugins in any letter case.
  ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js", "gsap/gsap.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js", "gsap/ScrollTrigger.min.js"],
  ["https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js", "gsap/ScrollTrigger.min.js"],
  ["https://unpkg.com/gsap@3/dist/gsap.min.js", "gsap/gsap.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/gsap/2.1.3/TweenMax.min.js", "gsap/gsap.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/scrolltrigger.min.js", "gsap/ScrollTrigger.min.js"],
  ["https://assets.codepen.io/16327/SplitText3.min.js", null], // not a library name: left alone (checked below)
  // Chart.js, d3, lucide, AOS, anime.js, Swiper.
  ["https://cdn.jsdelivr.net/npm/chart.js", "chart.umd.min.js"],
  ["https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js", "chart.umd.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js", "chart.umd.min.js"],
  ["https://d3js.org/d3.v7.min.js", "d3.min.js"],
  ["https://d3js.org/d3.v6.js", "d3.min.js"],
  ["https://cdn.jsdelivr.net/npm/d3@7", "d3.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js", "d3.min.js"],
  ["https://unpkg.com/lucide@latest", "lucide.min.js"],
  ["https://unpkg.com/lucide@latest/dist/umd/lucide.js", "lucide.min.js"],
  ["https://unpkg.com/aos@2.3.1/dist/aos.js", "aos/aos.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/aos/2.3.4/aos.js", "aos/aos.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js", "anime/anime.min.js"],
  ["https://cdn.jsdelivr.net/npm/animejs@3.2.1/lib/anime.min.js", "anime/anime.min.js"],
  ["https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js", "swiper/swiper-bundle.min.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/Swiper/11.0.5/swiper-bundle.min.js", "swiper/swiper-bundle.min.js"],
]) {
  if (file) expectLocal("classic", url, file);
}

// Unrelated scripts stay untouched (and blocked): they aren't provided.
for (const url of ["https://assets.codepen.io/16327/SplitText3.min.js", "https://example.com/js/app.js", "https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"]) {
  checked++;
  if (scriptSrc(`<script src="${url}"></script>`) !== url) failures.push(`classic ${url}\n    -> rewritten, but isn't a provided library`);
}

// Modules: imports, CDN ESM builds, GitHub and esm.run.
for (const [url, file] of [
  ["https://unpkg.com/three@0.160.0/build/three.module.js", "three/build/three.module.js"],
  ["https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js", "three/examples/jsm/controls/OrbitControls.js"],
  ["https://esm.sh/three@0.160", "three/build/three.module.js"],
  ["https://esm.sh/three@0.160/addons/postprocessing/EffectComposer", "three/examples/jsm/postprocessing/EffectComposer.js"],
  ["https://cdn.skypack.dev/three", "three/build/three.module.js"],
  ["https://ga.jspm.io/npm:three@0.160.0/build/three.module.js", "three/build/three.module.js"],
  ["https://cdn.jsdelivr.net/npm/three/build/three.module.js", "three/build/three.module.js"],
  ["https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm", "gsap.mjs"],
  ["https://esm.run/gsap", "gsap.mjs"],
  ["https://cdn.jsdelivr.net/npm/d3@7/+esm", "d3.mjs"],
  ["https://cdn.jsdelivr.net/npm/lenis@1.1.13/+esm", "lenis/lenis.mjs"],
  ["https://esm.sh/@studio-freight/lenis@1.0.42", "lenis/lenis.mjs"],
  ["https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.es.js", "anime/anime.es.js"],
  ["https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.mjs", "swiper/swiper-bundle.min.mjs"],
  ["https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm", "chart.mjs"],
  ["https://some-mirror.example/libs/three.module.min.js", "three/build/three.module.js"],
]) {
  expectLocal("module", url, file);
}

// Stylesheets.
for (const [url, file] of [
  ["https://unpkg.com/aos@2.3.1/dist/aos.css", "aos/aos.css"],
  ["https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css", "swiper/swiper-bundle.min.css"],
  ["https://unpkg.com/lenis@1.1.13/dist/lenis.css", "lenis/lenis.css"],
  ["https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.29/bundled/lenis.css", "lenis/lenis.css"],
]) {
  expectLocal("css", url, file);
}

// Our own URLs are never rewritten again (a classic Lenis must not turn into the module build).
checked++;
const ours = `${LIB}lenis/lenis.min.js`;
if (scriptSrc(`<script src="${ours}"></script>`) !== ours) failures.push("an already-local URL was rewritten");

// Every bare import in the import map is served.
for (const [name, url] of Object.entries(mod.libraryImportMap(BASE))) {
  checked++;
  if (!served(url)) failures.push(`import map ${name} -> ${url} (file missing)`);
}

// The blocked-file message names every provided library.
for (const name of ["Lenis", "Swiper", "AOS", "anime.js", "three.js", "GSAP"]) {
  checked++;
  assert.ok(mod.PREVIEW_LIBRARY_NAMES.includes(name), `PREVIEW_LIBRARY_NAMES lacks ${name}`);
}

if (failures.length) {
  console.error(`preview library check: ${failures.length} of ${checked} failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`preview library check: all ${checked} URL shapes resolve to served files`);
