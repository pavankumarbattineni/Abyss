import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches; false during server rendering. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md` breakpoint: the sidebar becomes a slide-in menu. */
export const MOBILE_QUERY = "(max-width: 767px)";

/** Below Tailwind's `lg` breakpoint: phones and tablets. Side panels (the
 * thread list) open over the content instead of squeezing it next to the
 * main sidebar. */
export const COMPACT_QUERY = "(max-width: 1023px)";
