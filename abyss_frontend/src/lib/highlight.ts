/**
 * Syntax highlighting for code blocks (components/shared/code-block.tsx).
 *
 * highlight.js "common" bundle: ~36 languages (JS/TS/JSX/TSX, Python, Java,
 * C/C++/C#, Go, Rust, Kotlin, Swift, PHP, Ruby, SQL, shell, HTML/XML, CSS,
 * JSON, YAML, Markdown, diff, …) and their usual aliases (py, sh, yml, rs…).
 * Its output is the code itself, HTML-escaped, wrapped in <span class="hljs-…">
 * tokens -- nothing in it is executed. Colours: the --code-* tokens in
 * app/globals.css (light and dark).
 */
import hljs from "highlight.js/lib/common";

/** Fence names highlight.js doesn't know by itself. */
const ALIASES: Record<string, string> = {
  "trench-ui": "json",
  jsonc: "json",
  json5: "json",
  zsh: "bash",
  console: "bash",
  terminal: "bash",
  ps1: "powershell",
  svg: "xml",
  vue: "xml",
  mermaid: "plaintext",
  text: "plaintext",
  txt: "plaintext",
};

/** Bigger blocks are shown plain: highlighting them would slow the page. */
const MAX_HIGHLIGHT_CHARS = 100_000;
/** Language guessing (no fence language) only on modest blocks… */
const MAX_AUTODETECT_CHARS = 20_000;
/** …and only when highlight.js is reasonably sure. */
const MIN_AUTODETECT_RELEVANCE = 6;

/** Highlighted HTML for a code block, or null to show it as plain text. */
export function highlightCode(code: string, language: string): string | null {
  if (!code || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const requested = (language || "").trim().toLowerCase();
  const lang = ALIASES[requested] ?? requested;
  try {
    if (lang === "plaintext") return null;
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    if (!lang && code.length <= MAX_AUTODETECT_CHARS) {
      const guess = hljs.highlightAuto(code);
      return guess.relevance >= MIN_AUTODETECT_RELEVANCE ? guess.value : null;
    }
  } catch {
    // Never let highlighting break an answer: fall back to plain text.
  }
  return null;
}
