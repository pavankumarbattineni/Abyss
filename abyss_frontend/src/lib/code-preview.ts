/**
 * Live previews of frontend code an agent writes (```html, or a React
 * component in ```jsx / ```tsx).
 *
 * Unlike ```abyss-ui (lib/interactive.ts), where the model only supplies data
 * for our own components, this runs MODEL-WRITTEN CODE -- so it only ever runs
 * inside a sandboxed iframe (components/shared/code-preview.tsx):
 *
 * - `sandbox="allow-scripts allow-forms"` WITHOUT `allow-same-origin`: the
 *   frame gets an opaque origin, so it can't read the app's cookies, storage,
 *   DOM or session token, open popups or navigate the page.
 * - A Content Security Policy written into the document: no network at all
 *   (`connect-src 'none'`), scripts and styles only inline or from this app's
 *   pinned runtime files (public/preview-runtime), images only data:/blob:.
 * - Messages from the frame (height, ready, errors) are checked against the
 *   frame's own window and a per-preview channel id, and only ever displayed.
 *
 * React components are compiled here with sucrase (text -> text; nothing is
 * executed in the app) and run in the frame with a pinned React 18 build.
 */

export type PreviewKind = "html" | "react";

/** Larger blocks are shown as code only. */
export const MAX_PREVIEW_CHARS = 400_000;
const RUNTIME = {
  react: "react-18.3.1.min.js",
  reactDom: "react-dom-18.3.1.min.js",
  tailwind: "tailwindcss-browser-4.3.5.js",
};

/*
 * Libraries a preview may use, served by this app from public/preview-runtime/lib
 * (built by scripts/build-preview-runtime.mjs from the pinned devDependencies).
 * The frame has no network, so a page's CDN URLs and bare imports for these
 * are pointed at the local copies; anything else stays blocked.
 */
const LIB = "lib";
/** gsap's plugins (each a classic script of its own, all in the ESM bundle). */
const GSAP_PLUGINS = [
  "CSSRulePlugin", "CustomBounce", "CustomEase", "CustomWiggle", "Draggable", "DrawSVGPlugin", "EasePack",
  "EaselPlugin", "Flip", "GSDevTools", "InertiaPlugin", "MorphSVGPlugin", "MotionPathHelper", "MotionPathPlugin",
  "Observer", "Physics2DPlugin", "PhysicsPropsPlugin", "PixiPlugin", "ScrambleTextPlugin", "ScrollSmoother",
  "ScrollToPlugin", "ScrollTrigger", "SplitText", "TextPlugin",
];
/** three.js addons attached to the THREE global (classic pages, React `require`). */
const THREE_GLOBAL_ADDONS = new Set([
  "OrbitControls", "TrackballControls", "PointerLockControls", "FlyControls", "MapControls", "DragControls",
  "TransformControls", "EffectComposer", "RenderPass", "ShaderPass", "UnrealBloomPass", "OutputPass", "FilmPass",
  "GlitchPass", "BokehPass", "AfterimagePass", "SMAAPass", "OutlinePass", "RGBShiftShader", "FXAAShader",
  "CopyShader", "VignetteShader", "RoundedBoxGeometry", "TextGeometry", "ParametricGeometry", "ConvexGeometry",
  "FontLoader", "GLTFLoader", "OBJLoader", "SVGLoader", "RGBELoader", "RoomEnvironment", "Sky", "Water",
  "Reflector", "ImprovedNoise", "SimplexNoise", "GPUComputationRenderer", "CSS2DRenderer", "CSS3DRenderer",
  "BufferGeometryUtils", "lil-gui.module.min",
]);

type LibName = "three" | "gsap" | "chart.js" | "d3" | "lucide" | "aos" | "animejs" | "lenis" | "swiper";

/**
 * Every name a page may use for a supported library: npm names, current and
 * former (Lenis was @studio-freight/lenis), cdnjs names and GitHub
 * repositories (jsDelivr's /gh/owner/repo form). Lower case.
 */
const LIB_ALIASES: Record<string, LibName> = {
  three: "three", "three.js": "three", "mrdoob/three.js": "three",
  gsap: "gsap", "greensock/gsap": "gsap",
  "chart.js": "chart.js", "chartjs/chart.js": "chart.js",
  d3: "d3", "d3/d3": "d3",
  lucide: "lucide", "lucide-icons/lucide": "lucide",
  aos: "aos", "michalsnik/aos": "aos",
  animejs: "animejs", "juliangarnier/anime": "animejs",
  lenis: "lenis", "@studio-freight/lenis": "lenis", "studio-freight/lenis": "lenis", "darkroomengineering/lenis": "lenis",
  swiper: "swiper", "nolimits4web/swiper": "swiper",
};

/** What the preview provides, as the error for a blocked file names it. */
export const PREVIEW_LIBRARY_NAMES =
  "three.js (+ addons), GSAP (+ plugins), Chart.js, d3, lucide, AOS, anime.js, Lenis, Swiper and Tailwind";

/** The stylesheet each library ships, if any. */
const LIBRARY_CSS: Partial<Record<LibName, string>> = {
  aos: "aos/aos.css",
  lenis: "lenis/lenis.css",
  swiper: "swiper/swiper-bundle.min.css",
};

/** GSAP 2 names: GSAP 3's build still defines these globals. */
const GSAP_LEGACY = new Set(["tweenmax", "tweenlite", "timelinemax", "timelinelite", "cssplugin"]);

function gsapPlugin(name: string): string | undefined {
  return GSAP_PLUGINS.find((plugin) => plugin.toLowerCase() === name.toLowerCase());
}

/** Local file (under lib/) for a library file a page loads with <script src>; null if not ours. */
function classicFile(lib: LibName, path: string): string | null {
  switch (lib) {
    case "three":
      // Old addon scripts (examples/js/...) set THREE.X, already in the global build.
      return /\/examples\/js\//.test(path) ? "noop.js" : /module|\/examples\/jsm\/|\/addons\//.test(path) ? null : "three.global.js";
    case "gsap": {
      const name = /\/([A-Za-z0-9]+)(\.min)?\.js$/.exec(path)?.[1];
      const plugin = name && gsapPlugin(name);
      if (plugin) return `gsap/${plugin}.min.js`;
      return name && name !== "gsap" && name !== "all" && !GSAP_LEGACY.has(name.toLowerCase()) ? null : "gsap/gsap.min.js";
    }
    case "chart.js":
      return "chart.umd.min.js";
    case "d3":
      return "d3.min.js";
    case "lucide":
      return "lucide.min.js";
    case "aos":
      return "aos/aos.js";
    case "animejs":
      return "anime/anime.min.js";
    case "lenis":
      return /snap/.test(path) ? null : "lenis/lenis.min.js";
    case "swiper":
      return /element/.test(path) ? null : "swiper/swiper-bundle.min.js";
  }
}

/** Local file (under lib/) for a library module a page imports; null if not ours. */
function moduleFile(lib: LibName, path: string): string | null {
  if (lib !== "three") {
    return {
      gsap: "gsap.mjs", "chart.js": "chart.mjs", d3: "d3.mjs", lucide: "lucide.mjs", aos: null,
      animejs: "anime/anime.es.js", lenis: "lenis/lenis.mjs", swiper: "swiper/swiper-bundle.min.mjs",
    }[lib];
  }
  const addon = /\/(?:examples\/jsm|addons)\/(.*)$/.exec(path)?.[1];
  if (addon === "") return "three/examples/jsm/"; // an import-map folder entry
  if (addon) return `three/examples/jsm/${/\.[a-z]+$/i.test(addon) ? addon : `${addon}.js`}`;
  if (/webgpu/.test(path)) return "three/build/three.webgpu.js";
  if (/tsl/.test(path)) return "three/build/three.tsl.js";
  if (/three\.core/.test(path)) return "three/build/three.core.js";
  return "three/build/three.module.js";
}

/**
 * A CDN URL: jsDelivr (/npm/ and GitHub /gh/), unpkg, esm.sh, esm.run,
 * Skypack, JSPM (ga.jspm.io and jspm.dev) -- package[@version][/path], the
 * package possibly scoped or an owner/repo -- or cdnjs (library/version/file).
 */
const CDN_URL =
  /(?:https?:)?\/\/(?:cdn\.jsdelivr\.net\/(?:npm|gh)\/|unpkg\.com\/|esm\.sh\/(?:v\d+\/)?|esm\.run\/|cdn\.skypack\.dev\/|ga\.jspm\.io\/npm:|jspm\.dev\/(?:npm:)?|(cdnjs\.cloudflare\.com\/ajax\/libs\/))((?:@?[\w.-]+\/)?[A-Za-z][\w.-]*)(?:@[\w.^~-]+)?(\/[^\s"'`)?#]*)?(?:\?[^\s"'`)#]*)?/g;

function libraryOf(name: string, rawPath: string): { lib: LibName; path: string } | null {
  const key = name.toLowerCase();
  if (LIB_ALIASES[key]) return { lib: LIB_ALIASES[key], path: rawPath };
  // "three/build/three.module.js" with no version: the name took a path segment.
  const [first, ...rest] = key.split("/");
  if (rest.length && LIB_ALIASES[first]) return { lib: LIB_ALIASES[first], path: `/${name.split("/").slice(1).join("/")}${rawPath}` };
  return null;
}

function localLibraryUrl(match: RegExpExecArray | string[], base: string, classic: boolean): string | null {
  const [, cdnjs, name, rawPath = ""] = match;
  const found = libraryOf(name, rawPath);
  if (!found) return null;
  // cdnjs puts the version first: /ajax/libs/three.js/r128/three.min.js
  const path = cdnjs ? found.path.replace(/^\/[^/]+/, "") : found.path;
  // A library's own stylesheet; other files of these packages aren't served.
  if (/\.css$/i.test(path)) return LIBRARY_CSS[found.lib] ? `${base}/${LIB}/${LIBRARY_CSS[found.lib]}` : null;
  if (/\.(map|json)$/i.test(path)) return null;
  const file = classic ? classicFile(found.lib, path) : moduleFile(found.lib, path);
  return file ? `${base}/${LIB}/${file}` : null;
}

/**
 * The safety net: a library file recognised by its file name, whatever the
 * host or URL shape (a mirror, a raw GitHub file, an unusual CDN path), so a
 * supported library is never blocked just because of where it was linked from.
 */
const LIBRARY_FILE = /^(?:https?:)?\/\/[^\s"'`)]+\/([\w.-]+?)(?:[.-]min)?\.(m?js|css)(?:[?#][^\s"'`)]*)?$/i;

function fileByName(url: string, base: string, context: "classic" | "module" | "css"): string | null {
  if (url.startsWith(base)) return null; // already ours
  const match = LIBRARY_FILE.exec(url);
  if (!match) return null;
  // d3's own site serves versioned names: d3.v7.min.js.
  const name = match[1].toLowerCase().replace(/^d3\.v\d+$/, "d3");
  const ext = match[2].toLowerCase();
  let file: string | null = null;
  if (ext === "css" || context === "css") {
    file = { aos: "aos/aos.css", lenis: "lenis/lenis.css", swiper: "swiper/swiper-bundle.min.css", "swiper-bundle": "swiper/swiper-bundle.min.css" }[name] ?? null;
  } else if (context === "classic" && ext === "js") {
    const plugin = gsapPlugin(name);
    file = plugin
      ? `gsap/${plugin}.min.js`
      : GSAP_LEGACY.has(name)
        ? "gsap/gsap.min.js"
        : ({
            three: "three.global.js", gsap: "gsap/gsap.min.js", chart: "chart.umd.min.js", "chart.umd": "chart.umd.min.js",
            d3: "d3.min.js", lucide: "lucide.min.js", aos: "aos/aos.js", anime: "anime/anime.min.js",
            lenis: "lenis/lenis.min.js", swiper: "swiper/swiper-bundle.min.js", "swiper-bundle": "swiper/swiper-bundle.min.js",
          } as Record<string, string>)[name] ?? null;
  } else {
    file = ({
      "three.module": "three/build/three.module.js", three: "three/build/three.module.js", "anime.es": "anime/anime.es.js",
      lenis: "lenis/lenis.mjs", d3: "d3.mjs", "swiper-bundle": "swiper/swiper-bundle.min.mjs", chart: "chart.mjs", lucide: "lucide.mjs",
    } as Record<string, string>)[name] ?? null;
  }
  return file ? `${base}/${LIB}/${file}` : null;
}

/** The import map that makes bare imports ("three", "gsap/ScrollTrigger"...) load the local copies. */
export function libraryImportMap(runtimeBase: string): Record<string, string> {
  const lib = `${runtimeBase.replace(/\/$/, "")}/${LIB}`;
  const imports: Record<string, string> = {
    three: `${lib}/three/build/three.module.js`,
    "three/webgpu": `${lib}/three/build/three.webgpu.js`,
    "three/tsl": `${lib}/three/build/three.tsl.js`,
    "three/addons/": `${lib}/three/examples/jsm/`,
    "three/examples/jsm/": `${lib}/three/examples/jsm/`,
    gsap: `${lib}/gsap.mjs`,
    "gsap/all": `${lib}/gsap.mjs`,
    "chart.js": `${lib}/chart.mjs`,
    "chart.js/auto": `${lib}/chart.mjs`,
    d3: `${lib}/d3.mjs`,
    lucide: `${lib}/lucide.mjs`,
    animejs: `${lib}/anime/anime.es.js`,
    lenis: `${lib}/lenis/lenis.mjs`,
    "@studio-freight/lenis": `${lib}/lenis/lenis.mjs`,
    swiper: `${lib}/swiper/swiper-bundle.min.mjs`,
    "swiper/bundle": `${lib}/swiper/swiper-bundle.min.mjs`,
  };
  for (const plugin of GSAP_PLUGINS) {
    imports[`gsap/${plugin}`] = `${lib}/gsap.mjs`;
    imports[`gsap/${plugin}.js`] = `${lib}/gsap.mjs`;
  }
  return imports;
}

const SCRIPT_SRC_TAG = /<script\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/gi;
const STYLESHEET_TAG = /<link\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>/gi;
const IMPORT_MAP = /(<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>)([\s\S]*?)(<\/script>)/i;
/** A quoted remote .js/.mjs URL: an import, import() or import map entry. */
const QUOTED_MODULE_URL = /(["'`])((?:https?:)?\/\/[^\s"'`)]+?\.m?js(?:[?#][^\s"'`)]*)?)\1/g;

/**
 * A page's copies of the supported libraries (three, gsap, chart.js, d3,
 * lucide, AOS, anime.js, Lenis, Swiper -- and their stylesheets) swapped for
 * this app's local ones: classic scripts get the global builds, module
 * imports and import maps the ESM builds. Known CDN URLs are matched by
 * package; anything else by file name. The page's own import map, if any,
 * gets the bare names it lacks; other URLs are left alone (and stay blocked
 * by the security policy).
 */
export function withLocalLibraries(code: string, runtimeBase: string): string {
  const base = runtimeBase.replace(/\/$/, "");
  const cdn = (url: string, classic: boolean) => {
    const match = new RegExp(CDN_URL.source).exec(url);
    return match && match.index === 0 ? localLibraryUrl(match, base, classic) : null;
  };
  let page = code.replace(SCRIPT_SRC_TAG, (tag, before: string, quote: string, src: string, after: string) => {
    const classic = !/\btype\s*=\s*["']?module/i.test(before + after);
    const local = cdn(src, classic) ?? fileByName(src, base, classic ? "classic" : "module");
    return local ? `<script${before}src=${quote}${local}${quote}${after}>` : tag;
  });
  page = page.replace(STYLESHEET_TAG, (tag, before: string, quote: string, href: string, after: string) => {
    if (!/\.css(?:[?#]|$)/i.test(href) && !/stylesheet/i.test(before + after)) return tag;
    const local = cdn(href, false) ?? fileByName(href, base, "css");
    return local ? `<link${before}href=${quote}${local}${quote}${after}>` : tag;
  });
  // Everything else is a module context: import statements, import(), import maps.
  page = page.replace(CDN_URL, (...args) => localLibraryUrl(args.slice(0, 4) as string[], base, false) ?? args[0]);
  page = page.replace(QUOTED_MODULE_URL, (whole, quote: string, url: string) => {
    const local = fileByName(url, base, "module");
    return local ? `${quote}${local}${quote}` : whole;
  });
  const ours = libraryImportMap(base);
  return page.replace(IMPORT_MAP, (whole, open: string, json: string, close: string) => {
    try {
      const map = JSON.parse(json) as { imports?: Record<string, string> };
      return `${open}${JSON.stringify({ ...map, imports: { ...ours, ...(map.imports ?? {}) } })}${close}`;
    } catch {
      return whole;
    }
  });
}

/** Modules a React preview may import, with the file and global each comes from. */
interface ReactLibrary {
  file?: string;
  global: string;
}
function reactLibrary(name: string): ReactLibrary | null {
  if (name === "react") return { global: "React" };
  if (name === "react-dom" || name === "react-dom/client") return { global: "ReactDOM" };
  if (name === "three" || /^three\/(addons|examples\/jsm)\//.test(name)) return { file: "three.global.js", global: "THREE" };
  if (name === "gsap" || /^gsap\/[A-Za-z]+(\.js)?$/.test(name)) return { file: "react/gsap.js", global: "__previewGsap" };
  if (name === "framer-motion" || name === "motion/react") return { file: "react/framer-motion.js", global: "__previewMotion" };
  if (name === "lucide-react") return { file: "react/lucide-react.js", global: "__previewLucideReact" };
  if (name === "chart.js" || name === "chart.js/auto") return { file: "react/chart.js", global: "__previewChart" };
  if (name === "d3") return { file: "d3.min.js", global: "d3" };
  if (name === "animejs" || name === "animejs/lib/anime.es.js") return { file: "anime/anime.min.js", global: "anime" };
  if (name === "lenis" || name === "@studio-freight/lenis") return { file: "lenis/lenis.min.js", global: "Lenis" };
  return null;
}
/** What the preview lists when a component imports something else. */
const REACT_LIBRARY_NAMES = "react, three (+ addons), gsap, framer-motion, lucide-react, chart.js, d3, anime.js and lenis";

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml"]);
const REACT_LANGUAGES = new Set(["jsx", "tsx", "react"]);
const SCRIPT_LANGUAGES = new Set(["js", "javascript", "ts", "typescript"]);

/**
 * True when Markdown ends inside a fenced code block that was never closed
 * (``` or ~~~, CommonMark rules: a closing fence uses the same character, is
 * at least as long and has no info string).
 */
export function endsInOpenCodeBlock(markdown: string): boolean {
  let open: { char: string; length: number } | null = null;
  for (const line of markdown.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) continue;
    const [, marks, rest] = fence;
    if (!open) {
      if (marks[0] === "`" && rest.includes("`")) continue; // not a fence: inline code
      open = { char: marks[0], length: marks.length };
    } else if (marks[0] === open.char && marks.length >= open.length && !rest.trim()) {
      open = null;
    }
  }
  return open !== null;
}

/** Whether a fenced code block is a runnable page/component, and which kind. */
export function previewKind(language: string, code: string): PreviewKind | null {
  const lang = (language || "").toLowerCase();
  if (!code.trim() || code.length > MAX_PREVIEW_CHARS) return null;
  if (HTML_LANGUAGES.has(lang)) {
    // A page or a UI fragment -- not a lone tag shown as an example.
    return /<(html|body|head|main|div|section|form|button|canvas|svg|script|style)\b/i.test(code) ? "html" : null;
  }
  const isComponent =
    /export\s+default\b/.test(code) || /\b(function|const|let|class)\s+App\b/.test(code);
  const hasJsx = /<[A-Za-z][\w.]*[\s/>]/.test(code);
  if (REACT_LANGUAGES.has(lang)) return isComponent && hasJsx ? "react" : null;
  if (SCRIPT_LANGUAGES.has(lang)) {
    // Plain JS/TS only when it is clearly a React component, never a snippet.
    return isComponent && hasJsx && /from\s+["']react["']/.test(code) ? "react" : null;
  }
  return null;
}

export interface CompiledComponent {
  code?: string;
  /** Library files (under lib/) the component imports, loaded before it runs. */
  libraries?: string[];
  error?: string;
}

/** JSX/TypeScript -> plain JS (CommonJS `require` for imports). */
export async function compileReactComponent(source: string): Promise<CompiledComponent> {
  try {
    const { transform } = await import("sucrase");
    const { code } = transform(source, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "classic",
      production: true,
    });
    const imports = [...new Set([...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]))];
    const unsupported = imports.filter((name) => !reactLibrary(name));
    if (unsupported.length) {
      return {
        error: `The preview can only use ${REACT_LIBRARY_NAMES}; this component also imports ${unsupported.join(", ")}.`,
      };
    }
    const missingAddons = imports
      .filter((name) => /^three\//.test(name))
      .filter((name) => !THREE_GLOBAL_ADDONS.has(name.split("/").pop()!.replace(/\.js$/, "")));
    if (missingAddons.length) {
      return {
        error: `The preview's three.js has these addons: ${[...THREE_GLOBAL_ADDONS].join(", ")}; this component also imports ${missingAddons.join(", ")}.`,
      };
    }
    const libraries = [...new Set(imports.map((name) => reactLibrary(name)?.file).filter((f): f is string => Boolean(f)))];
    return { code, libraries };
  } catch (err) {
    return { error: `The component couldn't be compiled: ${(err as Error).message}` };
  }
}

/** Keep `</script>` inside code from closing the surrounding script element. */
function inlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function policy(runtimeBase: string): string {
  const origin = new URL(runtimeBase).origin;
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** Runs first in every preview: storage stand-in, error and size reporting. */
function bridge(channel: string): string {
  return `(function () {
  var CHANNEL = ${JSON.stringify(channel)};
  function post(type, data) { try { parent.postMessage({ channel: CHANNEL, type: type, data: data }, "*"); } catch (e) {} }
  // Sent before anything else of the page runs: our document is in the frame.
  // "ready" waits for the load event, which a heavy page (3D scenes, big
  // scripts) can take seconds to reach.
  post("alive");
  function memoryStorage() {
    var m = new Map();
    return {
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      key: function (i) { var keys = Array.from(m.keys()); return i < keys.length ? keys[i] : null; },
      get length() { return m.size; }
    };
  }
  // The sandbox has no storage (opaque origin): give apps an in-memory one so
  // history/favorites work for the session instead of throwing.
  // Service workers need a real origin, which the sandbox doesn't have: reading
  // navigator.serviceWorker throws. A stand-in keeps apps that register one
  // (offline/PWA support) running; nothing is actually registered.
  try { navigator.serviceWorker; } catch (e) {
    var noWorker = {
      register: function () { return Promise.resolve({ unregister: function () { return Promise.resolve(true); }, update: function () { return Promise.resolve(); } }); },
      getRegistration: function () { return Promise.resolve(undefined); },
      getRegistrations: function () { return Promise.resolve([]); },
      ready: new Promise(function () {}),
      controller: null,
      addEventListener: function () {},
      removeEventListener: function () {}
    };
    try { Object.defineProperty(navigator, "serviceWorker", { value: noWorker, configurable: true }); } catch (_) {}
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { window[name].getItem("__probe"); }
    catch (e) { try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (_) {} }
  });
  // document.cookie throws without a real origin: an in-memory jar instead.
  try { document.cookie; } catch (e) {
    var jar = {};
    try {
      Object.defineProperty(document, "cookie", {
        configurable: true,
        get: function () { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); },
        set: function (v) {
          var pair = String(v).split(";")[0], i = pair.indexOf("=");
          if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
        }
      });
    } catch (_) {}
  }
  // Files the security policy blocked (CDN scripts, web fonts, remote images):
  // report each site once, so the user sees why the page looks broken.
  var blockedHosts = {};
  document.addEventListener("securitypolicyviolation", function (e) {
    var uri = String(e.blockedURI || "");
    if (!/^https?:/i.test(uri)) return; // inline/eval are allowed; data: and blob: aren't network
    var host;
    try { host = new URL(uri).host; } catch (_) { return; }
    if (blockedHosts[host]) return;
    blockedHosts[host] = true;
    post("blocked", { host: host, kind: String(e.effectiveDirective || e.violatedDirective || "") });
  });
  // Only errors in the page's own code are reported as problems to fix. Not:
  // - "ResizeObserver loop ..." -- a browser notice, nothing is broken;
  // - a bare "Script error." -- no detail at all (thrown inside a library
  //   file), so there is nothing the agent could act on;
  // - what the sandbox or the browser refuses, not the code: autoplay,
  //   fullscreen, clipboard or pointer-lock requests (NotAllowedError), an
  //   interrupted play() (AbortError), media that can't load offline
  //   (NotSupportedError) -- and no WebGL on this device, reported as such.
  var ENVIRONMENT_ERRORS = { NotAllowedError: 1, AbortError: 1, NotSupportedError: 1 };
  var NO_WEBGL = "3D graphics (WebGL) aren't available in this browser, so the 3D part can't be shown here.";
  function isWebglMissing(text) { return /webgl/i.test(text) && /(context|not supported|unavailable|creat)/i.test(text); }
  window.addEventListener("error", function (e) {
    var message = String(e.message || (e.error && e.error.message) || "");
    if (/ResizeObserver loop/i.test(message)) return;
    if (!e.error && /^(Uncaught )?Script error\\.?$/i.test(message.trim())) return;
    if (e.error && ENVIRONMENT_ERRORS[e.error.name]) return;
    if (isWebglMissing(message)) { post("environment", { message: NO_WEBGL }); return; }
    post("error", { message: message || "Script error", line: e.lineno || null });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    if (r && ENVIRONMENT_ERRORS[r.name]) return;
    var message = String((r && r.message) || r);
    if (isWebglMissing(message)) { post("environment", { message: NO_WEBGL }); return; }
    post("error", { message: "Unhandled promise rejection: " + message });
  });
  // No navigation away from the preview. The document's own address is
  // about:srcdoc, and the <base href="about:srcdoc"> that head() puts before
  // the security policy makes every "#..." URL -- a link, location.href,
  // location.assign/replace, window.location -- resolve to it: an in-page
  // hash change (hash routers get their "hashchange"; nothing reloads). Any
  // other link does nothing here: relative paths can't resolve against
  // about:srcdoc, and other sites can't open in the preview.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = (a.getAttribute("href") || "").trim();
    if (href.charAt(0) === "#" && href !== "#" && href !== "#!") return; // in-page: the browser handles it
    // Cancels only the browser's navigation: the page's own click handlers still run.
    e.preventDefault();
    if (href === "#" || href === "#!") return; // a placeholder link (often a button styled as one)
    if (/^(https?:|mailto:|tel:|\\/\\/)/i.test(href)) notice("Links to other sites don't open in the preview.");
  }, true);

  // A small in-page message, standing in for browser dialogs the sandbox blocks.
  var noticeTimer = 0;
  function notice(text) {
    if (!document.body) return;
    var el = document.getElementById("__preview_notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "__preview_notice";
      el.setAttribute("role", "status");
      el.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:min(90vw,420px);padding:10px 14px;border-radius:10px;background:#1f2937;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);white-space:pre-wrap;transition:opacity .2s";
      document.body.appendChild(el);
    }
    el.textContent = String(text);
    el.style.opacity = "1";
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { el.style.opacity = "0"; }, 3200);
  }
  // The sandbox blocks pop-up dialogs, so alert() & co. would silently do nothing.
  window.alert = function (message) { notice(message == null ? "" : message); };
  window.confirm = function (message) { notice((message ? message + "\\n" : "") + "(The preview answers OK.)"); return true; };
  window.prompt = function (message, value) { notice((message ? message + "\\n" : "") + "(The preview uses the default answer.)"); return value == null ? "" : String(value); };
  // pushState/replaceState with a URL throw here (the page has no address of
  // its own): keep the state change, drop the address change.
  ["pushState", "replaceState"].forEach(function (name) {
    var original = history[name];
    history[name] = function (state, title) {
      try { return original.apply(history, arguments); }
      catch (e) { try { return original.call(history, state, title); } catch (_) {} }
    };
  });
  // The clipboard API is denied in the sandbox: fall back to the older copy
  // command, which works inside a click.
  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = String(text);
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;left:-9999px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    area.remove();
    return ok;
  }
  try {
    var clip = navigator.clipboard;
    var originalWrite = clip && clip.writeText ? clip.writeText.bind(clip) : null;
    var writeText = function (text) {
      var fallback = function () { return legacyCopy(text) ? Promise.resolve() : Promise.reject(new Error("Copy isn't available in the preview")); };
      return originalWrite ? originalWrite(text).catch(fallback) : fallback();
    };
    if (clip) Object.defineProperty(clip, "writeText", { value: writeText, configurable: true });
    else Object.defineProperty(navigator, "clipboard", { value: { writeText: writeText }, configurable: true });
  } catch (_) {}
  // A form submission would load a new document (the security policy's
  // form-action 'none' blocks it too). Captured first, so a page that stops
  // the event's propagation can't skip it; the page's own submit handlers
  // still run.
  window.addEventListener("submit", function (e) {
    if (!e.defaultPrevented) e.preventDefault();
  }, true);
  // form.submit() skips the submit event and would reload the page: make it
  // do nothing (requestSubmit() fires the event, so the guard above covers it).
  try { HTMLFormElement.prototype.submit = function () {}; } catch (_) {}
  var last = "";
  // A page built to fill the screen (height: 100vh / h-screen) is exactly as
  // tall as the frame, whatever the frame is, so its height says nothing about
  // the room it needs. Report "fill" instead and let the parent pick a height.
  function fillsViewport() {
    var vh = window.innerHeight;
    if (!vh || !document.body) return false;
    var root = document.getElementById("root");
    var el = (root && root.firstElementChild) || document.body.firstElementChild;
    if (!el) return false;
    var h = el.getBoundingClientRect().height;
    return Math.abs(h - vh) < 2 && document.documentElement.scrollHeight <= vh + 1;
  }
  // Content wider than the frame (fixed widths): report its width so the
  // parent can show the whole page scaled down instead of clipped.
  function overflowWidth() {
    var w = document.documentElement.scrollWidth;
    return w > window.innerWidth + 1 ? w : 0;
  }
  function size() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    var fill = fillsViewport();
    var wide = overflowWidth();
    var report = (fill ? "fill" : String(h)) + "|" + wide;
    if (report === last) return;
    last = report;
    if (wide) post("width", wide);
    if (fill) post("fill", true); else post("height", h);
  }
  window.addEventListener("load", function () {
    size(); post("ready");
    try { new ResizeObserver(size).observe(document.documentElement); } catch (e) { setInterval(size, 500); }
  });
})();`;
}

/**
 * Tailwind v3 Play CDN compatibility. Pages written for cdn.tailwindcss.com
 * (v3) configure it with `tailwind.config = {...}`; the preview runs Tailwind
 * v4's browser build instead (withLocalTailwind), which has no `tailwind`
 * global -- so that line threw "tailwind is not defined" and the page lost
 * its theme. This stands in for the v3 global: a config assigned to it (or
 * changed before the page has loaded) is translated into Tailwind v4 theme
 * variables in a <style type="text/tailwindcss">, which the v4 build reads.
 * Covers what pages configure: colors, fonts, font sizes and weights, radii,
 * shadows, spacing, breakpoints, max widths, letter spacing, line heights,
 * easings, animations with their keyframes, background images and
 * class-based dark mode. Plugins aren't available and are ignored.
 */
export function tailwindV3Shim(): string {
  return `(function () {
  if (window.tailwind) return;
  var THEME = {
    colors: "color", fontFamily: "font", fontSize: "text", fontWeight: "font-weight", borderRadius: "radius",
    boxShadow: "shadow", dropShadow: "drop-shadow", spacing: "spacing", screens: "breakpoint", maxWidth: "container",
    letterSpacing: "tracking", lineHeight: "leading", transitionTimingFunction: "ease", animation: "animate", blur: "blur"
  };
  function kebab(s) { return String(s).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\\s_.\\/]+/g, "-").toLowerCase(); }
  function fontList(v) {
    return (Array.isArray(v) ? v : [v]).map(function (f) {
      f = String(f);
      return /\\s/.test(f) && !/^["']/.test(f) && f.indexOf(",") < 0 && f.indexOf("var(") < 0 ? '"' + f + '"' : f;
    }).join(", ");
  }
  function declarations(obj) {
    var out = [];
    for (var k in obj) out.push(kebab(k) + ": " + obj[k] + ";");
    return out.join(" ");
  }
  function build(config) {
    var theme = (config && config.theme) || {};
    var extend = theme.extend || {};
    var vars = [], extra = [];
    function section(key, value) {
      if (!value || typeof value !== "object") return;
      var ns = THEME[key];
      if (key === "keyframes") {
        for (var name in value) {
          var frames = [];
          for (var step in value[name]) frames.push(step + " { " + declarations(value[name][step]) + " }");
          vars.push("@keyframes " + name + " { " + frames.join(" ") + " }");
        }
        return;
      }
      if (key === "backgroundImage") {
        for (var bg in value) extra.push("@utility bg-" + kebab(bg) + " { background-image: " + value[bg] + "; }");
        return;
      }
      if (!ns) return;
      (function walk(prefix, obj) {
        for (var k in obj) {
          var v = obj[k];
          var name = k === "DEFAULT" ? prefix : prefix + "-" + kebab(k);
          if (key === "fontFamily") { vars.push("--" + name + ": " + fontList(v) + ";"); continue; }
          if (key === "fontSize" && Array.isArray(v)) {
            vars.push("--" + name + ": " + v[0] + ";");
            var lh = v[1] && typeof v[1] === "object" ? v[1].lineHeight : v[1];
            if (lh) vars.push("--" + name + "--line-height: " + lh + ";");
            continue;
          }
          if (v && typeof v === "object" && !Array.isArray(v)) { walk(name, v); continue; }
          vars.push("--" + name + ": " + (Array.isArray(v) ? v.join(", ") : v) + ";");
        }
      })(ns, value);
    }
    var keys = {};
    for (var a in theme) if (a !== "extend") keys[a] = 1;
    for (var b in extend) keys[b] = 1;
    for (var key in keys) { section(key, theme[key]); section(key, extend[key]); }
    var dark = config && config.darkMode;
    if (dark === "class" || dark === "selector" || (Array.isArray(dark) && (dark[0] === "class" || dark[0] === "selector"))) {
      extra.push("@custom-variant dark (&:where(.dark, .dark *));");
    }
    return (vars.length ? "@theme {\\n" + vars.join("\\n") + "\\n}\\n" : "") + extra.join("\\n");
  }
  var current = {};
  function apply() {
    var css = "";
    try { css = build(current); } catch (e) { return; }
    var el = document.getElementById("__tailwind_v3_config");
    if (!el) {
      if (!css) return;
      el = document.createElement("style");
      el.id = "__tailwind_v3_config";
      el.setAttribute("type", "text/tailwindcss");
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }
  var api = {};
  Object.defineProperty(api, "config", {
    configurable: true,
    enumerable: true,
    get: function () { return current; },
    set: function (value) { current = value || {}; apply(); }
  });
  window.tailwind = api;
  // A config changed in place after it was set (tailwind.config.theme.x = ...).
  document.addEventListener("DOMContentLoaded", apply);
  window.addEventListener("load", apply);
})();`;
}

/**
 * The page's own address as the base for every relative URL. A srcdoc frame
 * otherwise resolves them against the app page around it, so "#/menu" or
 * location.href = "#/cart" would load the app inside the frame. It must come
 * before the security policy, whose base-uri 'none' blocks any later <base>
 * (including one in the page itself).
 */
export const PREVIEW_BASE = '<base href="about:srcdoc">';

/**
 * The preview sits on the chat like the rest of the answer (as in Claude): its
 * frame is transparent and follows the app's theme (the frame's color-scheme
 * is set from it, see components/shared/code-preview.tsx). The page starts as
 * "light dark", so one that leaves its background unset is transparent, with
 * default text in the theme's colour and prefers-color-scheme matching the app.
 * A page that paints its own background (a white page, a dark hero filling the
 * screen) is switched to that background's scheme once it has rendered, so its
 * default text stays readable on it in either app theme.
 */
function previewColorScheme(): string {
  return `(function () {
  function rgba(color) {
    var m = /rgba?\\(([^)]+)\\)/.exec(color || "");
    if (!m) return null;
    var p = m[1].split(",").map(function (v) { return parseFloat(v); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function pageBackground() {
    // The page itself, or a wrapper covering most of its width (e.g. React's root's first child).
    var candidates = [document.documentElement, document.body];
    var el = document.body;
    for (var depth = 0; el && depth < 3; depth++) {
      el = el.firstElementChild;
      if (el && el.getBoundingClientRect().width >= innerWidth * 0.8) candidates.push(el);
    }
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i] && rgba(getComputedStyle(candidates[i]).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return null;
  }
  function settle() {
    var bg = pageBackground();
    if (!bg) return;
    var light = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255 > 0.5;
    document.documentElement.style.colorScheme = light ? "light" : "dark";
  }
  document.addEventListener("DOMContentLoaded", settle);
  addEventListener("load", function () { settle(); setTimeout(settle, 300); });
})();`;
}

function head(channel: string, runtimeBase: string): string {
  return [
    PREVIEW_BASE,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<meta http-equiv="Content-Security-Policy" content="${policy(runtimeBase)}">`,
    `<script>${inlineScript(bridge(channel))}</script>`,
    `<script>${inlineScript(tailwindV3Shim())}</script>`,
    `<script>${inlineScript(previewColorScheme())}</script>`,
  ].join("\n");
}

/**
 * The Tailwind CDN script (Play CDN v3 or @tailwindcss/browser v4), which the
 * preview can't load, swapped for the app's own pinned copy -- so Tailwind
 * classes in an HTML page work offline, as they do in React previews.
 */
const TAILWIND_CDN_SCRIPT =
  /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/(?:cdn\.tailwindcss\.com[^"']*|[^"']*@tailwindcss\/browser[^"']*)["'][^>]*>\s*<\/script>/gi;

export function withLocalTailwind(code: string, runtimeBase: string): string {
  const local = `<script src="${runtimeBase.replace(/\/$/, "")}/${RUNTIME.tailwind}"></script>`;
  return code.replace(TAILWIND_CDN_SCRIPT, local);
}

/**
 * A meta refresh (a timed redirect or self-reload) loads another document and
 * can't be cancelled from inside the frame once it starts: drop it.
 */
const META_REFRESH = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh\b[^>]*>/gi;

export function withoutPageRedirects(code: string): string {
  return code.replace(META_REFRESH, "");
}

/** The sandboxed document for a model-written HTML page. */
export function buildHtmlPreview(code: string, channel: string, runtimeBase: string): string {
  const page = withoutPageRedirects(withLocalLibraries(withLocalTailwind(code, runtimeBase), runtimeBase));
  // Bare imports ("three", "gsap") resolve to the local copies -- unless the
  // page has an import map of its own, which withLocalLibraries completed.
  const importMap = IMPORT_MAP.test(page)
    ? ""
    : `\n<script type="importmap">${inlineScript(JSON.stringify({ imports: libraryImportMap(runtimeBase) }))}</script>`;
  const injected = head(channel, runtimeBase) + importMap;
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, (tag) => `${tag}\n${injected}`);
  if (/<html[^>]*>/i.test(page)) return page.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${injected}</head>`);
  return `<!doctype html><html><head>${injected}</head><body>${page}</body></html>`;
}

/** The sandboxed document for a compiled React component. */
export function buildReactPreview(
  compiled: string,
  channel: string,
  runtimeBase: string,
  libraries: string[] = [],
): string {
  const src = (file: string) => `${runtimeBase.replace(/\/$/, "")}/${file}`;
  // Each import the compile step allowed, mapped to the global its file sets.
  const globals: Record<string, string> = {};
  for (const name of [...compiled.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])) {
    const lib = reactLibrary(name);
    if (lib) globals[name] = lib.global;
  }
  const run = `(function () {
  var module = { exports: {} };
  var GLOBALS = ${JSON.stringify(globals)};
  function require(name) {
    var value = GLOBALS[name] && window[GLOBALS[name]];
    if (value) return value;
    throw new Error("The preview can't load '" + name + "'.");
  }
  function show(error) {
    var el = document.getElementById("root");
    el.innerHTML = "";
    var pre = document.createElement("pre");
    pre.style.cssText = "margin:16px;white-space:pre-wrap;color:#b42318;font:13px/1.5 ui-monospace,monospace";
    pre.textContent = String((error && error.message) || error);
    el.appendChild(pre);
  }
  try {
    (function (require, module, exports, React) {
${compiled}
;try { if (!module.exports.default && typeof App !== "undefined") module.exports.default = App; } catch (e) {}
    })(require, module, module.exports, React);
    var Component = module.exports.default || module.exports.App;
    if (typeof Component !== "function") throw new Error("Nothing to show: the code needs a component exported as default.");
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Component));
  } catch (error) {
    show(error);
    parent.postMessage({ channel: ${JSON.stringify(channel)}, type: "error", data: { message: String((error && error.message) || error) } }, "*");
  }
})();`;
  return `<!doctype html>
<html>
<head>
${head(channel, runtimeBase)}
<script src="${src(RUNTIME.react)}"></script>
<script src="${src(RUNTIME.reactDom)}"></script>
<script src="${src(RUNTIME.tailwind)}"></script>
${libraries.map((file) => `<script src="${src(`${LIB}/${file}`)}"></script>`).join("\n")}
<style>body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<script>${inlineScript(run)}</script>
</body>
</html>`;
}

/** A standalone file the user can download and open (the original page). */
export function downloadableHtml(code: string): Blob {
  return new Blob([code], { type: "text/html;charset=utf-8" });
}

/** How a preview frame is sized and scaled for the space it has. */
export interface FrameLayout {
  /** The frame's own size (what the page inside sees as its viewport). */
  frameWidth: number | null;
  frameHeight: number;
  /** Scale applied to the frame to fit the column (1 = none). */
  scale: number;
  /** Height the preview takes in the chat. */
  displayHeight: number;
}

export const PREVIEW_SIZES = {
  minHeight: 160,
  collapsedMaxHeight: 640,
  /** Height in the chat for a page built to fill the screen. */
  fillHeight: 600,
  /** A full-screen page is laid out at (up to) this desktop width... */
  desktopWidth: 1024,
  /** ...but never scaled below this, so text stays readable. */
  minScale: 0.6,
  /** Wider fixed-width content is capped here before scaling. */
  maxContentWidth: 1600,
} as const;

/**
 * Sizing for a preview frame.
 *
 * - A page that fills the screen (100vh / h-screen) gets a desktop-sized
 *   virtual viewport, scaled down to the column, so a layout designed for a
 *   laptop screen shows whole instead of cramped or clipped.
 * - Content wider than the column (fixed pixel widths) is laid out at its own
 *   width and scaled down to fit.
 * - Everything else is shown at its natural height (capped in the chat).
 *
 * Full screen (`fullscreenHeight` given): the preview gets that whole height
 * and the page scrolls inside it; the width rules above still apply, so only
 * pages wider than the screen are scaled.
 */
export function previewFrameLayout({
  columnWidth,
  height,
  fill,
  contentWidth,
  fullscreenHeight,
}: {
  columnWidth: number;
  height: number;
  fill: boolean;
  contentWidth: number;
  fullscreenHeight?: number;
}): FrameLayout {
  const s = PREVIEW_SIZES;
  const full = fullscreenHeight && fullscreenHeight > 0 ? fullscreenHeight : null;
  if (fill && columnWidth > 0) {
    const frameWidth = Math.max(columnWidth, Math.min(s.desktopWidth, columnWidth / s.minScale));
    const scale = columnWidth / frameWidth;
    const displayHeight = full ?? s.fillHeight;
    return { frameWidth, frameHeight: Math.round(displayHeight / scale), scale, displayHeight };
  }
  if (contentWidth > columnWidth && columnWidth > 0) {
    const frameWidth = Math.min(contentWidth, s.maxContentWidth);
    const scale = columnWidth / frameWidth;
    const displayHeight = full ?? Math.min(Math.round(height * scale), s.collapsedMaxHeight);
    return { frameWidth, frameHeight: Math.round(displayHeight / scale), scale, displayHeight };
  }
  const displayHeight = full ?? Math.min(height, s.collapsedMaxHeight);
  return { frameWidth: null, frameHeight: displayHeight, scale: 1, displayHeight };
}
