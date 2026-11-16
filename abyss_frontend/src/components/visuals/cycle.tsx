"use client";

import { useId, useState } from "react";

import { wrapText } from "@/lib/visuals/geometry";
import type { CycleData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { iconFor } from "./icons";
import { ArrowMarker, SvgStage } from "./stage";

const SIZE = 460;
const C = SIZE / 2;
const RING = 158;
const NODE_R = 44;

/**
 * A loop: stages around a ring with arrows between them and the loop's name
 * in the centre. Selecting a stage (on the ring or in the list) highlights it.
 */
export function CycleVisual({ data }: { data: CycleData }) {
  const markerId = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const n = data.stages.length;
  const at = (i: number, r = RING) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle), angle };
  };
  // Arc from one node's edge to the next, along the ring.
  const gap = Math.asin(Math.min(0.95, (NODE_R + 8) / RING));
  const arc = (i: number) => {
    const a1 = -Math.PI / 2 + (i * 2 * Math.PI) / n + gap;
    const a2 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n - gap;
    const p1 = { x: C + RING * Math.cos(a1), y: C + RING * Math.sin(a1) };
    const p2 = { x: C + RING * Math.cos(a2), y: C + RING * Math.sin(a2) };
    return `M${p1.x},${p1.y} A${RING},${RING} 0 0 1 ${p2.x},${p2.y}`;
  };

  return (
    <div className="grid items-center gap-4 @container sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <SvgStage width={SIZE} height={SIZE} label={data.title ?? "Cycle"} defs={<ArrowMarker id={markerId} className="fill-primary" />}>
        <circle cx={C} cy={C} r={RING} className="fill-none stroke-primary/12" strokeWidth={26} />
        {data.stages.map((_, i) => (
          <path key={`a${i}`} d={arc(i)} className="fill-none stroke-primary" strokeWidth={2} markerEnd={`url(#${markerId})`} />
        ))}
        {data.center && (
          <g>
            <circle cx={C} cy={C} r={74} className="fill-primary/10" />
            {wrapText(data.center, 16, 3).map((line, i, lines) => (
              <text
                key={i}
                x={C}
                y={C + (i - (lines.length - 1) / 2) * 18}
                dy="0.35em"
                textAnchor="middle"
                fontSize={15}
                className="fill-foreground font-semibold"
              >
                {line}
              </text>
            ))}
          </g>
        )}
        {data.stages.map((stage, i) => {
          const p = at(i);
          const Icon = iconFor(stage.icon);
          const lines = wrapText(stage.label, 13, 2);
          const isActive = active === i;
          return (
            <g
              key={i}
              transform={`translate(${p.x},${p.y})`}
              className="cursor-pointer"
              onClick={() => setActive(isActive ? null : i)}
              role="button"
              aria-pressed={isActive}
              aria-label={stage.label}
            >
              <circle
                r={NODE_R}
                strokeWidth={2}
                className={cn("transition-colors", isActive ? "fill-primary stroke-primary" : "fill-card stroke-primary/70")}
              />
              <Icon x={-8} y={-NODE_R + 9} width={16} height={16} className={isActive ? "text-primary-foreground" : "text-sage-text"} />
              {lines.map((line, j) => (
                <text
                  key={j}
                  y={6 + (j - (lines.length - 1) / 2) * 13}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={11.5}
                  className={cn("font-semibold", isActive ? "fill-primary-foreground" : "fill-foreground")}
                >
                  {line}
                </text>
              ))}
              <g transform={`translate(${NODE_R * 0.72},${-NODE_R * 0.72})`}>
                <circle r={10} className="fill-highlight" />
                <text textAnchor="middle" dy="0.35em" fontSize={10} className="fill-white font-bold">
                  {i + 1}
                </text>
              </g>
            </g>
          );
        })}
      </SvgStage>
      <ol className="space-y-1.5">
        {data.stages.map((stage, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setActive(active === i ? null : i)}
              aria-pressed={active === i}
              className={cn(
                "flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                active === i ? "bg-primary/12" : "hover:bg-muted/60",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] leading-snug font-semibold text-foreground">{stage.label}</span>
                {stage.detail && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{stage.detail}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
