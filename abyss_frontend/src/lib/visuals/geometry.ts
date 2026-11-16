/**
 * Layout helpers shared by the SVG renderers: text wrapping and measuring
 * (no DOM -- an average character width is accurate enough for boxes sized
 * with padding), graph layout via dagre, and smooth edge paths.
 */
import dagre from "@dagrejs/dagre";

/** Average glyph width as a fraction of font size (UI sans-serif). */
const CHAR_WIDTH = 0.56;

export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH;
}

/** Word-wraps to at most `maxChars` per line (long words are split). */
export function wrapText(text: string, maxChars: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, maxChars - 1) + "-");
      word = word.slice(maxChars - 1);
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.{0,1}$/, "…");
    return kept;
  }
  return lines;
}

export interface Point {
  x: number;
  y: number;
}

/** A smooth path through dagre's edge points (Catmull-Rom as cubic Béziers). */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return `M${points[0].x},${points[0].y} ${points.slice(1).map((p) => `L${p.x},${p.y}`).join(" ")}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

export interface GraphInput {
  nodes: { id: string; width: number; height: number; group?: string }[];
  edges: { from: string; to: string; label?: string }[];
  groups?: { id: string; label: string }[];
  direction?: "TB" | "LR";
  nodeSep?: number;
  rankSep?: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: Map<string, Point & { width: number; height: number }>;
  edges: { from: string; to: string; label?: string; points: Point[]; labelAt?: Point }[];
  groups: { id: string; label: string; x: number; y: number; width: number; height: number }[];
}

const MARGIN = 16;
const GROUP_PREFIX = "__group:";
const LABEL_SIZE = 11;

/**
 * Lays out a directed graph. Edges to unknown nodes are dropped (a model's
 * typo shouldn't break the drawing); groups become dagre clusters.
 */
export function layoutGraph(input: GraphInput): GraphLayout {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({
    rankdir: input.direction ?? "TB",
    nodesep: input.nodeSep ?? 36,
    ranksep: input.rankSep ?? 48,
    edgesep: 16,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(input.nodes.map((n) => n.id));
  const groups = (input.groups ?? []).filter((group) => input.nodes.some((n) => n.group === group.id));
  for (const group of groups) g.setNode(GROUP_PREFIX + group.id, { label: group.label, paddingTop: 28 });
  for (const node of input.nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
    if (node.group && groups.some((group) => group.id === node.group)) g.setParent(node.id, GROUP_PREFIX + node.group);
  }
  const edges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  edges.forEach((edge, i) => {
    const labelWidth = edge.label ? textWidth(edge.label, LABEL_SIZE) + 14 : 0;
    g.setEdge(edge.from, edge.to, { width: labelWidth, height: edge.label ? 20 : 0, labelpos: "c" }, `e${i}`);
  });
  dagre.layout(g);

  const nodes = new Map<string, Point & { width: number; height: number }>();
  for (const node of input.nodes) {
    const n = g.node(node.id);
    nodes.set(node.id, { x: n.x, y: n.y, width: node.width, height: node.height });
  }
  const laidEdges = edges.map((edge, i) => {
    const e = g.edge({ v: edge.from, w: edge.to, name: `e${i}` }) as { points: Point[]; x?: number; y?: number };
    return {
      ...edge,
      points: e.points,
      labelAt: edge.label && e.x != null && e.y != null ? { x: e.x, y: e.y } : undefined,
    };
  });
  const laidGroups = groups.map((group) => {
    const n = g.node(GROUP_PREFIX + group.id);
    return { id: group.id, label: group.label, x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height };
  });
  const graph = g.graph();
  return {
    width: Math.ceil(graph.width ?? 0),
    height: Math.ceil(graph.height ?? 0),
    nodes,
    edges: laidEdges,
    groups: laidGroups,
  };
}
