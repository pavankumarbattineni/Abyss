"use client";

import { memo, useMemo } from "react";
import { useTheme } from "next-themes";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { FlowDirection, FlowShape, Flowchart } from "@/lib/flowchart";
import { cn } from "@/lib/utils";

type StepNodeData = {
  label: string;
  shape: FlowShape;
  direction: FlowDirection;
};
type GroupNodeData = { title: string };
type StepNode = Node<StepNodeData, "step">;
type GroupNode = Node<GroupNodeData, "group-box">;

const HANDLES: Record<FlowDirection, { target: Position; source: Position }> = {
  TB: { target: Position.Top, source: Position.Bottom },
  BT: { target: Position.Bottom, source: Position.Top },
  LR: { target: Position.Left, source: Position.Right },
  RL: { target: Position.Right, source: Position.Left },
};

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

/** One flowchart step: real HTML text, so it's never clipped. */
const StepNodeView = memo(function StepNodeView({
  data,
  selected,
}: NodeProps<StepNode>) {
  const { target, source } = HANDLES[data.direction];
  const isDiamond = data.shape === "diamond";
  return (
    <div className="relative flex size-full items-center justify-center">
      <Handle
        type="target"
        position={target}
        className={hiddenHandle}
        isConnectable={false}
      />
      {isDiamond && (
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            points="50,1 99,50 50,99 1,50"
            vectorEffect="non-scaling-stroke"
            className={cn(
              "fill-accent stroke-[1.5]",
              selected ? "stroke-highlight" : "stroke-sage-text",
            )}
          />
        </svg>
      )}
      <div
        className={cn(
          "relative z-10 px-3 py-2 text-center text-[13px] leading-[18px] whitespace-pre-line text-foreground",
          isDiamond
            ? "max-w-[75%] font-medium"
            : cn(
                "flex size-full items-center justify-center border bg-card shadow-xs",
                data.shape === "rect" ? "rounded-md" : "rounded-full",
                selected ? "border-highlight" : "border-sage-text/60",
              ),
        )}
      >
        {data.label}
      </div>
      <Handle
        type="source"
        position={source}
        className={hiddenHandle}
        isConnectable={false}
      />
    </div>
  );
});

/** A Mermaid subgraph: a labelled background box behind its steps. */
const GroupNodeView = memo(function GroupNodeView({
  data,
}: NodeProps<GroupNode>) {
  return (
    <div className="size-full rounded-lg border border-dashed border-border bg-muted/50">
      <p className="px-3 pt-1.5 text-xs font-medium text-muted-foreground">
        {data.title}
      </p>
    </div>
  );
});

const nodeTypes = { step: StepNodeView, "group-box": GroupNodeView };

interface FlowchartCanvasProps {
  flow: Flowchart;
  /** Full screen: wheel zooms. Inline: the page keeps scrolling under the
   * wheel; zoom with the buttons, pinch or Ctrl+wheel. */
  fullscreen?: boolean;
  className?: string;
}

/** A Mermaid flowchart as an interactive canvas: drag steps, pan, zoom. */
function FlowchartCanvasInner({
  flow,
  fullscreen = false,
  className,
}: FlowchartCanvasProps) {
  const { resolvedTheme } = useTheme();

  const nodes = useMemo<Node[]>(
    () => [
      ...flow.groups.map<GroupNode>((group) => ({
        id: group.id,
        type: "group-box",
        position: { x: group.x, y: group.y },
        data: { title: group.title },
        style: { width: group.width, height: group.height },
        zIndex: -1,
        selectable: false,
        draggable: false,
      })),
      ...flow.nodes.map<StepNode>((node) => ({
        id: node.id,
        type: "step",
        position: { x: node.x, y: node.y },
        data: {
          label: node.label,
          shape: node.shape,
          direction: flow.direction,
        },
        style: { width: node.width, height: node.height },
        ariaLabel: node.label,
      })),
    ],
    [flow],
  );

  const edges = useMemo<Edge[]>(
    () =>
      flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        label: edge.label,
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "var(--muted-foreground)",
        },
        style: {
          stroke: "var(--muted-foreground)",
          strokeWidth: 1.5,
          strokeDasharray: edge.dashed ? "5 4" : undefined,
        },
        labelStyle: {
          fill: "var(--foreground)",
          fontSize: 12,
          fontWeight: 500,
        },
        labelBgStyle: { fill: "var(--card)" },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
      })),
    [flow],
  );

  return (
    <div className={cn("abyss-flow size-full", className)}>
      <ReactFlow
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2.5}
        nodesConnectable={false}
        edgesFocusable={false}
        zoomOnScroll={fullscreen}
        preventScrolling={fullscreen}
        zoomOnDoubleClick
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export function FlowchartCanvas(props: FlowchartCanvasProps) {
  // Own provider: several diagrams can be on screen (and in a dialog) at once.
  return (
    <ReactFlowProvider>
      <FlowchartCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
