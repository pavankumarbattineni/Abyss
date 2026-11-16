import type { SketchnotesData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { handwriting } from "./fonts";
import { iconFor } from "./icons";
import { RoughBox, RoughShape } from "./rough";

/** Marker colours, one per cluster in turn. */
const INKS = ["#2f7a5b", "#d1462f", "#2563a8", "#b7791f", "#7c4dbe", "#0f766e"];

/**
 * Visual notes: the central idea on a hand-drawn banner, the clusters around
 * it as sketched cards, each with a doodled icon and arrow bullets. Laid out
 * as a grid so it reflows from one column on phones to three on wide screens.
 */
export function SketchnotesVisual({ data }: { data: SketchnotesData }) {
  return (
    <div
      className={cn(
        handwriting.className,
        "@container rounded-lg border border-[#e7dcc4] bg-[#fffdf5] p-4 text-[20px] leading-snug text-[#2b2d42] dark:border-[#3a372f] dark:bg-[#262520] dark:text-[#e9e4d6] sm:p-5",
      )}
    >
      <div className="mb-5 flex justify-center">
        <RoughBox seed={`c-${data.center}`} fill="rgba(253, 224, 71, 0.55)" stroke="#2b2d42" className="px-6 py-2 dark:text-[#2b2d42]">
          <p className="text-center text-[30px] font-bold text-[#2b2d42]">{data.center}</p>
        </RoughBox>
      </div>
      <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3">
        {data.clusters.map((cluster, i) => {
          const ink = INKS[i % INKS.length];
          const Icon = iconFor(cluster.icon);
          return (
            <RoughBox key={cluster.title} seed={`k-${i}-${cluster.title}`} stroke={ink} className="p-3.5">
              <div className="flex items-center gap-2.5">
                <span className="relative grid size-11 shrink-0 place-items-center" style={{ color: ink }}>
                  <svg aria-hidden="true" className="absolute inset-0 overflow-visible" viewBox="0 0 44 44">
                    <RoughShape shape={{ kind: "ellipse", x: 22, y: 22, w: 40, h: 40 }} seed={`i-${i}`} stroke={ink} />
                  </svg>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <p className="text-[24px] leading-tight font-bold" style={{ color: ink }}>
                  {cluster.title}
                </p>
              </div>
              <ul className="mt-2 space-y-1">
                {cluster.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span aria-hidden="true" style={{ color: ink }}>
                      ➜
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </RoughBox>
          );
        })}
      </div>
    </div>
  );
}
