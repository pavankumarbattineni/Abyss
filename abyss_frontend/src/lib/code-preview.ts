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
  window.addEventListener("error", function (e) {
    post("error", { message: String(e.message || (e.error && e.error.message) || "Script error"), line: e.lineno || null });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; post("error", { message: "Unhandled promise rejection: " + String((r && r.message) || r) });
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
 * The page's own address as the base for every relative URL. A srcdoc frame
 * otherwise resolves them against the app page around it, so "#/menu" or
 * location.href = "#/cart" would load the app inside the frame. It must come
 * before the security policy, whose base-uri 'none' blocks any later <base>
 * (including one in the page itself).
 */
export const PREVIEW_BASE = '<base href="about:srcdoc">';

function head(channel: string, runtimeBase: string): string {
  return [
    PREVIEW_BASE,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${policy(runtimeBase)}">`,
    `<script>${inlineScript(bridge(channel))}</script>`,
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
  const injected = head(channel, runtimeBase);
  const page = withoutPageRedirects(withLocalTailwind(code, runtimeBase));
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, (tag) => `${tag}\n${injected}`);
  if (/<html[^>]*>/i.test(page)) return page.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>${injected}</head>`);
  return `<!doctype html><html><head>${injected}</head><body>${page}</body></html>`;
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
