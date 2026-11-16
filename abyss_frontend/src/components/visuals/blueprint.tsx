"use client";

import { useId, useMemo } from "react";

import { layoutGraph, smoothPath, textWidth, wrapText } from "@/lib/visuals/geometry";
import type { BlueprintData } from "@/lib/visuals/schemas";
import { SvgStage } from "./stage";

/**
 * Blueprint palette: the same in light and dark mode, like drafting paper.
 * Inline colours (not theme tokens) because the look is the point.
 */
const PAPER = "#123a63";
const GRID = "rgba(255,255,255,0.07)";
const GRID_MAJOR = "rgba(255,255,255,0.13)";
const INK = "#e8f1fb";
const INK_SOFT = "rgba(232,241,251,0.72)";
const ACCENT = "#7cc4ff";

const PAD = 28;
const HEAD = 13;
const BODY = 12;

/** A component's box: label header, role, then its inputs (left) and outputs (right). */
function measure(c: BlueprintData["components"][number]) {
  const label = c.label.toUpperCase();
  const role = c.role ? wrapText(c.role, 30, 2) : [];
  const ports = Math.max(c.inputs.length, c.outputs.length);
  const portW = Math.max(0, ...c.inputs.map((p) => textWidth(p, BODY)), ...c.outputs.map((p) => textWidth(p, BODY)));
  const width = Math.max(170, textWidth(label, HEAD) + 40, ...role.map((l) => textWidth(l, BODY) + 32), portW * 2 + 48);
  const height = 32 + role.length * 15 + (ports ? 10 + ports * 16 : 0) + 12;
  return { label, role, ports, width, height };
}

/** The technical structure of a system, drawn white-on-blue like a drafting blueprint. */
export function BlueprintVisual({ data }: { data: BlueprintData }) {
  const uid = useId().replace(/:/g, "");
  const layout = useMemo(() => {
    const sized = data.components.map((c) => ({ ...c, ...measure(c) }));
    const graph = layoutGraph({
      nodes: sized.map((n) => ({ id: n.id, width: n.width, height: n.height, group: n.group })),
      edges: data.links,
      groups: data.groups,
      // Top to bottom: suits the chat column (left to right gets too wide to read).
      direction: "TB",
      rankSep: 56,
      nodeSep: 40,
    });
    return { sized, graph };
  }, [data]);

  const width = Math.max(layout.graph.width + PAD * 2, 520);
  const footer = 46;
  const height = layout.graph.height + PAD * 2 + footer;

  return (
    <div className="overflow-hidden rounded-lg" style={{ background: PAPER }}>
      <SvgStage
        width={width}
        height={height}
        label={data.title ?? "Blueprint"}
        defs={
          <>
            <pattern id={`${uid}-g`} width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M12 0H0V12" fill="none" stroke={GRID} strokeWidth="1" />
            </pattern>
            <pattern id={`${uid}-G`} width="60" height="60" patternUnits="userSpaceOnUse">
              <rect width="60" height="60" fill={`url(#${uid}-g)`} />
              <path d="M60 0H0V60" fill="none" stroke={GRID_MAJOR} strokeWidth="1" />
            </pattern>
            <marker id={`${uid}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={ACCENT} />
            </marker>
          </>
        }
      >
        <rect width={width} height={height} fill={PAPER} />
        <rect width={width} height={height} fill={`url(#${uid}-G)`} />
        <rect x={8} y={8} width={width - 16} height={height - 16} fill="none" stroke={INK_SOFT} strokeWidth={1} />
        <g transform={`translate(${PAD},${PAD})`} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {layout.graph.groups.map((group) => (
            <g key={group.id}>
              <rect
                x={group.x}
                y={group.y - 14}
                width={group.width}
                height={group.height + 14}
                fill="none"
                stroke={INK_SOFT}
                strokeDasharray="6 4"
              />
              <text x={group.x + 8} y={group.y} fontSize={10} fill={ACCENT} letterSpacing="0.08em">
                {group.label.toUpperCase()}
              </text>
            </g>
          ))}
          {layout.graph.edges.map((edge, i) => (
            <g key={i}>
              <path d={smoothPath(edge.points)} fill="none" stroke={ACCENT} strokeWidth={1.4} markerEnd={`url(#${uid}-a)`} />
              {edge.label && edge.labelAt && (
                <g transform={`translate(${edge.labelAt.x},${edge.labelAt.y})`}>
                  <rect
                    x={-(textWidth(edge.label, 10) + 12) / 2}
                    y={-9}
                    width={textWidth(edge.label, 10) + 12}
                    height={18}
                    fill={PAPER}
                    stroke={ACCENT}
                    strokeWidth={0.8}
                  />
                  <text textAnchor="middle" dy="0.35em" fontSize={10} fill={INK}>
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          ))}
          {layout.sized.map((c) => {
            const pos = layout.graph.nodes.get(c.id);
            if (!pos) return null;
            const x = pos.x - c.width / 2;
            const y = pos.y - c.height / 2;
            const portTop = y + 32 + c.role.length * 15 + 10;
            return (
              <g key={c.id}>
                {c.detail && <title>{c.detail}</title>}
                <rect x={x} y={y} width={c.width} height={c.height} fill="rgba(255,255,255,0.04)" stroke={INK} strokeWidth={1.3} />
                <line x1={x} y1={y + 26} x2={x + c.width} y2={y + 26} stroke={INK_SOFT} strokeWidth={0.8} />
                <text x={x + 10} y={y + 18} fontSize={HEAD} fill={INK} fontWeight={700} letterSpacing="0.05em">
                  {c.label}
                </text>
                {c.role.map((line, i) => (
                  <text key={i} x={x + 10} y={y + 42 + i * 15} fontSize={BODY} fill={INK_SOFT}>
                    {line}
                  </text>
                ))}
                {c.inputs.map((p, i) => (
                  <g key={`in${i}`}>
                    <circle cx={x} cy={portTop + i * 16} r={3} fill={PAPER} stroke={ACCENT} />
                    <text x={x + 9} y={portTop + i * 16} dy="0.35em" fontSize={BODY} fill={ACCENT}>
                      ▸ {p}
                    </text>
                  </g>
                ))}
                {c.outputs.map((p, i) => (
                  <g key={`out${i}`}>
                    <circle cx={x + c.width} cy={portTop + i * 16} r={3} fill={ACCENT} />
                    <text x={x + c.width - 9} y={portTop + i * 16} dy="0.35em" fontSize={BODY} fill={INK} textAnchor="end">
                      {p} ▸
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
        {/* Title block, as on a drawing sheet. */}
        <g fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          <line x1={8} y1={height - footer} x2={width - 8} y2={height - footer} stroke={INK_SOFT} strokeWidth={0.8} />
          <text x={20} y={height - footer + 20} fontSize={11} fill={INK} fontWeight={700} letterSpacing="0.06em">
            {(data.title ?? "BLUEPRINT").toUpperCase()}
          </text>
          <text x={20} y={height - footer + 34} fontSize={9.5} fill={INK_SOFT}>
            {data.components.length} COMPONENTS · {data.links.length} LINKS · INPUTS ◂ LEFT · OUTPUTS RIGHT ▸
          </text>
        </g>
      </SvgStage>
      {(data.legend.length > 0 || data.notes.length > 0) && (
        <div
          className="grid gap-4 border-t px-5 py-4 font-mono text-[12px] leading-relaxed sm:grid-cols-2"
          style={{ borderColor: INK_SOFT, color: INK }}
        >
          {data.legend.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] tracking-widest" style={{ color: ACCENT }}>
                LEGEND
              </p>
              <dl className="space-y-1">
                {data.legend.map((item) => (
                  <div key={item.label} className="flex gap-2">
                    <dt className="shrink-0 font-bold">{item.label}</dt>
                    <dd style={{ color: INK_SOFT }}>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {data.notes.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] tracking-widest" style={{ color: ACCENT }}>
                NOTES
              </p>
              <ol className="list-decimal space-y-1 pl-4" style={{ color: INK_SOFT }}>
                {data.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
