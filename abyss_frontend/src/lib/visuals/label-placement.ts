/**
 * Places diagram labels where they don't sit on what's drawn.
 *
 * Each label belongs to an anchor (a point, or the middle of a line or arrow).
 * Positions around the anchor -- 8 directions at growing distances -- are
 * scored by what a label there would cover: crossing a line, arrow or curve,
 * covering a point, overlapping a label already placed, leaving the drawing,
 * and how far it strays from its anchor. Labels are placed one by one (in the
 * order given), each taking its best position and becoming an obstacle for the
 * next. A label that ends up away from its anchor gets a leader line, so what
 * it names stays unmistakable. Pure: no DOM, works in pixels.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelRequest {
  text: string;
  anchor: Pt;
  fontSize: number;
  /** The line the label names, if any: it may touch its own line's end, not cross its body. */
  own?: [Pt, Pt];
}

export interface PlacedLabel {
  /** Centre of the text (draw with textAnchor="middle", dy="0.35em"). */
  x: number;
  y: number;
  box: Box;
  /** From the anchor to the label's nearest edge, when the label had to move away. */
  leader: [Pt, Pt] | null;
}

export interface Obstacles {
  /** Lines, arrows and curve pieces, in pixels. */
  segments: [Pt, Pt][];
  /** Dots that must stay visible. */
  points: Pt[];
  /** Text already fixed in place (angle marks, notes, labels inside shapes). */
  boxes: Box[];
}

// Average glyph width relative to the font size, for the sans text used in diagrams.
const CHAR_WIDTH = 0.58;
const PAD = 3;
const DIRECTIONS: Pt[] = [
  { x: 1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: -1 }, { x: 1, y: 0 },
  { x: -1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
];
const GAPS = [4, 10, 18, 30, 46];
const LEADER_AFTER = 16; // px between anchor and label edge before a leader line is drawn

export function textBox(text: string, fontSize: number, center: Pt): Box {
  const w = text.length * fontSize * CHAR_WIDTH + 2 * PAD;
  const h = fontSize + 2 * PAD;
  return { x0: center.x - w / 2, y0: center.y - h / 2, x1: center.x + w / 2, y1: center.y + h / 2 };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function inside(p: Pt, b: Box): boolean {
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}

function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d = (u: Pt, v: Pt, w: Pt) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = d(a, b, p);
  const d2 = d(a, b, q);
  const d3 = d(p, q, a);
  const d4 = d(p, q, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the line segment a-b passes through the box. */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  if (inside(a, box) || inside(b, box)) return true;
  const c = [
    { x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 },
  ];
  return c.some((p, i) => crosses(a, b, p, c[(i + 1) % 4]));
}

function nearestOnBox(p: Pt, box: Box): Pt {
  return { x: Math.min(Math.max(p.x, box.x0), box.x1), y: Math.min(Math.max(p.y, box.y0), box.y1) };
}

function sameSegment(s: [Pt, Pt], own: [Pt, Pt] | undefined): boolean {
  if (!own) return false;
  const eq = (u: Pt, v: Pt) => Math.abs(u.x - v.x) < 0.5 && Math.abs(u.y - v.y) < 0.5;
  return (eq(s[0], own[0]) && eq(s[1], own[1])) || (eq(s[0], own[1]) && eq(s[1], own[0]));
}

export function placeLabels(requests: LabelRequest[], obstacles: Obstacles, bounds: Box): PlacedLabel[] {
  const placed: Box[] = [...obstacles.boxes];
  return requests.map((req) => {
    const probe = textBox(req.text, req.fontSize, { x: 0, y: 0 });
    const halfW = (probe.x1 - probe.x0) / 2;
    const halfH = (probe.y1 - probe.y0) / 2;
    let best: { center: Pt; box: Box; cost: number } | null = null;
    for (const gap of GAPS) {
      for (const dir of DIRECTIONS) {
        const center = { x: req.anchor.x + dir.x * (halfW + gap), y: req.anchor.y + dir.y * (halfH + gap) };
        const box = textBox(req.text, req.fontSize, center);
        let cost = gap * 0.6 + (dir.y === 0 ? 0 : 0.5) + (dir.x === 0 ? 0 : 0.25);
        for (const s of obstacles.segments) {
          if (segmentHitsBox(s[0], s[1], box)) cost += sameSegment(s, req.own) ? 40 : 60;
        }
        for (const p of obstacles.points) if (inside(p, { x0: box.x0 - 3, y0: box.y0 - 3, x1: box.x1 + 3, y1: box.y1 + 3 })) cost += 80;
        for (const other of placed) cost += overlapArea(box, other) * 2;
        const out =
          Math.max(0, bounds.x0 - box.x0) + Math.max(0, box.x1 - bounds.x1) +
          Math.max(0, bounds.y0 - box.y0) + Math.max(0, box.y1 - bounds.y1);
        cost += out * 8;
        if (!best || cost < best.cost) best = { center, box, cost };
      }
      if (best && best.cost < gap * 0.6 + 1) break; // a clear spot this close: no need to go further
    }
    const chosen = best!;
    placed.push(chosen.box);
    const edge = nearestOnBox(req.anchor, chosen.box);
    const away = Math.hypot(edge.x - req.anchor.x, edge.y - req.anchor.y);
    return { x: chosen.center.x, y: chosen.center.y, box: chosen.box, leader: away > LEADER_AFTER ? [req.anchor, edge] : null };
  });
}
