import type { IcebergData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";

/**
 * Visible vs hidden: the first level sits above the waterline on the tip of
 * the berg; each deeper level sits lower in darker water. The berg and water
 * are a stretched SVG backdrop, so the content reflows freely on any width.
 */
export function IcebergVisual({ data }: { data: IcebergData }) {
  const [surface, ...depths] = data.levels;
  return (
    <div className="relative overflow-hidden rounded-xl border border-border">
      {/* Sky above the waterline */}
      <div className="relative bg-gradient-to-b from-sky-50 to-sky-100/70 px-4 pt-4 pb-16 dark:from-slate-800 dark:to-slate-800/70">
        <svg aria-hidden="true" viewBox="0 0 400 100" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-16 w-full">
          <path d="M150,100 L180,38 L196,52 L214,18 L236,46 L252,34 L268,100 Z" className="fill-white stroke-sky-300 dark:fill-slate-100" strokeWidth={1} />
        </svg>
        <Level level={surface} depth={0} />
      </div>
      {/* Waterline and the depths */}
      <div className="relative bg-gradient-to-b from-sky-600 via-sky-800 to-slate-950 px-4 pt-5 pb-5 text-white">
        <svg aria-hidden="true" viewBox="0 0 400 300" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          <path d="M150,0 L268,0 L330,90 L300,190 L240,290 L150,280 L90,170 L104,70 Z" fill="rgba(255,255,255,0.10)" />
          <path d="M0,4 Q50,0 100,4 T200,4 T300,4 T400,4" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} />
        </svg>
        <p className="relative mb-3 text-center text-[10.5px] font-semibold tracking-[0.18em] text-sky-100/80">BELOW THE SURFACE</p>
        <div className="relative space-y-4">
          {depths.map((level, i) => (
            <Level key={level.label} level={level} depth={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Level({ level, depth }: { level: IcebergData["levels"][number]; depth: number }) {
  const above = depth === 0;
  return (
    <section className="relative">
      <p className={cn("mb-2 text-center text-[13px] font-semibold", above ? "text-sky-900 dark:text-sky-100" : "text-white")}>
        {level.label}
      </p>
      <ul className="flex flex-wrap justify-center gap-2">
        {level.items.map((item) => (
          <li
            key={item.label}
            title={item.detail}
            className={cn(
              "max-w-[15rem] rounded-lg px-3 py-2 text-center text-[12.5px] leading-snug backdrop-blur-sm",
              above
                ? "bg-white/90 text-slate-900 shadow-sm ring-1 ring-sky-200 dark:bg-slate-100"
                : depth === 1
                  ? "bg-white/15 ring-1 ring-white/25"
                  : "bg-white/10 ring-1 ring-white/15",
            )}
          >
            <span className="font-medium">{item.label}</span>
            {item.detail && (
              <span className={cn("mt-0.5 block text-[11.5px]", above ? "text-slate-600" : "text-sky-100/80")}>{item.detail}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
