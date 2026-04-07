/**
 * Pure d3 rendering logic — no React, no fetch calls, no side effects beyond the SVG.
 * Receives data + callbacks, returns a destroy() handle.
 */

import * as d3 from "d3";
import type { GraphData, GraphNode, GraphEdge, GraphCallbacks, GraphRendererHandle, HighlightNode } from "./types";
import {
  nodeRadius, nodeColor, nodeStroke, nodeLabelColor,
  NODE_LABEL_FONT_SIZE, NODE_LABEL_OFFSET_X,
  EDGE_COLOR_NORMAL, EDGE_COLOR_CROSS, EDGE_WIDTH, EDGE_DASH_CROSS,
  ARROW_MARKER_ID, ARROW_MARKER_CROSS_ID,
  FORCE_LINK_DISTANCE, FORCE_CHARGE_STRENGTH, FORCE_COLLISION_PADDING, FORCE_DRAG_ALPHA_TARGET,
  ZOOM_MIN, ZOOM_MAX,
  TOOLTIP_PREVIEW_LINES, TOOLTIP_MAX_WIDTH,
} from "./config";

export function createGraphRenderer(
  svgEl: SVGSVGElement,
  data: GraphData,
  callbacks: GraphCallbacks = {}
): GraphRendererHandle {
  const { nodes, edges } = data;
  const { onNodeClick, onNodeHoverStart, onNodeHoverEnd } = callbacks;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const width = svgEl.clientWidth || 800;
  const height = svgEl.clientHeight || 600;

  // Compute in-degree
  const inDegreeMap = new Map<string, number>();
  for (const n of nodes) inDegreeMap.set(n.id, 0);
  for (const e of edges) {
    const tid = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
    inDegreeMap.set(tid, (inDegreeMap.get(tid) || 0) + 1);
  }
  for (const n of nodes) n.inDegree = inDegreeMap.get(n.id) || 0;

  const sourceMap = new Map<string, "platform" | "private">();
  for (const n of nodes) sourceMap.set(n.id, n.source ?? "private");

  // ── Simulation ─────────────────────────────────────────────────────────

  const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
    .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(FORCE_LINK_DISTANCE))
    .force("charge", d3.forceManyBody().strength(FORCE_CHARGE_STRENGTH))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((d: any) => nodeRadius(d) + FORCE_COLLISION_PADDING));

  // ── DOM ────────────────────────────────────────────────────────────────

  const g = svg.append("g");

  // Zoom
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .on("zoom", (event) => g.attr("transform", event.transform));
  svg.call(zoom);

  // Arrow markers
  const defs = svg.append("defs");
  appendArrow(defs, ARROW_MARKER_ID, "#555");
  appendArrow(defs, ARROW_MARKER_CROSS_ID, EDGE_COLOR_CROSS);

  // Edges
  const isCrossEdge = (e: GraphEdge) => {
    const sid = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
    const tid = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
    return sourceMap.get(sid) !== sourceMap.get(tid);
  };

  const link = g.append("g")
    .selectAll("line")
    .data(edges)
    .enter().append("line")
    .attr("stroke", (d) => isCrossEdge(d) ? EDGE_COLOR_CROSS : EDGE_COLOR_NORMAL)
    .attr("stroke-width", EDGE_WIDTH)
    .attr("stroke-dasharray", (d) => isCrossEdge(d) ? EDGE_DASH_CROSS : "none")
    .attr("marker-end", (d) => isCrossEdge(d) ? `url(#${ARROW_MARKER_CROSS_ID})` : `url(#${ARROW_MARKER_ID})`);

  // Nodes
  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .enter().append("g")
    .style("cursor", "pointer")
    .call(
      d3.drag<SVGGElement, GraphNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(FORCE_DRAG_ALPHA_TARGET).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
    )
    .on("click", (_event, d) => onNodeClick?.(d));

  node.append("circle")
    .attr("r", (d) => nodeRadius(d))
    .attr("fill", (d) => nodeColor(d))
    .attr("stroke", (d) => nodeStroke(d))
    .attr("stroke-width", 1);

  node.append("text")
    .text((d) => d.label)
    .attr("x", (d) => nodeRadius(d) + NODE_LABEL_OFFSET_X)
    .attr("y", "0.35em")
    .attr("fill", (d) => nodeLabelColor(d))
    .style("font-size", NODE_LABEL_FONT_SIZE)
    .style("pointer-events", "none");

  // Tooltip
  const tooltip = d3.select("body").append("div")
    .style("position", "fixed")
    .style("background", "#252526")
    .style("border", "1px solid #444")
    .style("border-radius", "4px")
    .style("padding", "8px 12px")
    .style("color", "#d4d4d4")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("display", "none")
    .style("max-width", TOOLTIP_MAX_WIDTH)
    .style("z-index", "9999");

  node
    .on("mouseenter", (event, d) => {
      onNodeHoverStart?.(d, event);
      tooltip.style("display", "block")
        .style("left", (event.clientX + 12) + "px")
        .style("top", (event.clientY - 10) + "px")
        .html(buildTooltipHtml(d));
    })
    .on("mousemove", (event) => {
      tooltip.style("left", (event.clientX + 12) + "px")
        .style("top", (event.clientY - 10) + "px");
    })
    .on("mouseleave", () => {
      onNodeHoverEnd?.();
      tooltip.style("display", "none");
    });

  // Tick
  simulation.on("tick", () => {
    link
      .attr("x1", (d: any) => d.source.x)
      .attr("y1", (d: any) => d.source.y)
      .attr("x2", (d: any) => d.target.x)
      .attr("y2", (d: any) => d.target.y);
    node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
  });

  // ── Highlight API ──────────────────────────────────────────────────────

  const highlightNodes = (highlights: HighlightNode[]) => {
    const hlMap = new Map(highlights.map(h => [h.id, h.status]));

    node.select("circle")
      .attr("stroke", (d: GraphNode) => {
        const status = hlMap.get(d.path);
        if (status === "found") return "#4ec9b0";
        if (status === "missing") return "#e05555";
        return nodeStroke(d);
      })
      .attr("stroke-width", (d: GraphNode) => hlMap.has(d.path) ? 3 : 1)
      .style("filter", (d: GraphNode) => {
        const status = hlMap.get(d.path);
        if (status === "found") return "drop-shadow(0 0 6px #4ec9b0aa)";
        if (status === "missing") return "drop-shadow(0 0 6px #e05555aa)";
        return "none";
      })
      .style("opacity", (d: GraphNode) => hlMap.size === 0 ? 1 : hlMap.has(d.path) ? 1 : 0.3);

    node.select("text")
      .style("opacity", (d: GraphNode) => hlMap.size === 0 ? 1 : hlMap.has(d.path) ? 1 : 0.3);
  };

  const clearHighlights = () => {
    node.select("circle")
      .attr("stroke", (d: GraphNode) => nodeStroke(d))
      .attr("stroke-width", 1)
      .style("filter", "none")
      .style("opacity", 1);
    node.select("text").style("opacity", 1);
  };

  // ── Cleanup ────────────────────────────────────────────────────────────

  return {
    destroy: () => {
      simulation.stop();
      tooltip.remove();
      svg.selectAll("*").remove();
    },
    highlightNodes,
    clearHighlights,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function appendArrow(
  defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  id: string,
  color: string
) {
  defs.append("marker")
    .attr("id", id)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", color);
}

function buildTooltipHtml(node: GraphNode): string {
  const badge = node.source === "platform"
    ? `<span style="font-size:9px;background:#3a2a00;color:#c8a45a;border-radius:2px;padding:1px 5px;margin-left:6px">PLATFORM</span>`
    : "";
  return `<strong>${node.label}</strong>${badge}`;
}
