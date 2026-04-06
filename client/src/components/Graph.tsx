import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { useStore, GraphNode, GraphEdge } from "../store";

interface FullGraphNode extends GraphNode {
  source?: "platform" | "private";
}

export default function Graph() {
  const { config, setOpenFile, setGraphMode, setActiveTab } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!svgRef.current) return;

    const vaultPath = config?.vault_path || "";
    fetch(`/api/graph/all?path=${encodeURIComponent(vaultPath)}`)
      .then(r => r.json())
      .then(({ nodes, edges }: { nodes: FullGraphNode[]; edges: GraphEdge[] }) => {
        setLoading(false);
        if (!nodes.length) { setError("No markdown files found."); return; }
        drawGraph(nodes, edges);
      })
      .catch(() => { setLoading(false); setError("Failed to load graph."); });
  }, [config?.vault_path]);

  const drawGraph = (nodes: FullGraphNode[], edges: GraphEdge[]) => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();

    const width = svgRef.current!.clientWidth || 800;
    const height = svgRef.current!.clientHeight || 600;

    // Compute in-degree
    const inDegree = new Map<string, number>();
    for (const n of nodes) inDegree.set(n.id, 0);
    for (const e of edges) {
      const t = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      inDegree.set(t, (inDegree.get(t) || 0) + 1);
    }
    for (const n of nodes) n.inDegree = inDegree.get(n.id) || 0;

    // Build source lookup for edges
    const nodeSourceMap = new Map<string, "platform" | "private">();
    for (const n of nodes) nodeSourceMap.set(n.id, n.source ?? "private");

    const nodeRadius = (n: FullGraphNode) => 6 + (n.inDegree || 0) * 3;

    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => nodeRadius(d) + 8));

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Arrow markers — one normal, one cross-section
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#555");
    defs.append("marker")
      .attr("id", "arrow-cross")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#c8a45a");

    const isCrossEdge = (e: GraphEdge) => {
      const sid = typeof e.source === "string" ? e.source : (e.source as FullGraphNode).id;
      const tid = typeof e.target === "string" ? e.target : (e.target as FullGraphNode).id;
      return nodeSourceMap.get(sid) !== nodeSourceMap.get(tid);
    };

    const link = g.append("g")
      .selectAll("line")
      .data(edges)
      .enter().append("line")
      .attr("stroke", (d) => isCrossEdge(d) ? "#c8a45a" : "#444")
      .attr("stroke-width", (d) => isCrossEdge(d) ? 1.5 : 1.5)
      .attr("stroke-dasharray", (d) => isCrossEdge(d) ? "5,3" : "none")
      .attr("marker-end", (d) => isCrossEdge(d) ? "url(#arrow-cross)" : "url(#arrow)");

    const nodeColor = (d: FullGraphNode) => {
      if (d.source === "platform") return "#c8a45a";
      return d.inDegree! > 0 ? "#007acc" : "#4a4a6a";
    };

    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .enter().append("g")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, FullGraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      )
      .on("click", (event, d) => {
        const apiPath = d.source === "platform"
          ? `/api/platform/file?path=${encodeURIComponent(d.path)}`
          : `/api/vault/file?path=${encodeURIComponent(d.path)}`;
        fetch(apiPath)
          .then(r => r.json())
          .then(data => {
            setOpenFile(d.path, data.content ?? "");
            setGraphMode(false);
            setActiveTab("kb");
          });
      });

    node.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => nodeColor(d))
      .attr("stroke", (d) => d.source === "platform" ? "#e8c47a" : "#888")
      .attr("stroke-width", 1);

    node.append("text")
      .text((d) => d.label)
      .attr("x", (d) => nodeRadius(d) + 4)
      .attr("y", "0.35em")
      .attr("fill", (d) => d.source === "platform" ? "#e8c47a" : "#ccc")
      .style("font-size", "11px")
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
      .style("max-width", "280px")
      .style("z-index", "9999");

    node
      .on("mouseenter", (event, d) => {
        const apiPath = d.source === "platform"
          ? `/api/platform/file?path=${encodeURIComponent(d.path)}`
          : `/api/vault/file?path=${encodeURIComponent(d.path)}`;
        fetch(apiPath)
          .then(r => r.json())
          .then(data => {
            const preview = (data.content || "").split("\n").slice(0, 3).join("\n");
            const badge = d.source === "platform"
              ? `<span style="font-size:9px;background:#3a2a00;color:#c8a45a;border-radius:2px;padding:1px 5px;margin-left:6px">PLATFORM</span>`
              : "";
            tooltip
              .style("display", "block")
              .style("left", (event.clientX + 12) + "px")
              .style("top", (event.clientY - 10) + "px")
              .html(`<strong>${d.label}</strong>${badge}<br><pre style="white-space:pre-wrap;margin:4px 0 0;color:#888">${preview}</pre>`);
          });
      })
      .on("mousemove", (event) => {
        tooltip.style("left", (event.clientX + 12) + "px").style("top", (event.clientY - 10) + "px");
      })
      .on("mouseleave", () => tooltip.style("display", "none"));

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      tooltip.remove();
      simulation.stop();
    };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1a1a2e" }}>
      <div style={{
        padding: "8px 16px",
        background: "#252526",
        borderBottom: "1px solid #333",
        fontSize: 11,
        color: "#888",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <span>Brain — scroll to zoom, drag nodes, click to open</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#c8a45a", display: "inline-block" }} />
            <span>Platform</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#007acc", display: "inline-block" }} />
            <span>Private</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 20, height: 2, background: "#c8a45a", display: "inline-block", borderTop: "2px dashed #c8a45a" }} />
            <span>Cross-link</span>
          </span>
        </span>
      </div>
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }}>
          Loading graph...
        </div>
      )}
      {error && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
          {error}
        </div>
      )}
      <svg ref={svgRef} style={{ flex: 1, width: "100%", display: loading || error ? "none" : "block" }} />
    </div>
  );
}
