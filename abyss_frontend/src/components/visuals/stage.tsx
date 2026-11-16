"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Below this scale text gets too small to read: scroll sideways instead. */
const MIN_SCALE = 0.62;

/** Width of an element, tracked as it resizes (0 before the first measure). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Fits an SVG drawing laid out at its natural size into the column: scaled
 * down to the available width (never up), keeping its proportions; when
 * that would make text unreadably small, it stays at a readable scale and
 * scrolls sideways instead.
 */
export function SvgStage({
  width,
  height,
  label,
  children,
  className,
  defs,
}: {
  width: number;
  height: number;
  label: string;
  children: ReactNode;
  className?: string;
  defs?: ReactNode;
}) {
  const [ref, available] = useWidth<HTMLDivElement>();
  const fit = available ? Math.min(1, available / width) : 1;
  const scale = Math.max(MIN_SCALE, fit);
  // Scroll sideways only when the drawing is held at its smallest readable scale.
  const scrolls = fit < MIN_SCALE;
  return (
    <div ref={ref} className={cn("w-full overscroll-x-contain", scrolls ? "overflow-x-auto" : "overflow-hidden", className)}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width={Math.floor(width * scale)}
        height={Math.floor(height * scale)}
        className={cn("mx-auto block font-sans", !available && "invisible")}
      >
        {defs && <defs>{defs}</defs>}
        {children}
      </svg>
    </div>
  );
}

/** An arrowhead marker (use with a unique id per drawing). */
export function ArrowMarker({ id, className = "fill-muted-foreground" }: { id: string; className?: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" className={className} />
    </marker>
  );
}
