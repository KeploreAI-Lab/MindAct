import React, { useEffect, useRef } from "react";
import { useStore } from "../store";
import { createGraphRenderer } from "../graph_manager";
import type { GraphNode, GraphData, GraphRendererHandle, HighlightNode } from "../graph_manager";
import GraphLogDrawer from "./GraphLogDrawer";
import { t } from "../i18n";

interface GraphProps {
  compact?: boolean;
  onNodeOpen?: (path: string, content: string, readOnly: boolean) => void;
  onFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onBrainInspect?: () => void;
}

export default function Graph({
  compact, onNodeOpen, onFullscreen, onExitFullscreen, onBrainInspect,
}: GraphProps = {}) {
  const { config, setOpenFile, setGraphMode, setActiveTab } = useStore();
  const graphHighlights = useStore(s => s.graphHighlights);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<GraphRendererHandle | null>(null);
  const loadingRef = useRef(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  useEffect(() => {
    if (!svgRef.current) return;

    const vaultPath = config?.vault_path || "";
    fetch(`/api/graph/all?path=${encodeURIComponent(vaultPath)}`)
      .then(r => r.json())
      .then((data: GraphData) => {
        loadingRef.current = false;
        setLoading(false);
        if (!data.nodes?.length) { setError("No markdown files found."); return; }

        rendererRef.current?.destroy();
        rendererRef.current = createGraphRenderer(svgRef.current!, data, {
          onNodeClick: (node: GraphNode) => handleNodeClick(node),
        });
      })
      .catch(() => { setLoading(false); setError("Failed to load graph."); });

    return () => { rendererRef.current?.destroy(); };
  }, [config?.vault_path]);

  // Apply highlights whenever they change
  useEffect(() => {
    if (!rendererRef.current) return;
    if (graphHighlights.length === 0) {
      rendererRef.current.clearHighlights();
    } else {
      rendererRef.current.highlightNodes(graphHighlights as HighlightNode[]);
    }
  }, [graphHighlights]);

  const handleNodeClick = (node: GraphNode) => {
    const isPlatform = node.source === "platform";
    const apiPath = isPlatform
      ? `/api/platform/file?path=${encodeURIComponent(node.path)}`
      : `/api/vault/file?path=${encodeURIComponent(node.path)}`;

    fetch(apiPath)
      .then(r => r.json())
      .then(data => {
        if (compact && onNodeOpen) {
          onNodeOpen(node.path, data.content ?? "", isPlatform);
        } else {
          setOpenFile(node.path, data.content ?? "");
          setGraphMode(false);
          setActiveTab("kb");
        }
      });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1a1a2e", position: "relative" }}>
      <GraphToolbar
        compact={!!compact}
        onFullscreen={onFullscreen}
        onExitFullscreen={onExitFullscreen}
        onBrainInspect={onBrainInspect}
      />
      {loading && <CenteredMessage text="Loading graph..." />}
      {error && <CenteredMessage text={error} />}
      <svg
        ref={svgRef}
        style={{ flex: 1, width: "100%", display: loading || error ? "none" : "block" }}
      />
      {/* Log drawer — always mounted so it can receive events even when collapsed */}
      <GraphLogDrawer />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function GraphToolbar({ compact, onFullscreen, onExitFullscreen, onBrainInspect }: {
  compact: boolean;
  onFullscreen?: () => void;
  onExitFullscreen?: () => void;
  onBrainInspect?: () => void;
}) {
  const uiLanguage = useStore(s => s.uiLanguage);
  return (
    <div style={{
      padding: "8px 16px", background: "#252526", borderBottom: "1px solid #333",
      fontSize: 11, color: "#888", flexShrink: 0, display: "flex", alignItems: "center", gap: 16,
    }}>
      <span>{compact ? t(uiLanguage, "graph_toolbar_compact") : t(uiLanguage, "graph_toolbar_full")}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {!compact && (
          <>
            <Legend color="#c8a45a" label="Platform" />
            <Legend color="#007acc" label="Private" />
          </>
        )}
        {onBrainInspect && (
          <ToolbarButton onClick={onBrainInspect} accent>⬡ BrainInspect</ToolbarButton>
        )}
        {compact && onFullscreen && (
          <ToolbarButton onClick={onFullscreen}>⛶ {t(uiLanguage, "fullscreen")}</ToolbarButton>
        )}
        {!compact && onExitFullscreen && (
          <ToolbarButton onClick={onExitFullscreen}>← {t(uiLanguage, "exit_fullscreen")}</ToolbarButton>
        )}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
      <span>{label}</span>
    </span>
  );
}

function ToolbarButton({ onClick, children, accent }: {
  onClick: () => void; children: React.ReactNode; accent?: boolean;
}) {
  return (
    <button onClick={onClick} style={{
      background: accent ? "#1a1800" : "#2a2a3a",
      border: `1px solid ${accent ? "#c8a45a44" : "#3a3a5a"}`,
      borderRadius: 4,
      color: accent ? "#c8a45a" : "#aaa",
      cursor: "pointer", fontSize: 11, padding: "2px 8px",
    }}>
      {children}
    </button>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }}>
      {text}
    </div>
  );
}
