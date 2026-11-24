/**
 * Shapes of the native visual formats (```visual blocks). The model writes a
 * small JSON spec; these schemas validate it before a renderer draws it.
 *
 * Mirrors the specs the agent is given in
 * abyss_backend/abyss_agents/visual_specs.py -- keep the two in sync.
 *
 * Deliberately forgiving: optional fields may be missing, over-long lists are
 * trimmed rather than rejected, and numbers given as strings are accepted, so
 * a small model's near-miss still draws.
 */
import { z } from "zod";

import { evaluateFormula } from "@/lib/formula";

const text = z.string().trim().min(1);
const optText = z.string().trim().optional().transform((v) => v || undefined);
/** A list of short strings; non-strings and blanks are dropped. */
const strings = (max: number) =>
  z
    .array(z.unknown())
    .optional()
    .transform((list) =>
      (list ?? [])
        .map((item) => (typeof item === "number" ? String(item) : item))
        .filter((item): item is string => typeof item === "string" && item.trim() !== "")
        .map((item) => item.trim())
        .slice(0, max),
    );
const list = <T extends z.ZodTypeAny>(item: T, max: number, min = 1) =>
  z.array(item).min(min).transform((items) => items.slice(0, max));
const optList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .optional()
    .transform((items) => (items ?? []).slice(0, max));
const num = z.union([z.number(), z.string().transform(Number)]).pipe(z.number().finite());
const id = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const icon = optText;

const base = { title: optText, subtitle: optText };

export const flowchartSchema = z.object({
  ...base,
  format: z.literal("flowchart"),
  direction: z.enum(["TB", "LR"]).optional().catch(undefined),
  nodes: list(
    z.object({
      id,
      label: text,
      kind: z
        .enum(["start", "end", "process", "decision", "io", "subprocess"])
        .catch("process")
        .default("process"),
      detail: optText,
    }),
    30,
    2,
  ),
  edges: optList(z.object({ from: id, to: id, label: optText }), 60),
});

export const diagramSchema = z.object({
  ...base,
  format: z.literal("diagram"),
  nodes: list(z.object({ id, label: text, detail: optText, group: optText, icon }), 30, 2),
  edges: optList(z.object({ from: id, to: id, label: optText, dashed: z.boolean().optional().catch(false) }), 60),
  groups: optList(z.object({ id, label: text }), 8),
});

export const blueprintSchema = z.object({
  ...base,
  format: z.literal("blueprint"),
  components: list(
    z.object({
      id,
      label: text,
      role: optText,
      detail: optText,
      inputs: strings(5),
      outputs: strings(5),
      group: optText,
    }),
    18,
    2,
  ),
  links: optList(z.object({ from: id, to: id, label: optText }), 40),
  groups: optList(z.object({ id, label: text }), 6),
  legend: optList(z.object({ label: text, text: text }), 8),
  notes: strings(8),
});

export interface TreeNode {
  label: string;
  detail?: string;
  children: TreeNode[];
}
const treeNode: z.ZodType<TreeNode, unknown> = z.lazy(() =>
  z.object({
    label: text,
    detail: optText,
    children: z
      .array(treeNode)
      .optional()
      .transform((c) => (c ?? []).slice(0, 12)),
  }),
);
export const treeSchema = z.object({ ...base, format: z.literal("tree"), root: treeNode });

export const timelineSchema = z.object({
  ...base,
  format: z.literal("timeline"),
  events: list(
    z.object({
      date: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      title: text,
      detail: optText,
      milestone: z.boolean().optional().catch(false),
      era: optText,
    }),
    30,
  ),
});

export const roadmapSchema = z.object({
  ...base,
  format: z.literal("roadmap"),
  stages: list(
    z.object({
      label: text,
      duration: optText,
      summary: optText,
      items: list(
        z.object({
          id: id.optional(),
          title: text,
          detail: optText,
          kind: z.enum(["topic", "milestone", "project"]).catch("topic").default("topic"),
          requires: z
            .array(id)
            .optional()
            .catch([])
            .transform((r) => r ?? []),
        }),
        12,
      ),
    }),
    8,
  ),
});

export const cycleSchema = z.object({
  ...base,
  format: z.literal("cycle"),
  center: optText,
  stages: list(z.object({ label: text, detail: optText, icon }), 10, 2),
});

export const layersSchema = z.object({
  ...base,
  format: z.literal("layers"),
  layers: list(z.object({ label: text, role: optText, items: strings(8), tech: strings(8) }), 9, 2),
  flows: optList(z.object({ from: text, to: text, label: text }), 12),
});

export const icebergSchema = z.object({
  ...base,
  format: z.literal("iceberg"),
  levels: list(
    z.object({
      label: text,
      items: list(
        z.union([text.transform((label) => ({ label, detail: undefined })), z.object({ label: text, detail: optText })]),
        6,
      ),
    }),
    6,
    2,
  ),
});

export const decisionMatrixSchema = z.object({
  ...base,
  format: z.literal("decision-matrix"),
  criteria: list(
    z.object({
      name: text,
      weight: num.catch(3).default(3).transform((w) => Math.min(5, Math.max(1, w))),
    }),
    10,
  ),
  options: list(
    z.object({
      name: text,
      summary: optText,
      scores: z.array(num.catch(0)).default([]),
      pros: strings(5),
      cons: strings(5),
    }),
    8,
  ),
  recommendation: optText,
});

export const canvasSchema = z.object({
  ...base,
  format: z.literal("canvas"),
  center: z.union([text.transform((label) => ({ label, detail: undefined })), z.object({ label: text, detail: optText })]),
  sections: list(z.object({ label: text, icon, items: strings(6) }), 10, 2),
});

export const infographicSchema = z.object({
  ...base,
  format: z.literal("infographic"),
  stats: optList(z.object({ value: z.union([z.string(), z.number()]).transform(String), label: text }), 4),
  sections: list(
    z.object({
      title: text,
      icon,
      text: optText,
      points: strings(6),
      chart: z
        .object({
          type: z.enum(["bar", "pie"]).catch("bar"),
          data: list(z.object({ label: text, value: num }), 8),
        })
        .optional()
        .catch(undefined),
    }),
    8,
  ),
  takeaways: strings(6),
});

export const handwrittenSchema = z.object({
  ...base,
  format: z.literal("handwritten"),
  sections: list(
    z.object({
      heading: text,
      notes: strings(8),
      definitions: optList(z.object({ term: text, meaning: text }), 6),
      highlights: strings(4),
      formula: optText,
    }),
    8,
  ),
  summary: strings(6),
});

export const sketchnotesSchema = z.object({
  ...base,
  format: z.literal("sketchnotes"),
  center: text,
  clusters: list(z.object({ title: text, icon, points: strings(5) }), 8, 2),
});

export const PART_SHAPES = ["cover", "panel", "board", "box", "cylinder", "disc", "ring", "screen"] as const;
export const explodedViewSchema = z.object({
  ...base,
  format: z.literal("exploded-view"),
  object: text,
  parts: list(
    z.object({ name: text, detail: optText, shape: z.enum(PART_SHAPES).catch("panel").default("panel") }),
    12,
    2,
  ),
});

// ---------------------------------------------------------------------------
// Science and math formats: graphs, geometry, fields and notation drawn to
// scale. Coordinates and values may be numbers or formulas (strings) over the
// format's parameters, so a slider can move them (see lib/formula.ts).
// ---------------------------------------------------------------------------

/** A number, or a formula over the visual's parameters ("v*cos(a)"). */
const numOrExpr = z.union([z.number(), z.string().trim().min(1)]);
/** [x, y] or {x, y}, each a number or a formula. */
const xy = z
  .union([z.tuple([numOrExpr, numOrExpr]), z.object({ x: numOrExpr, y: numOrExpr })])
  .transform((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
/** A number, or a constant expression such as "2pi" or "pi/2". */
const constant = z
  .union([
    z.number(),
    z.string().transform((s) => {
      try {
        return evaluateFormula(s, {});
      } catch {
        return NaN;
      }
    }),
  ])
  .pipe(z.number().finite());
const range = z
  .union([z.tuple([constant, constant]), z.object({ min: constant, max: constant })])
  .transform((r) => (Array.isArray(r) ? r : [r.min, r.max]) as [number, number])
  .refine(([a, b]) => b > a, "a range's end must be above its start");
const optRange = range.optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);
/** One of the app's chart colours by number (1-8), or none for the next in turn. */
const colorIndex = z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(1).max(8)).optional().catch(undefined);

const param = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  label: optText,
  min: num,
  max: num,
  value: num.optional(),
  step: num.optional().catch(undefined),
  /** A play button moves it from min to max over this many seconds. */
  animate: z.union([z.boolean(), num]).optional().catch(undefined),
});

/** Curves shared by plot and geometry: y = f(x) over an optional x range, and (x(t), y(t)). */
const functionCurve = z.object({ y: text, label: optText, x: optRange, color: colorIndex, dashed: flag });
const parametricCurve = z.object({ x: text, y: text, t: range, label: optText, color: colorIndex, dashed: flag });

export const plotSchema = z.object({
  ...base,
  format: z.literal("plot"),
  x: optRange,
  y: optRange,
  xLabel: optText,
  yLabel: optText,
  xLog: flag,
  yLog: flag,
  grid: flag,
  /** Equal units on both axes (circles stay round). */
  equal: flag,
  params: optList(param, 6),
  functions: optList(functionCurve, 8),
  parametric: optList(parametricCurve, 6),
  polar: optList(z.object({ r: text, t: range, label: optText, color: colorIndex, dashed: flag }), 6),
  /** A shaded area: between y and y2 (default: the x-axis) from x[0] to x[1]. */
  areas: optList(
    z.object({ y: text, y2: z.string().trim().optional(), x: optRange, label: optText, color: colorIndex }),
    6,
  ),
  data: optList(
    z.object({
      label: optText,
      points: z.array(z.union([z.tuple([num, num]), z.object({ x: num, y: num })])).min(1).max(500)
        .transform((ps) => ps.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p))),
      line: flag,
      color: colorIndex,
    }),
    6,
  ),
  points: optList(z.object({ at: xy, label: optText, open: flag, color: colorIndex }), 30),
  segments: optList(z.object({ from: xy, to: xy, label: optText, dashed: flag, arrow: flag, color: colorIndex }), 30),
  vlines: optList(z.object({ x: numOrExpr, label: optText, dashed: flag }), 10),
  hlines: optList(z.object({ y: numOrExpr, label: optText, dashed: flag }), 10),
  notes: optList(z.object({ at: xy, text }), 12),
});

export const geometrySchema = z.object({
  ...base,
  format: z.literal("geometry"),
  x: optRange,
  y: optRange,
  grid: flag,
  axes: flag,
  params: optList(param, 6),
  points: optList(z.object({ id, at: xy, label: optText, hidden: flag }), 40),
  segments: optList(z.object({ from: z.union([id, xy]), to: z.union([id, xy]), label: optText, dashed: flag }), 40),
  /** Arrows: forces, velocities, displacements. */
  vectors: optList(
    z.object({ from: z.union([id, xy]), to: z.union([id, xy]).optional(), d: xy.optional(), label: optText, color: colorIndex }),
    24,
  ),
  circles: optList(z.object({ center: z.union([id, xy]), r: numOrExpr, label: optText, dashed: flag }), 12),
  polygons: optList(
    z.object({ points: z.array(z.union([id, xy])).min(3).max(24), label: optText, shade: flag, color: colorIndex }),
    12,
  ),
  /** An angle at `vertex` from ray vertex->from to ray vertex->to. */
  angles: optList(
    z.object({ vertex: z.union([id, xy]), from: z.union([id, xy]), to: z.union([id, xy]), label: optText, right: flag }),
    12,
  ),
  /** Boxes for bodies in free-body diagrams; rotated by `angle` degrees. */
  boxes: optList(z.object({ at: xy, w: num, h: num, angle: num.optional().catch(undefined), label: optText }), 8),
  /** Curves (a cable, a trajectory, an arc), as in plot. */
  functions: optList(functionCurve, 8),
  parametric: optList(parametricCurve, 6),
  notes: optList(z.object({ at: xy, text }), 12),
  /** A 2×2 matrix: a toggle shows everything before and after applying it. */
  transform: z
    .object({ matrix: z.tuple([z.tuple([num, num]), z.tuple([num, num])]), label: optText })
    .optional()
    .catch(undefined),
});

export const vectorFieldSchema = z.object({
  ...base,
  format: z.literal("vector-field"),
  fx: text,
  fy: text,
  x: optRange,
  y: optRange,
  /** Arrows per row (6-24). */
  density: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().min(6).max(24)).optional().catch(undefined),
  params: optList(param, 4),
  markers: optList(z.object({ at: xy, label: optText, sign: z.enum(["+", "-"]).optional().catch(undefined) }), 8),
  xLabel: optText,
  yLabel: optText,
});

const bound = z.union([num, z.null(), z.literal("-inf"), z.literal("inf"), z.literal("infinity"), z.literal("-infinity")]);
export const numberLineSchema = z.object({
  ...base,
  format: z.literal("number-line"),
  min: num,
  max: num,
  step: num.optional().catch(undefined),
  points: optList(z.object({ at: num, label: optText, open: flag }), 20),
  intervals: optList(
    z.object({ from: bound, to: bound, fromOpen: flag, toOpen: flag, label: optText, color: colorIndex }),
    8,
  ),
});

export const vennSchema = z.object({
  ...base,
  format: z.literal("venn"),
  sets: list(z.object({ id, label: text }), 3, 2),
  /** A region = the sets it is inside (and outside all others); [] = outside every set. */
  regions: optList(z.object({ in: z.array(id).max(3), label: optText, value: z.union([num, text]).optional() }), 8),
  universe: optText,
});

export const moleculeSchema = z.object({
  ...base,
  format: z.literal("molecule"),
  // A misspelt key ("smile", "SMILES", "smils") still counts; an entry with no
  // structure at all is dropped rather than failing the whole visual.
  molecules: z
    .array(z.unknown())
    .transform((items) =>
      items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as Record<string, unknown>;
        const key = Object.keys(entry).find((k) => /^smi/i.test(k));
        const parsed = z
          .object({ smiles: text, name: optText, caption: optText })
          .safeParse({ ...entry, smiles: key ? entry[key] : undefined });
        return parsed.success ? [parsed.data] : [];
      }).slice(0, 6),
    )
    .refine((molecules) => molecules.length > 0, "give at least one molecule with a SMILES string"),
});

export const periodicTableSchema = z.object({
  ...base,
  format: z.literal("periodic-table"),
  /** Elements to highlight (symbols). */
  highlight: strings(118),
  /** A value per element (symbol -> number) shown as a colour scale: a trend. */
  values: z.record(z.string(), num).optional().catch(undefined),
  valueLabel: optText,
  /** One element shown in detail with its electron configuration. */
  focus: optText,
  configuration: optText,
  legend: optText,
});

export const energyLevelsSchema = z.object({
  ...base,
  format: z.literal("energy-levels"),
  /** Orbital boxes: each subshell with its boxes and electrons (Hund's rule fills them). */
  orbitals: optList(
    z.object({ label: text, boxes: z.union([z.number(), z.string().transform(Number)]).pipe(z.number().int().min(1).max(7)), electrons: num }),
    20,
  ),
  /** Energy levels with transitions between them (spectra, MO diagrams). */
  levels: optList(z.object({ id, label: text, energy: num }), 16),
  transitions: optList(z.object({ from: id, to: id, label: optText }), 12),
  energyLabel: optText,
});

const CIRCUIT_KINDS = [
  "battery", "cell", "ac", "resistor", "capacitor", "inductor", "lamp", "switch", "switch-closed",
  "diode", "led", "ammeter", "voltmeter", "fuse", "motor", "wire",
] as const;
const circuitPart = z.object({ kind: z.enum(CIRCUIT_KINDS).catch("resistor"), label: optText, value: optText });
type CircuitPart = z.output<typeof circuitPart>;
export type CircuitItem = CircuitPart | { parallel: CircuitPart[][] };
const circuitItem = z.union([
  z.object({ parallel: z.array(z.array(circuitPart).min(1).max(4)).min(2).max(4) }),
  circuitPart,
]);
export const circuitSchema = z.object({
  ...base,
  format: z.literal("circuit"),
  /** The loop's parts in order, starting from the source; `parallel` holds branches side by side. */
  loop: list(circuitItem, 12, 2),
});

export const stepsSchema = z.object({
  ...base,
  format: z.literal("steps"),
  steps: list(
    z.object({
      title: optText,
      text: optText,
      /** LaTeX shown as a display equation. */
      math: optText,
      /** An array's state (algorithms): values, highlighted indices, named pointers. */
      array: z.array(z.union([num, z.string()])).max(24).optional().catch(undefined),
      highlight: z.array(z.union([z.number(), z.string().transform(Number)])).max(24).optional().catch(undefined),
      pointers: z.record(z.string(), z.union([z.number(), z.string().transform(Number)])).optional().catch(undefined),
    }),
    20,
  ),
});

/** Only Wikimedia's servers: an image found with the search_images tool, never an arbitrary URL. */
export const WIKIMEDIA_IMAGE = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
/** A web image search_images found, loaded through the server's image proxy (signed by the server). */
export const PROXIED_IMAGE = /^abyss-image:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const wikimediaImage = z.object({
  src: z
    .string()
    .trim()
    .refine((src) => WIKIMEDIA_IMAGE.test(src) || PROXIED_IMAGE.test(src), "the image must come from search_images (Wikimedia or the image proxy)"),
  /** The site a web image comes from (credited instead of Wikimedia Commons). */
  source: optText,
  page: z.string().trim().url().optional().catch(undefined),
  alt: optText,
  caption: optText,
  author: optText,
  license: optText,
});
export type WikimediaImage = z.output<typeof wikimediaImage>;
/** One image (its fields at the top level) or a gallery of up to 8 ("images"; a carousel past 4). */
export const imageSchema = z
  .object({
    ...base,
    format: z.literal("image"),
    images: z.array(wikimediaImage).min(1).optional(),
    src: z.string().optional(),
    page: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    source: z.string().optional(),
  })
  .transform((d, ctx) => {
    if (d.images) return { title: d.title, format: d.format, images: d.images.slice(0, 8) };
    const one = wikimediaImage.safeParse(d);
    if (!one.success) {
      for (const issue of one.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
      return z.NEVER;
    }
    return { title: d.title, format: d.format, images: [one.data] };
  });

export const VISUAL_SCHEMAS = {
  flowchart: flowchartSchema,
  diagram: diagramSchema,
  blueprint: blueprintSchema,
  tree: treeSchema,
  timeline: timelineSchema,
  roadmap: roadmapSchema,
  cycle: cycleSchema,
  layers: layersSchema,
  iceberg: icebergSchema,
  "decision-matrix": decisionMatrixSchema,
  canvas: canvasSchema,
  infographic: infographicSchema,
  handwritten: handwrittenSchema,
  sketchnotes: sketchnotesSchema,
  "exploded-view": explodedViewSchema,
  plot: plotSchema,
  geometry: geometrySchema,
  "vector-field": vectorFieldSchema,
  "number-line": numberLineSchema,
  venn: vennSchema,
  molecule: moleculeSchema,
  "periodic-table": periodicTableSchema,
  "energy-levels": energyLevelsSchema,
  circuit: circuitSchema,
  steps: stepsSchema,
  image: imageSchema,
} as const;

export type VisualFormatName = keyof typeof VISUAL_SCHEMAS;
export type VisualData<F extends VisualFormatName = VisualFormatName> = z.output<(typeof VISUAL_SCHEMAS)[F]>;
export type FlowchartData = VisualData<"flowchart">;
export type DiagramData = VisualData<"diagram">;
export type BlueprintData = VisualData<"blueprint">;
export type TreeData = VisualData<"tree">;
export type TimelineData = VisualData<"timeline">;
export type RoadmapData = VisualData<"roadmap">;
export type CycleData = VisualData<"cycle">;
export type LayersData = VisualData<"layers">;
export type IcebergData = VisualData<"iceberg">;
export type DecisionMatrixData = VisualData<"decision-matrix">;
export type CanvasData = VisualData<"canvas">;
export type InfographicData = VisualData<"infographic">;
export type HandwrittenData = VisualData<"handwritten">;
export type SketchnotesData = VisualData<"sketchnotes">;
export type ExplodedViewData = VisualData<"exploded-view">;
export type PlotData = VisualData<"plot">;
export type GeometryData = VisualData<"geometry">;
export type VectorFieldData = VisualData<"vector-field">;
export type NumberLineData = VisualData<"number-line">;
export type VennData = VisualData<"venn">;
export type MoleculeData = VisualData<"molecule">;
export type PeriodicTableData = VisualData<"periodic-table">;
export type EnergyLevelsData = VisualData<"energy-levels">;
export type CircuitData = VisualData<"circuit">;
export type StepsData = VisualData<"steps">;
export type ImageData = VisualData<"image">;
export type Param = z.output<typeof param>;
