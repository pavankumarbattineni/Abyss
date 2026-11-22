/**
 * Guards how an answer is laid out (src/lib/reasoning.ts answerParts): the
 * chat shows a turn in the order it happened -- each step (thinking, a tool,
 * a specialist) between the text written before and after it, using the
 * position (`at`) every step records. Runs before every build; a change that
 * reorders or merges steps fails the build instead of confusing the chat.
 * Run on its own: node scripts/check-answer-parts.mjs
 */
import { build } from "esbuild";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
  entryPoints: [join(root, "src/lib/reasoning.ts")],
  bundle: true,
  format: "esm",
  write: false,
  platform: "node",
  logLevel: "silent",
});
const { answerParts } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

const step = (id, at) => ({ kind: "tool_call", id, agent: "agent", toolName: "search", status: "succeeded", at });
const shape = (parts) =>
  parts.map((p) => (p.kind === "text" ? `T(${p.text.trim()})` : `S[${p.items.map((i) => i.id).join(",")}]`)).join(" ");
const twoParts = "Part one.\n\nPart two.";

const cases = [
  ["an old message (no positions): steps, then the text, as before", "Answer.", [step("a"), step("b")], "S[a,b] T(Answer.)"],
  ["research first, then one answer", "Answer.", [step("a", 0), step("b", 0)], "S[a,b] T(Answer.)"],
  ["an answer between steps keeps their order", twoParts, [step("a", 0), step("b", 9)], "S[a] T(Part one.) S[b] T(Part two.)"],
  ["only a blank line between steps doesn't split them", "Hi.\n\nMore.", [step("a", 3), step("b", 5)], "T(Hi.) S[a,b] T(More.)"],
  ["a position past the text (taken back by a rewind) stays last", "Short.", [step("a", 0), step("b", 40)], "S[a] T(Short.) S[b]"],
  ["live: a step started before any text", "", [step("a", 0)], "S[a]"],
  ["a step without a position stays with the one before it", twoParts, [step("a", 0), step("b", 9), step("c")], "S[a] T(Part one.) S[b,c] T(Part two.)"],
  // A cut-off reply's continuation once saved its thought mid-block: the block must stay whole.
  ["a step inside a code block waits until the block closes", "Hi.\n```visual\n{\n}\n```\nAfter.", [step("a", 0), step("b", 14)], "S[a] T(Hi.\n```visual\n{\n}\n```) S[b] T(After.)"],
  ["a step inside a block left open goes after it", "```js\nx", [step("a", 7)], "T(```js\nx) S[a]"],
];
for (const [name, content, steps, expected] of cases) {
  assert.equal(shape(answerParts(content, steps)), expected, name);
}
console.log(`answer layout check: all ${cases.length} cases pass`);
