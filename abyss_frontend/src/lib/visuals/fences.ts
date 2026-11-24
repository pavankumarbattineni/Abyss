/**
 * Models sometimes write a visual's JSON on the fence line itself
 * ("```visual {...}", even with the closing fence on the same line). Markdown
 * reads that JSON as the fence's label and the block comes out empty, so the
 * JSON is moved onto its own line. The backend saves answers fixed the same
 * way (abyss_agents/visual_check.py fence_fixes); this covers older answers
 * and the live stream.
 */
import { INTERACTIVE_LANGUAGES } from "@/lib/interactive";

const TAGS = ["visual", ...INTERACTIVE_LANGUAGES].join("|");
const ONE_LINE = new RegExp(`^([ \\t]*)\`\`\`(${TAGS})[ \\t]+([{[].*?)[ \\t]*\`\`\`[ \\t]*$`, "gm");
const OPENING = new RegExp(`^([ \\t]*)\`\`\`(${TAGS})[ \\t]+([{[].*)$`, "gm");

export function splitInlineFenceJson(content: string): string {
  if (!content.includes("```")) return content;
  return content
    .replace(ONE_LINE, (_m, indent: string, lang: string, json: string) => `${indent}\`\`\`${lang}\n${json}\n${indent}\`\`\``)
    .replace(OPENING, (_m, indent: string, lang: string, rest: string) => `${indent}\`\`\`${lang}\n${rest}`);
}
