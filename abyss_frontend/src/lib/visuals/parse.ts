/**
 * Turning a ```visual block's source into validated data for its renderer.
 */
import { VISUAL_SCHEMAS, type VisualData, type VisualFormatName } from "./schemas";

export const VISUAL_LANGUAGE = "visual";

export type ParsedVisual =
  | { ok: true; format: VisualFormatName; data: VisualData }
  | { ok: false; format: VisualFormatName | null; errors: string[] };

export function isVisualFormat(name: unknown): name is VisualFormatName {
  return typeof name === "string" && Object.hasOwn(VISUAL_SCHEMAS, name);
}

/** The format named in a (possibly still streaming) source, for the placeholder. */
export function sniffFormat(source: string): VisualFormatName | null {
  const match = /"format"\s*:\s*"([a-z-]+)"/.exec(source);
  return match && isVisualFormat(match[1]) ? match[1] : null;
}

/** Small models' usual JSON slips: a stray fence, trailing commas, smart quotes. */
function lenientJson(source: string): unknown {
  const cleaned = source
    .trim()
    .replace(/^```[\w-]*\s*/, "")
    .replace(/```\s*$/, "")
    .replace(/[“”]/g, '"')
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(cleaned);
}

/** True for a ```json block that is really a visual (the model used the wrong fence). */
export function looksLikeVisualJson(source: string): boolean {
  const format = sniffFormat(source);
  if (!format) return false;
  try {
    const value = lenientJson(source) as { format?: unknown } | null;
    return isVisualFormat(value?.format);
  } catch {
    return false;
  }
}

export function parseVisual(source: string): ParsedVisual {
  let value: unknown;
  try {
    value = lenientJson(source);
  } catch (err) {
    return { ok: false, format: sniffFormat(source), errors: [`The visual isn't valid JSON: ${(err as Error).message}`] };
  }
  const format = (value as { format?: unknown } | null)?.format;
  if (!isVisualFormat(format)) {
    return {
      ok: false,
      format: null,
      errors: [`Unknown visual format ${JSON.stringify(format ?? null)}. Use one of: ${Object.keys(VISUAL_SCHEMAS).join(", ")}.`],
    };
  }
  const result = VISUAL_SCHEMAS[format].safeParse(value);
  if (result.success) return { ok: true, format, data: result.data as VisualData };
  const errors = result.error.issues.slice(0, 4).map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "the visual";
    return `${where}: ${issue.message}`;
  });
  return { ok: false, format, errors };
}
