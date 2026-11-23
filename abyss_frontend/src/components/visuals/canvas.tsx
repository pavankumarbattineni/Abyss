import type { CanvasData } from "@/lib/visuals/schemas";
import { iconFor } from "./icons";

/**
 * A one-page overview: the central idea in the middle, its sections around
 * it (a three-column board on wide screens, centre first on phones).
 */
export function CanvasVisual({ data }: { data: CanvasData }) {
  return (
    <div className="@container">
      <div className="grid gap-2.5 @2xl:grid-cols-3">
        {/* Centre first in the DOM so phones read it first; placed in the middle on wide screens. */}
        <div className="order-first flex flex-col items-center justify-center rounded-2xl border border-foreground/20 bg-muted px-4 py-6 text-center text-foreground @2xl:order-none @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1">
          <p className="text-[11px] font-semibold tracking-[0.16em] opacity-80">CORE</p>
          <p className="mt-1 text-lg leading-snug font-semibold">{data.center.label}</p>
          {data.center.detail && <p className="mt-1.5 text-[13px] leading-relaxed opacity-85">{data.center.detail}</p>}
        </div>
        {data.sections.map((section) => {
          const Icon = iconFor(section.icon);
          return (
            <section key={section.label} className="rounded-2xl border border-border bg-background p-3.5">
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-sage-text">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                {section.label}
              </p>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                    <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-primary/70" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
