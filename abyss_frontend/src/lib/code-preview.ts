/**
 * Live previews of frontend code an agent writes (```html, or a React
 * component in ```jsx / ```tsx).
 *
 * Unlike ```trench-ui (lib/interactive.ts), where the model only supplies data
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
/** The only modules a React preview may import. */
const ALLOWED_IMPORTS = new Set(["react", "react-dom", "react-dom/client"]);
const RUNTIME = {
  react: "react-18.3.1.min.js",
  reactDom: "react-dom-18.3.1.min.js",
  tailwind: "tailwindcss-browser-4.3.5.js",
};

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml"]);
const REACT_LANGUAGES = new Set(["jsx", "tsx", "react"]);
const SCRIPT_LANGUAGES = new Set(["js", "javascript", "ts", "typescript"]);

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
    const imports = [...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    const unsupported = [...new Set(imports.filter((name) => !ALLOWED_IMPORTS.has(name)))];
    if (unsupported.length) {
      return {
        error: `The preview can only use React; this component also imports ${unsupported.join(", ")}.`,
      };
    }
    return { code };
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
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { window[name].getItem("__probe"); }
    catch (e) { try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (_) {} }
  });
  window.addEventListener("error", function (e) {
    post("error", { message: String(e.message || (e.error && e.error.message) || "Script error"), line: e.lineno || null });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; post("error", { message: "Unhandled promise rejection: " + String((r && r.message) || r) });
  });
  // No navigation away from the preview.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (a && (a.getAttribute("href") || "").charAt(0) !== "#") e.preventDefault();
  }, true);
  var last = 0;
  function size() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (h !== last) { last = h; post("height", h); }
  }
  window.addEventListener("load", function () {
    size(); post("ready");
    try { new ResizeObserver(size).observe(document.documentElement); } catch (e) { setInterval(size, 500); }
  });
})();`;
}

function head(channel: string, runtimeBase: string): string {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${policy(runtimeBase)}">`,
    `<script>${inlineScript(bridge(channel))}</script>`,
  ].join("\n");
}

/** The sandboxed document for a model-written HTML page. */
export function buildHtmlPreview(code: string, channel: string, runtimeBase: string): string {
  const injected = head(channel, runtimeBase);
  if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, (tag) => `${tag}\n${injected}`);
  if (/<html[^>]*>/i.test(code)) return code.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${injected}</head>`);
  return `<!doctype html><html><head>${injected}</head><body>${code}</body></html>`;
}

/** The sandboxed document for a compiled React component. */
export function buildReactPreview(compiled: string, channel: string, runtimeBase: string): string {
  const src = (file: string) => `${runtimeBase.replace(/\/$/, "")}/${file}`;
  const run = `(function () {
  var module = { exports: {} };
  function require(name) {
    if (name === "react") return React;
    if (name === "react-dom" || name === "react-dom/client") return ReactDOM;
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
