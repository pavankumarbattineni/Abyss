"use client";

import { useEffect, useRef } from "react";

/**
 * The homepage's descent: the Abyss mark drawn large -- rings receding into
 * depth, a dark core, and the Tomato spark at the bottom (see AbyssMark).
 *
 * Its motion tells the mark's story (styles: globals.css, "Home motion"):
 * on load the rings draw themselves from the rim down into the well, the
 * core settles and the spark rises into place; after that the spark stays
 * live with a faint ripple. With a mouse the rings shift with the pointer,
 * near ones more than deep ones, so the well has real depth. Reduced motion:
 * the finished mark, still.
 */
const RINGS = [
  { r: 150, cy: 160 },
  { r: 118, cy: 180 },
  { r: 88, cy: 198 },
  { r: 60, cy: 214 },
  { r: 35, cy: 227 },
];
/** How far (in viewBox units) each ring follows the pointer: the rim most. */
const DEPTH_SHIFT = [9, 7, 5, 3.5, 2];
const SPARK_SHIFT = 1.5;

export function DescentArt() {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    const parallax = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!svg || !parallax.matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = svg.getBoundingClientRect();
        // -1..1 from the art's centre, measured across the window so it moves
        // gently wherever the pointer is.
        const x = (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2);
        const y = (event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2);
        svg.style.setProperty("--depth-x", Math.max(-1, Math.min(1, x)).toFixed(3));
        svg.style.setProperty("--depth-y", Math.max(-1, Math.min(1, y)).toFixed(3));
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <svg
      ref={ref}
      viewBox="0 0 320 320"
      className="descent w-full max-w-[13rem] overflow-visible sm:max-w-[18rem] md:max-w-[22rem]"
      aria-hidden="true"
    >
      {RINGS.map((ring, index) => {
        const core = index === RINGS.length - 1;
        return (
          <g
            key={ring.r}
            className="descent-layer"
            style={{ "--shift": DEPTH_SHIFT[index], "--i": index } as React.CSSProperties}
          >
            <circle
              className={core ? "descent-core" : "descent-ring"}
              cx="160"
              cy={ring.cy}
              r={ring.r}
              pathLength={1}
              fill={core ? "var(--foreground)" : "none"}
              stroke="var(--sage-text)"
              strokeWidth={index === 0 ? 3 : 1.5}
              strokeOpacity={1 - index * 0.12}
            />
          </g>
        );
      })}
      <g className="descent-layer" style={{ "--shift": SPARK_SHIFT } as React.CSSProperties}>
        <circle className="descent-ripple" cx="160" cy="236" r="9" fill="none" stroke="var(--highlight)" strokeWidth="1.5" />
        <circle className="descent-spark" cx="160" cy="236" r="9" fill="var(--highlight)" />
      </g>
    </svg>
  );
}
