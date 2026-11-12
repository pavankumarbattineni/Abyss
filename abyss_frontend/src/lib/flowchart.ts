/**
 * Turns a Mermaid flowchart into an interactive graph: Mermaid parses the
 * source (the same parser that validated it), dagre lays it out, and the
 * result feeds React Flow (components/shared/flowchart-canvas.tsx), so users
 * can drag nodes, pan and zoom. Nodes are real HTML sized to their text, so
 * labels never clip the way Mermaid's static SVG can when fonts load late.
 */
import dagre from "@dagrejs/dagre";

export type FlowDirection = "TB" | "BT" | "LR" | "RL";
export type FlowShape = "rect" | "round" | "diamond" | "circle";

export interface FlowNodeData {
  id: string;
  label: string;
  shape: FlowShape;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed: boolean;
}

export interface FlowGroupData {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Flowchart {
  direction: FlowDirection;
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  groups: FlowGroupData[];
}

/** The bits of Mermaid's flowchart database this module reads. */
interface FlowDb {
  getDirection?: () => string | undefined;
  getVertices: () => Map<string, { id: string; text?: string; type?: string }>;
  getEdges: () => {
    start: string;
    end: string;
    text: string;
    stroke?: string;
  }[];
  getSubGraphs: () => { id: string; title: string; nodes: string[] }[];
}

interface MermaidLike {
  mermaidAPI: {
    getDiagramFromText: (
      text: string,
    ) => Promise<{ type: string; db: unknown }>;
  };
}

const MAX_NODES = 150;
const LINE_CHARS = 26;
const CHAR_PX = 7.2;
const LINE_PX = 18;

/** Mermaid label text -> plain text: entities, <br> and markdown markers. */
function plainLabel(text: string | undefined, fallback: string): string {
  const value = (text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Mermaid's parser swaps `#name;` entities for private placeholders.
    .replace(/ﬂ°°(\d+)¶ß/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/ﬂ°(\w+)¶ß/g, "&$1;")
    .replace(/#quot;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&(?:nbsp);/g, " ")
    .replace(/[`*_]/g, "")
    .trim();
  return value || fallback;
}

function wrapLines(label: string): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && (line + " " + word).length > LINE_CHARS) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function shapeOf(type: string | undefined): FlowShape {
  if (type === "diamond" || type === "hexagon") return "diamond";
  if (type === "circle" || type === "doublecircle") return "circle";
  if (type === "round" || type === "stadium") return "round";
  return "rect";
}

/** Node box size from its label (the canvas renders with the same metrics). */
function sizeFor(
  label: string,
  shape: FlowShape,
): { width: number; height: number } {
  const lines = wrapLines(label);
  const longest = Math.max(...lines.map((l) => l.length), 4);
  const width = Math.min(Math.max(longest * CHAR_PX + 32, 96), 240);
  const height = lines.length * LINE_PX + 22;
  // A diamond needs room around its text to stay a diamond.
  return shape === "diamond"
    ? { width: width + 40, height: height + 34 }
    : { width, height };
}

/** Parses and lays out a flowchart; null for any other diagram type (or one
 * too large to be useful as an interactive canvas). */
export async function buildFlowchart(
  mermaid: MermaidLike,
  source: string,
): Promise<Flowchart | null> {
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  if (!diagram.type.startsWith("flowchart")) return null;
  const db = diagram.db as FlowDb;

  const vertices = [...db.getVertices().values()];
  if (vertices.length === 0 || vertices.length > MAX_NODES) return null;
  const raw = (db.getDirection?.() ?? "TB").toUpperCase();
  const direction: FlowDirection =
    raw === "TD"
      ? "TB"
      : ((["TB", "BT", "LR", "RL"].includes(raw)
          ? raw
          : "TB") as FlowDirection);

  const graph = new dagre.graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({
    rankdir: direction,
    nodesep: 36,
    ranksep: 56,
    marginx: 16,
    marginy: 16,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeInfo = new Map<string, { label: string; shape: FlowShape }>();
  for (const vertex of vertices) {
    const shape = shapeOf(vertex.type);
    const label = plainLabel(vertex.text, vertex.id);
    nodeInfo.set(vertex.id, { label, shape });
    graph.setNode(vertex.id, sizeFor(label, shape));
  }

  const subgraphs = db
    .getSubGraphs()
    .filter((sub) => sub.nodes.some((id) => nodeInfo.has(id)));
  for (const sub of subgraphs) {
    graph.setNode(`group:${sub.id}`, {
      paddingTop: 30,
      paddingBottom: 12,
      paddingLeft: 12,
      paddingRight: 12,
    });
    for (const id of sub.nodes)
      if (nodeInfo.has(id)) graph.setParent(id, `group:${sub.id}`);
  }

  const edges: FlowEdgeData[] = [];
  db.getEdges().forEach((edge, index) => {
    if (
      !nodeInfo.has(edge.start) ||
      !nodeInfo.has(edge.end) ||
      edge.stroke === "invisible"
    )
      return;
    const id = `e${index}`;
    const label = plainLabel(edge.text, "");
    graph.setEdge(
      edge.start,
      edge.end,
      label ? { label, width: label.length * 6.5, height: 18 } : {},
      id,
    );
    edges.push({
      id,
      source: edge.start,
      target: edge.end,
      label: label || undefined,
      dashed: edge.stroke === "dotted",
    });
  });

  dagre.layout(graph);

  const nodes: FlowNodeData[] = vertices.map((vertex) => {
    const box = graph.node(vertex.id);
    const info = nodeInfo.get(vertex.id)!;
    return {
      id: vertex.id,
      ...info,
      x: box.x - box.width / 2,
      y: box.y - box.height / 2,
      width: box.width,
      height: box.height,
    };
  });
  const groups: FlowGroupData[] = subgraphs.flatMap((sub) => {
    const box = graph.node(`group:${sub.id}`);
    if (!box?.width) return [];
    return [
      {
        id: `group:${sub.id}`,
        title: plainLabel(sub.title, sub.id),
        x: box.x - box.width / 2,
        y: box.y - box.height / 2,
        width: box.width,
        height: box.height,
      },
    ];
  });

  return { direction, nodes, edges, groups };
}
