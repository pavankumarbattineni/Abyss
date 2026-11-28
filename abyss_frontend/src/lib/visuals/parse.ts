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

/** Small models' usual JSON slips: a stray fence, trailing commas, smart quotes.
 * Valid JSON is taken as it is: the repairs run only if it doesn't parse, since
 * they would break text inside strings (`says “Actively hiring.”`, `"a, ]"`). */
function lenientJson(source: string): unknown {
  const unfenced = source
    .trim()
    .replace(/^```[\w-]*\s*/, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    // not valid as written: try the repairs below
  }
  const cleaned = unfenced.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // A small header object then a list -- {"format":"image"} followed by
    // search results -- is one visual: the list goes under "images".
    const split = /^(\{[^{}]*\})\s*(\[[\s\S]*\])$/.exec(cleaned);
    if (!split) throw err;
    return { ...JSON.parse(split[1]), images: JSON.parse(split[2]) };
  }
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

/** search_images results pasted as they came (an image object, or a list of
 * them, without "format") are an image visual: wrap them as one. */
function asBareImages(value: unknown): unknown {
  const isImage = (v: unknown) => !!v && typeof v === "object" && !("format" in v) && typeof (v as { src?: unknown }).src === "string";
  if (Array.isArray(value) && value.length > 0 && value.every(isImage)) return { format: "image", images: value };
  if (isImage(value)) return { format: "image", images: [value] };
  const v = value as Record<string, unknown> | null;
  if (v && v.format === "image" && !v.images && !v.src) {
    // The image list under another name ("items", "queries"...): whichever list holds images.
    const key = Object.keys(v).find((k) => Array.isArray(v[k]) && (v[k] as unknown[]).length > 0 && (v[k] as unknown[]).every(isImage));
    if (key) return { ...v, images: v[key] };
  }
  return value;
}

export function parseVisual(source: string): ParsedVisual {
  let value: unknown;
  try {
    value = asBareImages(lenientJson(source));
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
