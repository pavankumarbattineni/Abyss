"use client";

import { useMemo, useRef, useState, type ComponentType } from "react";
import { Braces, Copy, Shapes, TriangleAlert } from "lucide-react";

import { Button, Dialog, DialogContent, DialogTitle } from "@/components/ui";
import { CodeBlock } from "@/components/shared/code-block";
import { COMPOSE_EVENT } from "@/components/shared/code-preview";
import { FormatChip, formatCommand } from "@/components/shared/format-chip";
import { BlockActions, copyText } from "@/components/shared/block-actions";
import { useCanAskToFix } from "@/components/shared/fix-request";
import { parseVisual, sniffFormat } from "@/lib/visuals/parse";
import { VISUAL_FORMAT_META, visualToText } from "@/lib/visuals/registry";
import type { VisualData, VisualFormatName } from "@/lib/visuals/schemas";
import { BlueprintVisual } from "./blueprint";
import { CanvasVisual } from "./canvas";
import { CycleVisual } from "./cycle";
import { DecisionMatrixVisual } from "./decision-matrix";
import { DiagramVisual } from "./diagram";
import { ExplodedViewVisual } from "./exploded-view";
import { FlowchartVisual } from "./flowchart";
import { HandwrittenVisual } from "./handwritten";
import { IcebergVisual } from "./iceberg";
import { InfographicVisual } from "./infographic";
import { LayersVisual } from "./layers";
import { RoadmapVisual } from "./roadmap";
import { SketchnotesVisual } from "./sketchnotes";
import { TimelineVisual } from "./timeline";
import { TreeVisual } from "./tree";
import { CircuitVisual } from "./circuit";
import { EnergyLevelsVisual } from "./energy-levels";
import { GeometryVisual } from "./geometry";
import { ImageVisual } from "./image";
import { MapVisual } from "./map";
import { MoleculeVisual } from "./molecule";
import { NumberLineVisual } from "./number-line";
import { PeriodicTableVisual } from "./periodic-table";
import { PlotVisual } from "./plot";
import { StepsVisual } from "./steps";
import { VectorFieldVisual } from "./vector-field";
import { VennVisual } from "./venn";

// Each format has its own renderer; they share the frame below and the
// building blocks in this folder (stage, rough, icons).
const RENDERERS: { [F in VisualFormatName]: ComponentType<{ data: VisualData<F> }> } = {
  flowchart: FlowchartVisual,
  diagram: DiagramVisual,
  blueprint: BlueprintVisual,
  tree: TreeVisual,
  timeline: TimelineVisual,
  roadmap: RoadmapVisual,
  cycle: CycleVisual,
  layers: LayersVisual,
  iceberg: IcebergVisual,
  "decision-matrix": DecisionMatrixVisual,
  canvas: CanvasVisual,
  infographic: InfographicVisual,
  handwritten: HandwrittenVisual,
  sketchnotes: SketchnotesVisual,
  "exploded-view": ExplodedViewVisual,
  plot: PlotVisual,
  geometry: GeometryVisual,
  "vector-field": VectorFieldVisual,
  "number-line": NumberLineVisual,
  venn: VennVisual,
  molecule: MoleculeVisual,
  "periodic-table": PeriodicTableVisual,
  "energy-levels": EnergyLevelsVisual,
  circuit: CircuitVisual,
  steps: StepsVisual,
  map: MapVisual,
  image: ImageVisual,
};

function Renderer({ format, data }: { format: VisualFormatName; data: VisualData }) {
  const Component = RENDERERS[format] as ComponentType<{ data: VisualData }>;
  return <Component data={data} />;
}

/**
 * A ```visual block: the model's JSON spec drawn by the format's native
 * renderer. While the answer streams it shows a placeholder (the JSON is
 * incomplete until then); invalid specs show what's wrong and can be sent
 * back to the agent to fix.
 */
export function VisualBlock({ source, isStreaming = false }: { source: string; isStreaming?: boolean }) {
  const parsed = useMemo(() => (isStreaming ? null : parseVisual(source)), [source, isStreaming]);
  const [view, setView] = useState<"visual" | "data">("visual");
  const [fullscreen, setFullscreen] = useState(false);
  const canAskToFix = useCanAskToFix();
  const drawingRef = useRef<HTMLDivElement>(null);

  const format = parsed?.format ?? sniffFormat(source);
  const meta = format ? VISUAL_FORMAT_META[format] : null;

  // A block holding only a format command (`/blueprint`) is a suggestion the
  // model fenced by mistake, not a broken visual: show it as the suggestion
  // chip it would be in text, instead of an error.
  const suggested = formatCommand(source);
  if (suggested) {
    return (
      <p className="mb-3 font-sans text-sm text-muted-foreground last:mb-0">
        Also available as <FormatChip format={suggested} />
      </p>
    );
  }

  if (!parsed) {
    return (
      <div className="mb-3 flex h-40 animate-pulse flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card font-sans text-xs text-muted-foreground last:mb-0">
        <Shapes className="size-5" />
        Drawing {meta ? meta.label.toLowerCase() : "visual"}…
      </div>
    );
  }

  if (!parsed.ok) {
    const askToFix = () => {
      const text = `The ${meta?.label.toLowerCase() ?? "visual"} couldn't be drawn:\n${parsed.errors
        .map((e) => `- ${e}`)
        .join("\n")}\nPlease send it again with these fixed.`;
      window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: text }));
    };
    return (
      <div role="alert" className="mb-3 rounded-xl border border-border bg-card font-sans text-sm last:mb-0">
        <p className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" />
          This {meta?.label.toLowerCase() ?? "visual"} couldn&apos;t be drawn
        </p>
        <div className="space-y-2 px-3 py-2 text-xs">
          {parsed.errors.map((e) => (
            <p key={e} className="font-mono break-words text-muted-foreground">
              {e}
            </p>
          ))}
          {canAskToFix && (
            <Button variant="outline" size="xs" onClick={askToFix}>
              Ask the agent to fix it
            </Button>
          )}
        </div>
      </div>
    );
  }

  const title = (parsed.data as { title?: string }).title;
  // Notes carry their title on the page itself (handwritten, or a sketchnote's
  // central banner), so the frame doesn't repeat it.
  const center = (parsed.data as { center?: unknown }).center;
  const ownsTitle =
    parsed.format === "handwritten" ||
    (parsed.format === "sketchnotes" && typeof center === "string" && center.trim().toLowerCase() === title?.trim().toLowerCase());
  const subtitle = (parsed.data as { subtitle?: string }).subtitle;

  const name = meta?.label ?? "Visual";
  const fileName = `${(title || name).replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "visual"}.png`;

  return (
    // No header on the visual itself: its actions sit under it (see BlockActions).
    <div className="group/block mb-3 last:mb-0">
    <BlockActions
      label={name}
      onExpand={() => setFullscreen(true)}
      items={[
        view === "visual"
          ? { label: "View data", icon: Braces, onClick: () => setView("data") }
          : { label: "View visual", icon: Shapes, onClick: () => setView("visual") },
        { label: "Copy as text", icon: Copy, onClick: () => copyText(visualToText(parsed.data), "Text") },
      ]}
      image={view === "visual" ? { target: drawingRef, fileName } : undefined}
    />
    <figure
      aria-label={title ? `${name}: ${title}` : name}
      className="font-sans text-sm leading-normal text-foreground"
    >
      {view === "data" ? (
        <div>
          <CodeBlock language="json" code={JSON.stringify(parsed.data, null, 2)} />
        </div>
      ) : (
        <div ref={drawingRef} className="py-1">
          {!ownsTitle && (title || subtitle) && (
            <figcaption className="mb-3">
              {title && <p className="text-base leading-snug font-semibold text-foreground">{title}</p>}
              {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
            </figcaption>
          )}
          <Renderer format={parsed.format} data={parsed.data} />
        </div>
      )}

    </figure>
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[92dvh] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <div className="border-b border-border px-4 py-3 pr-12">
            <DialogTitle className="text-base">{title ?? meta?.label}</DialogTitle>
            {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 font-sans text-sm sm:p-6">
            <Renderer format={parsed.format} data={parsed.data} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
