# Live-preview runtime (vendored, pinned)

Loaded only inside the sandboxed preview frame (`src/lib/code-preview.ts`),
never by the app itself. Copied unmodified from the npm packages:

| File | Package | License |
|---|---|---|
| `react-18.3.1.min.js` | `react@18.3.1` (`umd/react.production.min.js`) | MIT |
| `react-dom-18.3.1.min.js` | `react-dom@18.3.1` (`umd/react-dom.production.min.js`) | MIT |
| `tailwindcss-browser-4.3.5.js` | `@tailwindcss/browser@4.3.5` (`dist/index.global.js`) | MIT |

React 18 is used because React 19 no longer ships browser (UMD) builds; it
runs only in the preview, separate from the app's own React.

## Libraries (`lib/`, generated)

`lib/` is built by `scripts/build-preview-runtime.mjs` (runs before `npm run
dev` and `npm run build`; git-ignored) from the exact devDependencies in
`package.json`: three (+ `examples/jsm` addons; the Draco/Basis decoders,
which need network, are left out), gsap (+ every plugin), chart.js, d3,
lucide, AOS, anime.js, Lenis and Swiper (with the AOS, Lenis and Swiper
stylesheets), and for React previews framer-motion and lucide-react bundled
against the preview's React 18. All MIT, except three.js and d3 (MIT/ISC)
and gsap (GreenSock standard license, free for all use since 3.13).

The preview has no network, so `src/lib/code-preview.ts` points a page's
CDN URLs (jsDelivr, unpkg, esm.sh, Skypack, JSPM, cdnjs) and bare imports
(through an import map) for these libraries at the local copies; anything
else stays blocked. `next.config.ts` serves this folder with
`Access-Control-Allow-Origin: *`, which module scripts need in the
opaque-origin frame.

Pages written for the Tailwind Play CDN v3 configure it with
`tailwind.config = {...}`. The preview runs Tailwind v4 (`tailwindcss-browser`),
which has no `tailwind` global, so `tailwindV3Shim()` in
`src/lib/code-preview.ts` provides one and turns that config into Tailwind v4
theme variables.
