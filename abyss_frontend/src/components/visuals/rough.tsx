"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";

import { cn } from "@/lib/utils";

/**
 * Hand-drawn strokes for the handwritten and sketchnote formats (rough.js).
 * Every shape gets a fixed seed from its key, so a sketch looks the same on
 * every render instead of jittering.
 */
const generator = rough.generator();

function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return Math.abs(h % 2_000_000) + 1;
}

type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "path"; d: string };

/** SVG paths for one rough shape. */
export function RoughShape({
  shape,
  seed,
  stroke = "currentColor",
  fill,
  strokeWidth = 1.4,
  roughness = 1.3,
}: {
  shape: Shape;
  seed: string;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  roughness?: number;
}) {
  const paths = useMemo(() => {
    const options: Options = {
      seed: seedOf(seed),
      stroke,
      strokeWidth,
      roughness,
      bowing: 1.2,
      ...(fill ? { fill, fillStyle: "hachure", hachureGap: 7, fillWeight: 0.8 } : {}),
    };
    const drawable =
      shape.kind === "rect"
        ? generator.rectangle(shape.x, shape.y, shape.w, shape.h, options)
        : shape.kind === "ellipse"
          ? generator.ellipse(shape.x, shape.y, shape.w, shape.h, options)
          : shape.kind === "line"
            ? generator.line(shape.x1, shape.y1, shape.x2, shape.y2, options)
            : generator.path(shape.d, options);
    return generator.toPaths(drawable);
  }, [shape, seed, stroke, fill, strokeWidth, roughness]);
  return (
    <>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? "none"} />
      ))}
    </>
  );
}

/**
 * An HTML box with a hand-drawn border (and optional hachure fill) that
 * follows the box's size as it reflows.
 */
export function RoughBox({
  seed,
  children,
  className,
  stroke = "currentColor",
  fill,
  shape = "rect",
}: {
  seed: string;
  children: ReactNode;
  className?: string;
  stroke?: string;
  fill?: string;
  shape?: "rect" | "ellipse";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The whole box (padding included), so the border goes around it.
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) =>
        prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const roughShape = useMemo<Shape | null>(() => {
    if (!size) return null;
    return shape === "ellipse"
      ? { kind: "ellipse", x: size.w / 2, y: size.h / 2, w: size.w - 4, h: size.h - 4 }
      : { kind: "rect", x: 3, y: 3, w: size.w - 6, h: size.h - 6 };
  }, [size, shape]);
  return (
    <div ref={ref} className={cn("relative", className)}>
      {size && roughShape && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={size.w}
          height={size.h}
        >
          <RoughShape shape={roughShape} seed={seed} stroke={stroke} fill={fill} />
        </svg>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

/** A hand-drawn underline that spans its container. */
export function RoughUnderline({ seed, className, stroke = "currentColor" }: { seed: string; className?: string; stroke?: string }) {
  return (
    <svg aria-hidden="true" className={cn("block h-2 w-full overflow-visible", className)} viewBox="0 0 100 8" preserveAspectRatio="none">
      <RoughShape shape={{ kind: "path", d: "M2 5 Q 50 1 98 4" }} seed={seed} stroke={stroke} strokeWidth={1.6} roughness={0.8} />
    </svg>
  );
}
