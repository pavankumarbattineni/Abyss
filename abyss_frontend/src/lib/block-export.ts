/**
 * Export helpers for rich blocks in an answer (interactive views, visuals,
 * diagrams, tables): copy as image, download as PNG or as a file.
 *
 * Images are drawn from the block's own DOM (html-to-image), on the block's
 * real background colour so a dark-theme view doesn't come out transparent.
 * A live preview runs in a sandboxed cross-origin frame, so it can't be drawn
 * this way -- its menu offers the code and the HTML file instead.
 */
import { toBlob } from "html-to-image";

/** The first non-transparent background at or above `node`. */
function backgroundOf(node: HTMLElement): string {
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return getComputedStyle(document.body).backgroundColor || "#ffffff";
}

// What an SVG element's look depends on that comes from CSS classes and theme
// variables (fill-foreground, stroke-border, var(--background), font-medium...).
const SVG_PAINT = [
  "fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "color",
] as const;

/**
 * html-to-image copies HTML elements' computed styles but not SVG ones, and
 * the exported image has no stylesheet: SVG text would fall back to black and
 * theme-variable colours wouldn't resolve (dark labels on a dark background).
 * So each SVG element gets its on-screen values written on itself for the
 * export; the returned function puts the original style attributes back.
 */
export function inlineSvgPaint(node: HTMLElement): () => void {
  const saved: [Element, string | null][] = [];
  node.querySelectorAll<SVGElement>("svg, svg *").forEach((el) => {
    saved.push([el, el.getAttribute("style")]);
    const computed = getComputedStyle(el);
    for (const property of SVG_PAINT) {
      const value = computed.getPropertyValue(property);
      if (value) el.style.setProperty(property, value);
    }
  });
  return () => {
    for (const [el, style] of saved) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  };
}

export async function nodeToPng(node: HTMLElement): Promise<Blob> {
  const restore = inlineSvgPaint(node);
  try {
    const blob = await toBlob(node, {
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      backgroundColor: backgroundOf(node),
      // Controls marked data-export-skip (e.g. a table's sort arrows) stay out of the image.
      filter: (n) => !(n instanceof HTMLElement && n.dataset.exportSkip !== undefined),
    });
    if (!blob) throw new Error("The image couldn't be created.");
    return blob;
  } finally {
    restore();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Some browsers start the download asynchronously; keep the URL alive briefly.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copies `node` as a PNG. Where the browser can't put images on the
 * clipboard (no secure context, older browsers), the PNG is downloaded
 * instead, and the result says which happened.
 */
export async function copyNodeAsImage(node: HTMLElement, filename: string): Promise<"copied" | "downloaded"> {
  const png = nodeToPng(node);
  if (window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      // The promise goes into the ClipboardItem directly, so Safari still counts it as the click's action.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      return "copied";
    } catch {
      // Fall through to the download.
    }
  }
  downloadBlob(await png, filename);
  return "downloaded";
}

export async function downloadNodeAsPng(node: HTMLElement, filename: string) {
  downloadBlob(await nodeToPng(node), filename);
}

/** Tab-separated text as CSV (quoted where needed), for "Download as CSV". */
export function tsvToCsv(tsv: string): string {
  return tsv
    .split("\n")
    .map((row) =>
      row
        .split("\t")
        .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");
}
