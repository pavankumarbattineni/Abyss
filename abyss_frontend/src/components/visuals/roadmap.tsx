import { Flag, Hammer } from "lucide-react";

import type { RoadmapData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";

/**
 * A learning or delivery path: stages side by side on wide screens (scrolling
 * sideways when there are many), stacked with a connecting rail on phones.
 * Milestones and projects are badged; prerequisites appear as "after" chips.
 */
export function RoadmapVisual({ data }: { data: RoadmapData }) {
  const titles = new Map<string, string>();
  for (const stage of data.stages) for (const item of stage.items) if (item.id) titles.set(item.id, item.title);

  return (
    <div className="@container">
      <ol className="flex flex-col gap-3 @3xl:flex-row @3xl:snap-x @3xl:overflow-x-auto @3xl:pb-2">
        {data.stages.map((stage, s) => (
          <li key={s} className="relative flex @3xl:min-w-48 @3xl:flex-1 @3xl:snap-start @3xl:flex-col">
            {/* Step marker and rail */}
            <div className="mr-3 flex flex-col items-center @3xl:mr-0 @3xl:mb-3 @3xl:flex-row">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {s + 1}
              </span>
              {s < data.stages.length - 1 && (
                <span aria-hidden="true" className="mt-1 w-0.5 flex-1 bg-primary/30 @3xl:mt-0 @3xl:ml-2 @3xl:h-0.5 @3xl:w-auto" />
              )}
            </div>
            <div className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="font-semibold text-foreground">{stage.label}</p>
                {stage.duration && <p className="text-xs text-muted-foreground">{stage.duration}</p>}
              </div>
              {stage.summary && <p className="mt-0.5 text-[13px] text-muted-foreground">{stage.summary}</p>}
              <ul className="mt-2.5 space-y-1.5">
                {stage.items.map((item, i) => (
                  <li
                    key={i}
                    className={cn(
                      "rounded-lg px-2.5 py-2",
                      item.kind === "milestone"
                        ? "bg-highlight-soft"
                        : item.kind === "project"
                          ? "border border-border bg-card"
                          : "bg-muted/60",
                    )}
                  >
                    <p className="flex items-start gap-1.5 text-[13px] leading-snug font-medium text-foreground">
                      {item.kind === "milestone" && <Flag className="mt-0.5 size-3.5 shrink-0 text-highlight" aria-label="Milestone" />}
                      {item.kind === "project" && <Hammer className="mt-0.5 size-3.5 shrink-0 text-sage-text" aria-label="Project" />}
                      <span>{item.title}</span>
                    </p>
                    {item.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>}
                    {item.requires.some((r) => titles.has(r)) && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {item.requires
                          .filter((r) => titles.has(r))
                          .map((r) => (
                            <span key={r} className="rounded-full border border-border bg-background px-1.5 py-px text-[10.5px] text-muted-foreground">
                              after {titles.get(r)}
                            </span>
                          ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
