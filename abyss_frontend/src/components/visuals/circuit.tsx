"use client";

import type { ReactNode } from "react";

import type { CircuitData, CircuitItem } from "@/lib/visuals/schemas";
import { SvgStage } from "./stage";

type Part = Exclude<CircuitItem, { parallel: unknown }>;
const PART_W = 74;
const BRANCH_GAP = 70;
const SOURCES = new Set(["battery", "cell", "ac"]);
const S = "stroke-foreground";

/** A component's symbol, horizontal, centred on (0, 0), spanning x -30..30 (wires added by the caller). */
function Symbol({ kind }: { kind: Part["kind"] }): ReactNode {
  const wire = (x1: number, x2: number) => <line x1={x1} x2={x2} y1={0} y2={0} className={S} strokeWidth={1.8} />;
  switch (kind) {
    case "resistor":
      return <path d="M-30,0 H-20 L-16,-8 L-8,8 L0,-8 L8,8 L16,-8 L20,0 H30" className={`fill-none ${S}`} strokeWidth={1.8} strokeLinejoin="round" />;
    case "capacitor":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, -5)}
          {wire(5, 30)}
          <line x1={-5} x2={-5} y1={-13} y2={13} strokeWidth={2.4} />
          <line x1={5} x2={5} y1={-13} y2={13} strokeWidth={2.4} />
        </g>
      );
    case "inductor":
      return <path d="M-30,0 H-20 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 H30" className={`fill-none ${S}`} strokeWidth={1.8} />;
    case "lamp":
      return (
        <g className={`fill-none ${S}`} strokeWidth={1.8}>
          {wire(-30, -11)}
          {wire(11, 30)}
          <circle r={11} />
          <path d="M-7.8,-7.8 L7.8,7.8 M7.8,-7.8 L-7.8,7.8" />
        </g>
      );
    case "switch":
      return (
        <g className={`fill-none ${S}`} strokeWidth={1.8}>
          {wire(-30, -10)}
          {wire(10, 30)}
          <line x1={-10} y1={0} x2={9} y2={-12} />
          <circle cx={-10} r={2} className="fill-foreground" />
          <circle cx={10} r={2} className="fill-foreground" />
        </g>
      );
    case "switch-closed":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, 30)}
          <circle cx={-10} r={2} className="fill-foreground" />
          <circle cx={10} r={2} className="fill-foreground" />
        </g>
      );
    case "diode":
    case "led":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, -8)}
          {wire(8, 30)}
          <path d="M-8,-10 L8,0 L-8,10 Z" className="fill-foreground" />
          <line x1={8} x2={8} y1={-10} y2={10} strokeWidth={2.2} />
          {kind === "led" && <path d="M2,-13 l7,-7 m-4,0 h4 v4 M8,-11 l7,-7 m-4,0 h4 v4" className="fill-none" strokeWidth={1.3} />}
        </g>
      );
    case "ammeter":
    case "voltmeter":
    case "motor":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, -12)}
          {wire(12, 30)}
          <circle r={12} className="fill-card" />
          <text textAnchor="middle" dy="0.36em" fontSize={13} fontWeight={700} strokeWidth={0} className="fill-foreground">
            {kind === "ammeter" ? "A" : kind === "voltmeter" ? "V" : "M"}
          </text>
        </g>
      );
    case "fuse":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, 30)}
          <rect x={-12} y={-6} width={24} height={12} className="fill-none" />
        </g>
      );
    case "battery":
    case "cell":
      return (
        <g className={S} strokeWidth={1.8}>
          {wire(-30, kind === "cell" ? -4 : -14)}
          {wire(kind === "cell" ? 4 : 14, 30)}
          {(kind === "cell" ? [-4] : [-14, 2]).map((x) => (
            <g key={x}>
              <line x1={x} x2={x} y1={-14} y2={14} strokeWidth={2} />
              <line x1={x + 8} x2={x + 8} y1={-7} y2={7} strokeWidth={3.2} />
            </g>
          ))}
        </g>
      );
    case "ac":
      return (
        <g className={`fill-none ${S}`} strokeWidth={1.8}>
          {wire(-30, -13)}
          {wire(13, 30)}
          <circle r={13} />
          <path d="M-8,0 C-5,-9 -1,-9 0,0 C1,9 5,9 8,0" />
        </g>
      );
    default:
      return wire(-30, 30);
  }
}

const labelOf = (part: Part) => [part.label, part.value].filter(Boolean).join(" ");
/** A part's slot: wide enough for its symbol and its label. */
const partWidth = (part: Part) => Math.max(PART_W, Math.round(labelOf(part).length * 6.8) + 16);

function Labelled({ part, x, y, vertical = false }: { part: Part; x: number; y: number; vertical?: boolean }) {
  const text = labelOf(part);
  return (
    <g>
      <g transform={`translate(${x} ${y})${vertical ? " rotate(-90)" : ""}`}>
        <Symbol kind={part.kind} />
      </g>
      {text && (
        <text
          x={vertical ? x - 24 : x}
          // Above the symbol (an LED's light arrows reach higher).
          y={vertical ? y : y - (part.kind === "led" ? 27 : 21)}
          dy={vertical ? "0.35em" : undefined}
          textAnchor={vertical ? "end" : "middle"}
          fontSize={12}
          className="fill-foreground font-medium"
        >
          {text}
        </text>
      )}
    </g>
  );
}

/**
 * A circuit schematic in standard symbols: the loop's parts in order (a
 * source first is drawn on the left side), with `parallel` groups drawn as
 * branches between two rails. Covers series, parallel and mixed circuits.
 */
export function CircuitVisual({ data }: { data: CircuitData }) {
  const items = data.loop as CircuitItem[];
  const sourceFirst = items.length > 0 && !("parallel" in items[0]) && SOURCES.has((items[0] as Part).kind);
  const source = sourceFirst ? (items[0] as Part) : null;
  const top = sourceFirst ? items.slice(1) : items;
  const branchWidth = (branch: Part[]) => branch.reduce((sum, p) => sum + partWidth(p), 0);
  const widthOf = (item: CircuitItem) => ("parallel" in item ? Math.max(...item.parallel.map(branchWidth)) + 40 : partWidth(item));
  const branchesDeep = Math.max(1, ...top.map((item) => ("parallel" in item ? item.parallel.length : 1)));
  // Room on the left for the source's label, which sits beside it.
  const sourceText = source ? labelOf(source) : "";
  const left = Math.max(70, 40 + Math.round(sourceText.length * 7));
  const y0 = 50;
  const yBottom = y0 + Math.max(150, (branchesDeep - 1) * BRANCH_GAP + 80);
  // left + 20 lead-in + the parts + 20 before the right corner + 40 margin.
  const width = Math.max(420, left + 20 + top.reduce((s, item) => s + widthOf(item), 0) + 60);
  const height = yBottom + 30;
  const right = width - 40;

  const pieces: ReactNode[] = [];
  let x = left + 20;
  top.forEach((item, i) => {
    const w = widthOf(item);
    if ("parallel" in item) {
      const a = x + 10;
      const b = x + w - 10;
      // Rails at both ends of the group.
      pieces.push(
        <line key={`ra${i}`} x1={a} x2={a} y1={y0} y2={y0 + (item.parallel.length - 1) * BRANCH_GAP} className={S} strokeWidth={1.8} />,
        <line key={`rb${i}`} x1={b} x2={b} y1={y0} y2={y0 + (item.parallel.length - 1) * BRANCH_GAP} className={S} strokeWidth={1.8} />,
      );
      item.parallel.forEach((branch, j) => {
        const by = y0 + j * BRANCH_GAP;
        const span = branchWidth(branch);
        const start = (a + b) / 2 - span / 2;
        pieces.push(<line key={`bw${i}-${j}a`} x1={a} x2={start} y1={by} y2={by} className={S} strokeWidth={1.8} />);
        pieces.push(<line key={`bw${i}-${j}b`} x1={start + span} x2={b} y1={by} y2={by} className={S} strokeWidth={1.8} />);
        let px = start;
        branch.forEach((p, k) => {
          const pw = partWidth(p);
          const cx = px + pw / 2;
          px += pw;
          pieces.push(<line key={`bg${i}-${j}-${k}`} x1={cx - pw / 2} x2={cx - 30} y1={by} y2={by} className={S} strokeWidth={1.8} />);
          pieces.push(<line key={`bh${i}-${j}-${k}`} x1={cx + 30} x2={cx + pw / 2} y1={by} y2={by} className={S} strokeWidth={1.8} />);
          pieces.push(<Labelled key={`bp${i}-${j}-${k}`} part={p} x={cx} y={by} />);
        });
        pieces.push(<circle key={`ja${i}-${j}`} cx={a} cy={by} r={3} className="fill-foreground" />, <circle key={`jb${i}-${j}`} cx={b} cy={by} r={3} className="fill-foreground" />);
      });
      pieces.push(<line key={`pw${i}a`} x1={x} x2={a} y1={y0} y2={y0} className={S} strokeWidth={1.8} />, <line key={`pw${i}b`} x1={b} x2={x + w} y1={y0} y2={y0} className={S} strokeWidth={1.8} />);
    } else {
      const cx = x + w / 2;
      pieces.push(<line key={`w${i}a`} x1={x} x2={cx - 30} y1={y0} y2={y0} className={S} strokeWidth={1.8} />);
      pieces.push(<line key={`w${i}b`} x1={cx + 30} x2={x + w} y1={y0} y2={y0} className={S} strokeWidth={1.8} />);
      pieces.push(<Labelled key={`p${i}`} part={item} x={cx} y={y0} />);
    }
    x += w;
  });

  const midY = (y0 + yBottom) / 2;
  return (
    <SvgStage width={width} height={height} label={data.title ?? "Circuit"}>
      {/* The loop: left side (source), top run, right side, bottom return. */}
      <line x1={left} x2={left + 20} y1={y0} y2={y0} className={S} strokeWidth={1.8} />
      <line x1={x} x2={right} y1={y0} y2={y0} className={S} strokeWidth={1.8} />
      <line x1={right} x2={right} y1={y0} y2={yBottom} className={S} strokeWidth={1.8} />
      <line x1={left} x2={right} y1={yBottom} y2={yBottom} className={S} strokeWidth={1.8} />
      {source ? (
        <>
          <line x1={left} x2={left} y1={y0} y2={midY - 30} className={S} strokeWidth={1.8} />
          <line x1={left} x2={left} y1={midY + 30} y2={yBottom} className={S} strokeWidth={1.8} />
          <Labelled part={source} x={left} y={midY} vertical />
        </>
      ) : (
        <line x1={left} x2={left} y1={y0} y2={yBottom} className={S} strokeWidth={1.8} />
      )}
      {pieces}
    </SvgStage>
  );
}
