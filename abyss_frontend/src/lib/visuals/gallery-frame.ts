/**
 * The shape (width / height) every card in an image gallery shares, from the
 * gallery's own images: their median shape, so a set of posters gets tall
 * cards (no empty bands at the sides), a set of landscapes wide ones, and a
 * mix something in between. Kept within sensible bounds so one extreme image
 * can't stretch the gallery; 4:3 until any image has loaded. Images are
 * always fitted whole inside the card (components/visuals/image.tsx) -- this
 * only decides how much empty band is left around them.
 */
export const DEFAULT_FRAME = 4 / 3;
export const MIN_FRAME = 3 / 4;
export const MAX_FRAME = 16 / 9;

export function galleryFrame(shapes: number[]): number {
  const known = shapes.filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => a - b);
  if (known.length === 0) return DEFAULT_FRAME;
  const mid = Math.floor(known.length / 2);
  const median = known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  return Math.min(MAX_FRAME, Math.max(MIN_FRAME, median));
}
