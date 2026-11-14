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
