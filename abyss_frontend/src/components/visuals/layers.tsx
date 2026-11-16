import { ArrowDownUp } from "lucide-react";

import type { LayersData } from "@/lib/visuals/schemas";

/**
 * A stack: bands from the top layer down, each tinted a little deeper, with
 * what passes between neighbours shown on the seam. Flows between layers
 * that aren't neighbours are listed under the stack.
 */
export function LayersVisual({ data }: { data: LayersData }) {
  const n = data.layers.length;
  const norm = (s: string) => s.toLowerCase().trim();
  const between = (a: string, b: string) =>
    data.flows.filter(
      (f) => (norm(f.from) === norm(a) && norm(f.to) === norm(b)) || (norm(f.from) === norm(b) && norm(f.to) === norm(a)),
    );
  const adjacent = new Set<string>();
  for (let i = 0; i < n - 1; i++) for (const f of between(data.layers[i].label, data.layers[i + 1].label)) adjacent.add(f.label + f.from + f.to);
  const others = data.flows.filter((f) => !adjacent.has(f.label + f.from + f.to));

  return (
    <div className="@container">
      <ol>
        {data.layers.map((layer, i) => {
          // Deeper layers get a stronger tint of the brand colour.
          const tint = 8 + Math.round((i / Math.max(1, n - 1)) * 30);
          const seam = i < n - 1 ? between(layer.label, data.layers[i + 1].label) : [];
          return (
            <li key={layer.label}>
              <div
                className="rounded-xl border border-primary/25 px-3.5 py-3 @lg:grid @lg:grid-cols-[minmax(9rem,0.9fr)_minmax(0,2fr)] @lg:gap-4"
                style={{ background: `color-mix(in oklab, var(--primary) ${tint}%, var(--card))` }}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                      {n - i}
                    </span>
                    {layer.label}
                  </p>
                  {layer.role && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{layer.role}</p>}
                </div>
                {(layer.items.length > 0 || layer.tech.length > 0) && (
                  <div className="mt-2 min-w-0 @lg:mt-0">
                    {layer.items.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {layer.items.map((item) => (
                          <li key={item} className="rounded-md bg-background/80 px-2 py-1 text-[12.5px] text-foreground">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                    {layer.tech.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {layer.tech.map((t) => (
                          <li key={t} className="rounded-full border border-primary/40 px-2 py-px font-mono text-[11px] text-sage-text">
                            {t}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {i < n - 1 && (
                <div className="flex min-h-5 items-center justify-center gap-2 py-1 text-[11.5px] text-muted-foreground">
                  <ArrowDownUp className="size-3.5 text-sage-text" aria-hidden="true" />
                  {seam.length > 0 && <span>{seam.map((f) => f.label).join(" · ")}</span>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {others.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2.5 text-[12.5px] text-muted-foreground">
          {others.map((f) => (
            <li key={f.label + f.from + f.to}>
              <span className="font-medium text-foreground">{f.from}</span> → <span className="font-medium text-foreground">{f.to}</span>: {f.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
