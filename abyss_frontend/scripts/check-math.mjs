/**
 * Guards how answer math is recognised (src/lib/math-delimiters.ts): every way
 * models write math -- $...$, $$...$$, \(...\), \[...\] -- must render, while
 * money in prose ("$5 and $10") and code stay as written. Runs before every
 * build. Run on its own: node scripts/check-math.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src/lib/math-delimiters.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  logLevel: "silent",
});
const { normalizeMathDelimiters: norm } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

const cases = [
  // A long inline list wraps at its top-level commas; short math and bracketed lists stay whole.
  ["long inline list wraps", "Edges: $(A, B, 4), (A, C, 2), (B, C, 1), (B, D, 5)$ here", "Edges: $$(A, B, 4),$$ $$(A, C, 2),$$ $$(B, C, 1),$$ $$(B, D, 5)$$ here"],
  ["short inline math stays whole", "Point $(a, b)$ here", "Point $$(a, b)$$ here"],
  ["commas inside braces never split", "Set $\\{a_1, a_2, a_3, a_4, a_5, a_6, a_7, a_8, a_9, a_{10}\\}$ end", "Set $$\\{a_1, a_2, a_3, a_4, a_5, a_6, a_7, a_8, a_9, a_{10}\\}$$ end"],
  ["doubled superscript slip", "Ions: $\\text{Li}^^{+}$ move", "Ions: $$\\text{Li}^{+}$$ move"],
  // Single-dollar inline math, as models write it most.
  ["inline $...$", "The slope is $m = \\frac{dy}{dx}$ here.", "The slope is $$m = \\frac{dy}{dx}$$ here."],
  ["one-letter variables", "Let $A$ act on $\\mathbf{v}$.", "Let $$A$$ act on $$\\mathbf{v}$$."],
  ["chemistry with text", "$\\text{Li}^+$ ions move", "$$\\text{Li}^+$$ ions move"],
  ["math next to punctuation", "speed ($v$), mass ($m$).", "speed ($$v$$), mass ($$m$$)."],
  // Money stays prose.
  ["two prices", "It costs $5 and $10.", "It costs $5 and $10."],
  ["a price range", "Plans cost $5-$10 a month.", "Plans cost $5-$10 a month."],
  ["prices with units", "$20/month vs $30/month", "$20/month vs $30/month"],
  ["a single price", "Only $5.", "Only $5."],
  ["an escaped dollar", "Pay \\$5 or \\$10", "Pay \\$5 or \\$10"],
  // Already-valid forms are untouched; LaTeX delimiters convert as before.
  ["$$ inline", "so $$E = mc^2$$ holds", "so $$E = mc^2$$ holds"],
  ["$$ block", "$$\nx^2\n$$", "$$\nx^2\n$$"],
  ["\\( \\)", "the value \\(x^2\\) is", "the value $$x^2$$ is"],
  // Code is never touched.
  ["inline code", "run `echo $HOME and $PATH`", "run `echo $HOME and $PATH`"],
  ["code block", "```bash\necho $a $b\n```", "```bash\necho $a $b\n```"],
  // Unescaped % inside math is escaped (it would start a LaTeX comment).
  ["percent in math", "$50%$ of it", "$$50\\%$$ of it"],
];
for (const [name, input, expected] of cases) {
  assert.equal(norm(input), expected, name);
}
console.log(`math check: all ${cases.length} cases pass`);
