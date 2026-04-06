import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { useStore, GraphNode, GraphEdge } from "../store";

export default function Graph() {
  const { config, setOpenFile, setGraphMode } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!config?.vault_path || !svgRef.current) return;

    fetch(`/api/vault/links?path=${encodeURIComponent(config.vault_path)}`)
      .then(r => r.json())
      .then(({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
        setLoading(false);
        if (!nodes.length) { setError("No markdown files found."); return; }
        drawGraph(nodes, edges);
      })
      .catch(() => { setLoading(false); setError("Failed to load graph."); });
  }, [config?.vault_path]);

  const drawGraph = (nodes: GraphNode[], edges: GraphEdge[]) => {
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

    const nodeRadius = (n: GraphNode) => 6 + (n.inDegree || 0) * 3;

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

    // Arrow marker
    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#555");

    const link = g.append("g")
      .selectAll("line")
      .data(edges)
      .enter().append("line")
      .attr("stroke", "#444")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow)");

    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .enter().append("g")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
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
        fetch(`/api/vault/file?path=${encodeURIComponent(d.path)}`)
          .then(r => r.json())
          .then(data => {
            setOpenFile(d.path, data.content ?? "");
            setGraphMode(false);
          });
      });

    node.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => d.inDegree! > 0 ? "#007acc" : "#4a4a6a")
      .attr("stroke", "#888")
      .attr("stroke-width", 1);

    node.append("text")
      .text((d) => d.label)
      .attr("x", (d) => nodeRadius(d) + 4)
      .attr("y", "0.35em")
      .attr("fill", "#ccc")
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
        fetch(`/api/vault/file?path=${encodeURIComponent(d.path)}`)
          .then(r => r.json())
          .then(data => {
            const preview = (data.content || "").split("\n").slice(0, 3).join("\n");
            tooltip
              .style("display", "block")
              .style("left", (event.clientX + 12) + "px")
              .style("top", (event.clientY - 10) + "px")
              .html(`<strong>${d.label}</strong><br><pre style="white-space:pre-wrap;margin:4px 0 0;color:#888">${preview}</pre>`);
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
      }}>
        Knowledge Graph — scroll to zoom, drag nodes, click to open
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
