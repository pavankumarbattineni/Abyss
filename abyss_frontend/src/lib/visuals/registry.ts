/**
 * What each visual format is called and what it's for -- shared by the
 * renderer frame and the composer's slash-command menu. The renderers
 * themselves are in components/visuals.
 */
import type { VisualFormatName } from "./schemas";

export interface VisualFormatMeta {
  name: VisualFormatName;
  label: string;
  description: string;
}

export const VISUAL_FORMATS: readonly VisualFormatMeta[] = [
  { name: "flowchart", label: "Flowchart", description: "A process with steps, decisions and branches" },
  { name: "diagram", label: "Diagram", description: "How concepts, parts or systems relate" },
  { name: "blueprint", label: "Blueprint", description: "The technical structure of a system" },
  { name: "tree", label: "Tree", description: "A topic broken into its branches" },
  { name: "timeline", label: "Timeline", description: "Events in time order" },
  { name: "roadmap", label: "Roadmap", description: "Stages, milestones and projects" },
  { name: "cycle", label: "Cycle", description: "A repeating loop of stages" },
  { name: "layers", label: "Layers", description: "A stack, each layer built on the next" },
  { name: "iceberg", label: "Iceberg", description: "What's visible and what lies beneath" },
  { name: "decision-matrix", label: "Decision matrix", description: "Options scored on weighted criteria" },
  { name: "canvas", label: "Canvas", description: "A one-page overview in sections" },
  { name: "infographic", label: "Infographic", description: "Key facts and numbers at a glance" },
  { name: "handwritten", label: "Handwritten notes", description: "Study notes on a notebook page" },
  { name: "sketchnotes", label: "Sketchnotes", description: "Visual notes around a central idea" },
  { name: "exploded-view", label: "Exploded view", description: "An object pulled apart into its parts" },
  { name: "plot", label: "Graph", description: "Functions, curves and data drawn to scale" },
  { name: "geometry", label: "Geometry", description: "Shapes, angles, forces and vectors to scale" },
  { name: "vector-field", label: "Vector field", description: "Arrows showing a field's direction and strength" },
  { name: "number-line", label: "Number line", description: "Points, intervals and inequalities" },
  { name: "venn", label: "Venn diagram", description: "How two or three sets overlap" },
  { name: "molecule", label: "Molecule", description: "Chemical structures drawn from SMILES" },
  { name: "periodic-table", label: "Periodic table", description: "Elements highlighted, or a trend across them" },
  { name: "energy-levels", label: "Energy levels", description: "Orbital boxes and energy transitions" },
  { name: "circuit", label: "Circuit", description: "An electric circuit in standard symbols" },
  { name: "steps", label: "Step by step", description: "A derivation, proof or algorithm, one step at a time" },
  { name: "map", label: "Map", description: "Places, countries and routes on a world map" },
  { name: "image", label: "Image", description: "A real, credited image from Wikimedia Commons or the web" },
];

export const VISUAL_FORMAT_META = Object.fromEntries(VISUAL_FORMATS.map((meta) => [meta.name, meta])) as Record<
  VisualFormatName,
  VisualFormatMeta
>;

/** Readable plain-text outline of any visual's data (for "Copy as text"). */
export function visualToText(data: unknown): string {
  const lines: string[] = [];
  const nameOf = (obj: Record<string, unknown>) =>
    ["title", "label", "name", "heading", "term", "date"].map((k) => obj[k]).find((v) => typeof v === "string");
  const walk = (value: unknown, depth: number) => {
    const pad = "  ".repeat(depth);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const head = nameOf(obj);
          const rest = Object.entries(obj).filter(([k, v]) => v !== head && k !== "id" && k !== "kind" && v != null);
          const inline = rest.filter(([, v]) => typeof v === "string" || typeof v === "number").map(([, v]) => String(v));
          lines.push(`${pad}- ${[head, ...inline].filter(Boolean).join(" — ")}`);
          for (const [, v] of rest) if (typeof v === "object") walk(v, depth + 1);
        } else if (item != null) {
          lines.push(`${pad}- ${String(item)}`);
        }
      }
    } else if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const head = nameOf(obj);
      if (head) lines.push(`${pad}${head}`);
      for (const [key, v] of Object.entries(obj)) {
        if (key === "format" || v === head || v == null) continue;
        if (typeof v === "object") walk(v, depth + (head ? 1 : 0));
        else if (key !== "id") lines.push(`${pad}${String(v)}`);
      }
    }
  };
  walk(data, 0);
  return lines.join("\n");
}
