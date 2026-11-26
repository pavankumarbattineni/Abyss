/**
 * Models often write LaTeX delimited the standard way
 * -- `\( ... \)` inline and `\[ ... \]` for display equations -- but
 * Markdown treats `\(`/`\[` as escaped punctuation (so the raw LaTeX leaks
 * into the page as text) and remark-math only recognizes `$` delimiters.
 * This rewrites the LaTeX delimiters into remark-math's `$$` form before the
 * Markdown is parsed:
 *
 * - `\[ ... \]` at the start of a line -> a display block (`$$` fences on
 *   their own lines), keeping the line's indentation so equations inside
 *   list items stay inside them.
 * - `\[ ... \]` mid-line, and `\( ... \)` -> inline math (`$$...$$`; with
 *   remark-math's singleDollarTextMath disabled, double dollars mark inline
 *   math and a lone "$5" in prose is never mistaken for math).
 *
 * - A `$$ ... $$` formula spanning lines -> a display block with its `$$`
 *   fences on lines of their own (fenceMultilineMath).
 *
 * Code (fenced blocks and inline code) is never touched. Unclosed
 * delimiters -- e.g. mid-stream, before `\]` has arrived -- are left as-is
 * until they close.
 */

// Fenced (``` / ~~~, including one still open mid-stream) and inline code.
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

// A "math" span holding nothing but citation markers -- e.g. `\([1]\)` or
// `\([2][3]\)`, which models produce once asked for LaTeX. That's never real
// math; unwrap it so it renders as a clickable citation, not math text.
const CITATION_ONLY_MATH = /\\[([]\s*((?:\[\d+\]\s*,?\s*)+?)\s*\\[)\]]/g;

/** Escapes `#` and `%` the model left bare inside math -- e.g.
 * `\text{#states}` or `50%`. In LaTeX `#` is reserved (KaTeX refuses to
 * render the whole equation) and `%` starts a comment that silently drops
 * the rest of it. Neither has a legitimate unescaped use in an answer. */
function escapeSpecials(body: string): string {
  return body.replace(/(?<!\\)([#%])/g, "\\$1");
}

function convertMath(text: string): string {
  return (
    text
      .replace(CITATION_ONLY_MATH, (_match, citations: string) =>
        citations.replace(/\s*,?\s*/g, "")
      )
      // Display equations that start a line: \[ ... \] -> $$ block. The
      // closing $$ must end its line (remark-math only closes a block on a
      // bare $$ line), so anything after \] -- typically citations like
      // "\] [1][8]" -- moves to its own following line; otherwise the block
      // never closes and swallows the rest of the answer.
      .replace(
        /^([ \t]*)\\\[([\s\S]+?)\\\][ \t]*(.*)$/gm,
        (_match, indent: string, body: string, rest: string) => {
          const lines = escapeSpecials(body.trim())
            .split("\n")
            .map((line) => `${indent}${line.trim()}`);
          const block = `${indent}$$\n${lines.join("\n")}\n${indent}$$`;
          return rest ? `${block}\n${indent}${rest}` : block;
        }
      )
      // Remaining \[ ... \] (mid-line) and all \( ... \) -> inline math.
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `$$${escapeSpecials(body.trim())}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$$${escapeSpecials(body.trim())}$$`)
      // Single-dollar inline math ($x^2$, $\lambda$), which models write most.
      .split(DOUBLE_DOLLAR_MATH)
      .map((part, i) => (i % 2 === 1 ? part : part.replace(SINGLE_DOLLAR_MATH, (_m, body: string) => `$$${escapeSpecials(body)}$$`)))
      .join("")
  );
}

// Math already in remark-math's $$ form (inline or a block): left alone.
const DOUBLE_DOLLAR_MATH = /(\$\$[\s\S]*?\$\$)/;

// A list item's marker ("- ", "* ", "1. "): a block under it is indented past it.
const LIST_MARKER = /^([ \t]*)([-*+]|\d+[.)])[ \t]+/;
// A blockquote's markers ("> ", "> > "): every line of a block inside it repeats them.
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)+/;
// Only punctuation after a display equation ("$$." "$$,"): it goes inside, as in LaTeX.
const TRAILING_PUNCTUATION = /^[.,;:!?]+$/;

/** The prefix that keeps a block on its own lines inside whatever `lead` (the
 * text before it on its line) opens: quote markers, then a list item's
 * indentation past its marker (or the line's own indentation). */
function blockPrefix(lead: string): string {
  const quote = lead.match(QUOTE_PREFIX)?.[0] ?? "";
  const rest = lead.slice(quote.length);
  const marker = rest.match(LIST_MARKER);
  const indent = marker ? marker[1] + " ".repeat(marker[0].length - marker[1].length) : (rest.match(/^[ \t]*/)?.[0] ?? "");
  return quote + indent;
}

/**
 * A `$$ ... $$` formula that spans lines is a display equation, but
 * remark-math only reads one as a block when each `$$` stands on a line of
 * its own: text after an opening `$$` is taken as the block's label (and
 * dropped), and a closing `$$` after text never closes it -- so the block
 * swallows the rest of the answer, which KaTeX then shows as one red error.
 * Models often write `$$R = \begin{pmatrix}` ... `\end{pmatrix}$$`. Each such
 * formula gets its `$$` fences on lines of their own, kept inside its list
 * item or blockquote (blockPrefix); text before it on the same line stays
 * prose on its own line, as does text after it -- except bare punctuation
 * ("$$."), which goes inside the equation, as LaTeX writes it. One-line
 * formulas, and blocks already fenced this way, come out unchanged; an
 * unclosed `$$` (mid-stream) is left until it closes.
 */
function fenceMultilineMath(text: string): string {
  const parts = text.split(DOUBLE_DOLLAR_MATH);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i].slice(2, -2);
    if (!body.includes("\n")) continue;
    // The text on the formula's opening line, before its $$ (from the line's
    // real start: earlier math on the same line is part of it).
    const head = parts.slice(0, i).join("");
    const lead = head.slice(head.lastIndexOf("\n") + 1);
    const prefix = blockPrefix(lead);
    const quoted = QUOTE_PREFIX.test(lead);
    // Kept on its own line unless it is only indentation or quote markers (a
    // bare list marker stays: the formula is that item's content). Such a lead
    // holds no math, so it lies wholly in the text just before.
    parts[i - 1] = lead.replace(QUOTE_PREFIX, "").trim()
      ? `${parts[i - 1].replace(/[ \t]+$/, "")}\n`
      : parts[i - 1].slice(0, parts[i - 1].length - lead.length);
    // Its lines, without the quote markers the model repeated on them.
    const lines = body.split("\n").map((line) => (quoted ? line.replace(QUOTE_PREFIX, "") : line).trim());
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    // The text on its closing line, after its $$.
    const after = parts[i + 1] ?? "";
    const lineEnd = after.indexOf("\n");
    const tail = (lineEnd < 0 ? after : after.slice(0, lineEnd)).trim();
    let rest = after.slice(lineEnd < 0 ? after.length : lineEnd);
    if (TRAILING_PUNCTUATION.test(tail) && lines.length) lines[lines.length - 1] += tail;
    else if (tail) rest = `\n${prefix}${tail}${rest}`;
    parts[i] = `${prefix}$$\n${lines.map((line) => (line ? prefix + line : prefix.trimEnd())).join("\n")}\n${prefix}$$`;
    parts[i + 1] = rest;
  }
  return parts.join("");
}

/**
 * `$...$` inline math, by Pandoc's rule so prices stay prose: the opening `$`
 * is followed by a non-space and isn't escaped (`\$`) or part of `$$`; the
 * closing `$` follows a non-space and isn't followed by a digit. So `$x^2$`
 * and `$\lambda$` are math, while "costs $5 and $10" or "$5-$10" are not.
 * One line at most.
 */
const SINGLE_DOLLAR_MATH = /(?<![\\$\w])\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?![\d$])/g;

export function normalizeMathDelimiters(content: string): string {
  if (!content.includes("\\(") && !content.includes("\\[") && !content.includes("$")) return content;
  // split() with a capture group puts code segments at the odd indices.
  return content
    .split(CODE_SEGMENT)
    .map((segment, i) => (i % 2 === 1 ? segment : fixMathSlips(fenceMultilineMath(convertMath(segment)))))
    .join("");
}

/** Slips inside math that KaTeX rejects: a doubled superscript ("Li^^{+}"). */
function fixMathSlips(text: string): string {
  return wrapLongInlineMath(text.replace(/\$\$[\s\S]+?\$\$/g, (math) => math.replace(/\^\s*\^/g, "^")));
}

/** Longer inline formulas than this get break points at their top-level commas. */
const WRAP_AFTER = 40;

/** `tex` cut after each comma outside brackets/braces (a list of items), or null. */
function splitAtTopLevelCommas(tex: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      // \{ \} (a set's braces) and \langle \rangle bracket like ( ); any other
      // command or escaped character (\, \; \alpha) neither brackets nor splits.
      if (tex[i + 1] === "{" || tex.startsWith("langle", i + 1)) depth++;
      else if (tex[i + 1] === "}" || tex.startsWith("rangle", i + 1)) depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(tex.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  if (!parts.length || depth !== 0) return null;
  parts.push(tex.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * KaTeX can't wrap an inline formula at a comma, so a long list such as
 * "(A,B,4), (A,C,2), ..." would run off the screen as one unbreakable line.
 * A long inline formula is split at its top-level commas into several
 * formulas joined by an ordinary space, where the line can wrap. It looks the
 * same. Display equations (their $$ on their own lines) are left as they are.
 */
function wrapLongInlineMath(text: string): string {
  return text.replace(/\$\$([^\n$]+?)\$\$/g, (whole, tex: string) => {
    if (tex.length <= WRAP_AFTER) return whole;
    const parts = splitAtTopLevelCommas(tex);
    return parts && parts.length > 1 ? parts.map((p) => `$$${p}$$`).join(" ") : whole;
  });
}
