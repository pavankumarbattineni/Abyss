import type { TimelineData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";

/**
 * Events in order on a vertical rail -- the date beside each event on wide
 * screens (alternating sides from md up), above it on phones. Consecutive
 * events with the same era sit under one heading; milestones stand out.
 */
export function TimelineVisual({ data }: { data: TimelineData }) {
  const groups: { era?: string; events: TimelineData["events"] }[] = [];
  for (const event of data.events) {
    const last = groups[groups.length - 1];
    if (last && last.era === event.era) last.events.push(event);
    else groups.push({ era: event.era, events: [event] });
  }
  let index = 0;

  return (
    <div className="@container">
      <ol className="relative">
        {/* The rail */}
        <span
          aria-hidden="true"
          className="absolute top-2 bottom-2 left-[7px] w-0.5 rounded-full bg-gradient-to-b from-primary/60 via-primary/35 to-primary/10 @2xl:left-1/2 @2xl:-translate-x-1/2"
        />
        {groups.map((group, g) => (
          <li key={g} className="relative">
            {group.era && (
              <div className="relative mb-3 pl-6 @2xl:flex @2xl:justify-center @2xl:pl-0">
                <p className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground ring-4 ring-card">
                  {group.era}
                </p>
              </div>
            )}
            <ol className="space-y-4 pb-4">
              {group.events.map((event) => {
                const side = index++ % 2 === 0 ? "left" : "right";
                return (
                  <li key={`${event.date}-${event.title}`} className="relative @2xl:grid @2xl:grid-cols-2 @2xl:gap-10">
                    {/* Dot */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1.5 left-0 rounded-full ring-4 ring-card @2xl:left-1/2 @2xl:-translate-x-1/2",
                        event.milestone ? "size-4 bg-highlight" : "size-3.5 bg-primary",
                      )}
                    />
                    <div
                      className={cn(
                        "ml-7 @2xl:ml-0",
                        side === "left" ? "@2xl:col-start-1 @2xl:text-right" : "@2xl:col-start-2",
                      )}
                    >
                      <p className={cn("text-xs font-semibold tracking-wide", event.milestone ? "text-highlight" : "text-sage-text")}>
                        {event.date}
                      </p>
                      <div
                        className={cn(
                          "mt-1 rounded-xl border p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)]",
                          event.milestone ? "border-highlight/40 bg-highlight-soft" : "border-border bg-background",
                        )}
                      >
                        <p className="leading-snug font-semibold text-foreground">{event.title}</p>
                        {event.detail && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{event.detail}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}
