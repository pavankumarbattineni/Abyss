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
