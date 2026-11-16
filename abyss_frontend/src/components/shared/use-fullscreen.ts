"use client";

import { useEffect, useState } from "react";

/**
 * Full screen for a block that must keep its live state (a running preview,
 * calculator inputs): instead of re-rendering into a dialog, the block's own
 * container switches to `FULLSCREEN_CLASS`. While open, Escape closes it and
 * the page behind doesn't scroll.
 */
export const FULLSCREEN_CLASS = "fixed inset-0 z-50 flex h-dvh flex-col bg-card";

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);
  return [fullscreen, setFullscreen] as const;
}
