"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, GitBranch, Search, Sparkles, UserRound, Workflow } from "lucide-react";

type GraphPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type NodeId = "start" | "main" | "research" | "analysis" | "data" | "synth" | "end";
type Point = { x: number; y: number };

const phaseDurations: Record<GraphPhase, number> = {
  0: 700, 1: 500, 2: 500, 3: 500, 4: 700, 5: 800,
  6: 500, 7: 600, 8: 700, 9: 1000, 10: 700, 11: 700, 12: 1200,
};

const VB = { w: 620, h: 520 };

const HALF: Record<NodeId, { hw: number; hh: number }> = {
  start: { hw: 44, hh: 15 },
  end: { hw: 44, hh: 15 },
  main: { hw: 64, hh: 27 },
  research: { hw: 54, hh: 21 },
  analysis: { hw: 54, hh: 21 },
  data: { hw: 54, hh: 21 },
  synth: { hw: 61, hh: 23 },
};

const INITIAL_POSITIONS: Record<NodeId, Point> = {
  start: { x: 310, y: 26 },
  main: { x: 310, y: 110 },
  research: { x: 150, y: 255 },
  analysis: { x: 310, y: 255 },
  data: { x: 470, y: 255 },
  synth: { x: 310, y: 390 },
  end: { x: 310, y: 480 },
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function fmt(n: number) {
  return Math.round(n * 10) / 10;
}

function edgePoint(positions: Record<NodeId, Point>, id: NodeId, side: "top" | "bottom" | "left" | "right", offset = 0): Point {
  const p = positions[id];
  const h = HALF[id];
  switch (side) {
    case "top": return { x: p.x + offset, y: p.y - h.hh };
    case "bottom": return { x: p.x + offset, y: p.y + h.hh };
    case "left": return { x: p.x - h.hw, y: p.y + offset };
    case "right": return { x: p.x + h.hw, y: p.y + offset };
  }
}

function verticalCurve(a: Point, b: Point, bend = 0.5) {
  const c1 = { x: a.x, y: a.y + (b.y - a.y) * bend };
  const c2 = { x: b.x, y: b.y - (b.y - a.y) * bend };
  return `M${fmt(a.x)},${fmt(a.y)} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`;
}

function bulgeLeftCurve(a: Point, b: Point, bulge = 150) {
  const bx = Math.max(24, Math.min(a.x, b.x) - bulge);
  const c1 = { x: bx, y: a.y + (b.y - a.y) * 0.25 };
  const c2 = { x: bx, y: a.y + (b.y - a.y) * 0.75 };
  return `M${fmt(a.x)},${fmt(a.y)} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`;
}

function computeEdges(pos: Record<NodeId, Point>) {
  const mainBottomL = edgePoint(pos, "main", "bottom", -34);
  const mainBottomC = edgePoint(pos, "main", "bottom", 0);
  const mainBottomR = edgePoint(pos, "main", "bottom", 34);
  const synthTopL = edgePoint(pos, "synth", "top", -34);
  const synthTopC = edgePoint(pos, "synth", "top", 0);
  const synthTopR = edgePoint(pos, "synth", "top", 34);
  return {
    startMain: verticalCurve(edgePoint(pos, "start", "bottom"), edgePoint(pos, "main", "top"), 0.6),
    mainResearch: verticalCurve(mainBottomL, edgePoint(pos, "research", "top"), 0.55),
    mainAnalysis: verticalCurve(mainBottomC, edgePoint(pos, "analysis", "top"), 0.55),
    mainData: verticalCurve(mainBottomR, edgePoint(pos, "data", "top"), 0.55),
    researchSynth: verticalCurve(edgePoint(pos, "research", "bottom"), synthTopL, 0.55),
    analysisSynth: verticalCurve(edgePoint(pos, "analysis", "bottom"), synthTopC, 0.55),
    dataSynth: verticalCurve(edgePoint(pos, "data", "bottom"), synthTopR, 0.55),
    synthEnd: verticalCurve(edgePoint(pos, "synth", "bottom"), edgePoint(pos, "end", "top"), 0.6),
    mainEndDirect: bulgeLeftCurve(edgePoint(pos, "main", "left", -8), edgePoint(pos, "end", "left"), 150),
  };
}

type EdgeKey = keyof ReturnType<typeof computeEdges>;

const EDGE_KIND: Record<EdgeKey, "main" | "research" | "analysis" | "data" | "synth"> = {
  startMain: "main",
  mainResearch: "research",
  mainAnalysis: "analysis",
  mainData: "data",
  researchSynth: "research",
  analysisSynth: "analysis",
  dataSynth: "data",
  synthEnd: "synth",
  mainEndDirect: "main",
};

function Particle({ path, kind, dur = "0.9s" }: { path: string; kind: string; dur?: string }) {
  return (
    <circle r="3.2" className={`home-particle home-particle-${kind}`}>
      <animateMotion dur={dur} repeatCount="1" fill="freeze" path={path} />
    </circle>
  );
}

type DragState = { id: NodeId; rect: DOMRect; startX: number; startY: number; origin: Point };

export function AgentNetwork() {
  const [phase, setPhase] = useState<GraphPhase>(0);
  const [positions, setPositions] = useState<Record<NodeId, Point>>(INITIAL_POSITIONS);
  const reducedMotion = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionsRef = useRef(positions);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const advance = (current: GraphPhase) => {
      timer = setTimeout(() => {
        const next = (current === 12 ? 0 : current + 1) as GraphPhase;
        setPhase(next);
        advance(next);
      }, phaseDurations[current]);
    };
    advance(0);
    return () => clearTimeout(timer);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const id = e.currentTarget.dataset.nodeId as NodeId;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id, rect, startX: e.clientX, startY: e.clientY, origin: positionsRef.current[id] };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const id = e.currentTarget.dataset.nodeId as NodeId;
    if (!d || d.id !== id) return;
    const scaleX = VB.w / d.rect.width;
    const scaleY = VB.h / d.rect.height;
    const dx = (e.clientX - d.startX) * scaleX;
    const dy = (e.clientY - d.startY) * scaleY;
    const half = HALF[id];
    const margin = 12;
    const nx = clamp(d.origin.x + dx, half.hw + margin, VB.w - half.hw - margin);
    const ny = clamp(d.origin.y + dy, half.hh + margin, VB.h - half.hh - margin);
    setPositions((p) => ({ ...p, [id]: { x: nx, y: ny } }));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const id = e.currentTarget.dataset.nodeId as NodeId;
    if (dragRef.current?.id === id) dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const dragProps = { onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp };

  const edges = computeEdges(positions);

  const directPath = phase >= 1 && phase <= 4;
  const delegatedPath = phase >= 6 && phase <= 12;
  const fanOut = phase >= 8 && phase <= 10;
  const subsWorking = phase === 9;

  const edgeActive = (name: EdgeKey) => {
    switch (name) {
      case "startMain": return phase === 1 || phase === 6;
      case "mainEndDirect": return phase === 3;
      case "mainResearch": case "mainAnalysis": case "mainData": return phase === 8;
      case "researchSynth": case "analysisSynth": case "dataSynth": return phase === 10;
      case "synthEnd": return phase === 12;
      default: return false;
    }
  };

  const mainStatus = phase === 2 ? "reasoning" : phase >= 7 && phase <= 11 ? "routing" : "ready";

  const pct = (id: NodeId) => ({ left: `${(positions[id].x / VB.w) * 100}%`, top: `${(positions[id].y / VB.h) * 100}%` });

  return (
    <div ref={containerRef} className="home-graph relative mx-auto aspect-[31/26] w-full max-w-[34rem]" aria-label="Abyss agent execution graph">
      <svg className="absolute inset-0 size-full" viewBox={`0 0 ${VB.w} ${VB.h}`} fill="none" aria-hidden="true">
        <defs>
          <marker id="home-graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
          </marker>
        </defs>

        {(Object.keys(edges) as EdgeKey[]).map((key) => (
          <path
            key={key}
            className={`home-edge home-edge-${EDGE_KIND[key]} ${edgeActive(key) ? "is-active" : ""}`}
            markerEnd="url(#home-graph-arrow)"
            d={edges[key]}
          />
        ))}

        {phase === 1 && <Particle key={`p-start-${phase}`} path={edges.startMain} kind="main" />}
        {phase === 6 && <Particle key={`p-start2-${phase}`} path={edges.startMain} kind="main" />}
        {phase === 3 && <Particle key={`p-direct-${phase}`} path={edges.mainEndDirect} kind="main" dur="1.1s" />}
        {phase === 8 && (
          <>
            <Particle key={`p-research-${phase}`} path={edges.mainResearch} kind="research" />
            <Particle key={`p-analysis-${phase}`} path={edges.mainAnalysis} kind="analysis" />
            <Particle key={`p-data-${phase}`} path={edges.mainData} kind="data" />
          </>
        )}
        {phase === 10 && (
          <>
            <Particle key={`p-rs-${phase}`} path={edges.researchSynth} kind="research" />
            <Particle key={`p-as-${phase}`} path={edges.analysisSynth} kind="analysis" />
            <Particle key={`p-ds-${phase}`} path={edges.dataSynth} kind="data" />
          </>
        )}
        {phase === 12 && <Particle key={`p-end-${phase}`} path={edges.synthEnd} kind="synth" />}
      </svg>

      <PillNode nodeId="start" style={pct("start")} drag={dragProps} active={phase === 1 || phase === 6} label="__start__" icon={UserRound} />
      <MainNode nodeId="main" style={pct("main")} drag={dragProps} active={phase >= 1 && phase <= 12} status={mainStatus} />
      <SubAgentNode nodeId="research" style={pct("research")} drag={dragProps} className="home-research" icon={Search} label="Research Agent" active={fanOut} working={subsWorking} />
      <SubAgentNode nodeId="analysis" style={pct("analysis")} drag={dragProps} className="home-analysis" icon={GitBranch} label="Analysis Agent" active={fanOut} working={subsWorking} />
      <SubAgentNode nodeId="data" style={pct("data")} drag={dragProps} className="home-data-agent" icon={Workflow} label="Data Agent" active={fanOut} working={subsWorking} />
      <GraphNode
        nodeId="synth"
        style={pct("synth")}
        drag={dragProps}
        className="home-synthesizer"
        active={phase >= 10 && phase <= 12}
        icon={Sparkles}
        label="Synthesizer"
        sublabel="Response Synthesis"
        status={phase === 11 ? "synthesizing" : phase === 10 ? "converging" : "waiting"}
      />
      <PillNode nodeId="end" style={pct("end")} drag={dragProps} active={phase === 4 || phase === 12} label="__end__" icon={Circle} success={phase === 4 || phase === 12} />

      <span className={`home-graph-caption home-graph-caption-direct ${directPath ? "is-active" : ""}`}>direct answer</span>
      <span className={`home-graph-caption home-graph-caption-delegate ${delegatedPath ? "is-active" : ""}`}>delegated · parallel</span>
    </div>
  );
}

type DragHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
};

function PillNode({ nodeId, style, drag, active, label, icon: Icon, success }: { nodeId: NodeId; style: React.CSSProperties; drag: DragHandlers; active: boolean; label: string; icon: typeof Circle; success?: boolean }) {
  return (
    <div data-node-id={nodeId} style={style} {...drag} className={`home-graph-node home-pill ${active ? "is-active" : ""} ${success ? "is-success" : ""}`}>
      <Icon className="home-graph-node-icon" />
      <strong>{label}</strong>
    </div>
  );
}

function MainNode({ nodeId, style, drag, active, status }: { nodeId: NodeId; style: React.CSSProperties; drag: DragHandlers; active: boolean; status: string }) {
  return (
    <div data-node-id={nodeId} style={style} {...drag} className={`home-graph-node home-main-agent ${active ? "is-active" : ""}`}>
      <Sparkles className="home-graph-node-icon" />
      <div>
        <strong>Main Agent</strong>
        <span>ReAct Orchestrator</span>
        <small><i /> {status}</small>
      </div>
    </div>
  );
}

function SubAgentNode({ nodeId, style, drag, className, icon: Icon, label, active, working }: { nodeId: NodeId; style: React.CSSProperties; drag: DragHandlers; className: string; icon: typeof Circle; label: string; active: boolean; working: boolean }) {
  return (
    <div data-node-id={nodeId} style={style} {...drag} className={`home-graph-node home-sub-agent ${className} ${active ? "is-active" : ""} ${working ? "is-working" : ""}`}>
      {working ? (
        <div className="home-mini-graph" aria-hidden="true">
          <i className="home-mini-node" />
          <span className="home-mini-edge" />
          <i className="home-mini-node home-mini-tool" />
          <span className="home-mini-edge" />
          <i className="home-mini-node" />
        </div>
      ) : (
        <Icon className="home-graph-node-icon" />
      )}
      <div>
        <strong>{label}</strong>
        <span>{working ? "using tools" : "ReAct Agent"}</span>
      </div>
    </div>
  );
}

function GraphNode({ nodeId, style, drag, className, active, icon: Icon, label, sublabel, status }: { nodeId: NodeId; style: React.CSSProperties; drag: DragHandlers; className: string; active: boolean; icon: typeof Circle; label: string; sublabel?: string; status?: string }) {
  return (
    <div data-node-id={nodeId} style={style} {...drag} className={`home-graph-node ${className} ${active ? "is-active" : ""}`}>
      <Icon className="home-graph-node-icon" />
      <div><strong>{label}</strong>{sublabel && <span>{sublabel}</span>}{status && <small><i /> {status}</small>}</div>
    </div>
  );
}

