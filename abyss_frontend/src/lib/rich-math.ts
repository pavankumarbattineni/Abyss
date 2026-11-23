/**
 * Short text with inline math ($...$ or $$...$$) as safe HTML: the text is
 * escaped and the math rendered by KaTeX (with mhchem for \ce{...}). Used
 * where a whole Markdown renderer would be too much -- step-by-step visuals
 * and interactive-view cells and labels.
 */
import katex from "katex";
import "katex/contrib/mhchem";

// Same rule as answer prose (math-delimiters.ts): "$5 and $10" stays money.
const MATH = /(\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?![\d$]))/;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function tex(source: string, display = false): string {
  // KaTeX escapes everything it outputs; trust:false blocks \href and friends.
  return katex.renderToString(source, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
}

export function hasMath(text: string): boolean {
  return MATH.test(text);
}

export function richMathHtml(text: string): string {
  return text
    .split(new RegExp(MATH.source))
    .map((part, i) => {
      if (i % 2 === 0) return escape(part);
      return part.startsWith("$$") ? tex(part.slice(2, -2)) : tex(part.slice(1, -1));
    })
    .join("");
}
