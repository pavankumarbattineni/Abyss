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
const { answerParts, visibleSteps, backgroundActivity } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

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

// Background steps run but are never listed; while one runs, the chat only says
// what it's doing. A tool declares that itself (backend tool_display.py): its
// calls carry `background`, the status -- the chat knows no tool names.
const call = (id, toolName, status, at, background) => ({ kind: "tool_call", id, agent: "agent", toolName, status, at, background });
const turn = [
  step("a", 0),
  call("f", "any_format_tool", "succeeded", 0, "Preparing visuals…"),
  call("i", "any_image_tool", "succeeded", 9, "Finding images…"),
  call("p", "a_future_tool", "succeeded", 9, "Doing something…"),
];
const background = [
  ["background steps neither show nor split the text", () =>
    assert.equal(shape(answerParts(twoParts, visibleSteps(turn))), "S[a] T(Part one.\n\nPart two.)")],
  ["nothing running: no status", () => assert.equal(backgroundActivity(turn), null)],
  ["a running background step says its own status", () =>
    assert.equal(backgroundActivity([...turn, call("j", "any_image_tool", "running", 9, "Finding images…")]), "Finding images…")],
  ["a tool without the mark stays a listed step", () => {
    assert.equal(visibleSteps([call("x", "search_images", "running", 0)]).length, 1);
    assert.equal(backgroundActivity([call("x", "search_images", "running", 0)]), null);
  }],
];
for (const [name, check] of background) {
  try {
    check();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}
console.log(`answer layout check: all ${cases.length + background.length} cases pass`);
