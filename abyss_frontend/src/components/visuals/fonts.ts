import { Caveat } from "next/font/google";

/**
 * Handwriting for the handwritten and sketchnote formats. Self-hosted by
 * next/font at build time (no request to Google at runtime) and not
 * preloaded: it only downloads when one of those visuals is on screen.
 */
export const handwriting = Caveat({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});
