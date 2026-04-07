import React, { useState } from "react";
import type { AnalysisReport } from "../types/analysis";

interface Props {
  report: AnalysisReport;
  onExecute: (enrichedPrompt: string) => void;
  onDismiss: () => void;
  onAddKnowledge: () => void;
}

export default function DependencyReport({ report, onExecute, onDismiss, onAddKnowledge }: Props) {
  const [expanded, setExpanded] = useState(false);
  const levelConfig = {
    high:   { color: "#4ec9b0", label: "High", bg: "#0a2a20" },
    medium: { color: "#c8a45a", label: "Medium", bg: "#2a1800" },
    low:    { color: "#e05555", label: "Low", bg: "#2a0a0a" },
  }[report.confidenceLevel];

  return (
    <div style={{
      position: "absolute",
      bottom: 60,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(480px, 90%)",
      background: "#111118",
      border: `1px solid ${levelConfig.color}44`,
      borderRadius: 8,
      boxShadow: `0 4px 24px ${levelConfig.color}22`,
      zIndex: 100,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px",
        background: levelConfig.bg,
        borderBottom: `1px solid ${levelConfig.color}33`,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 11, color: "#888" }}>Analysis Report · {report.domain}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <ConfidenceBar score={report.confidence} color={levelConfig.color} />
          <span style={{
            fontSize: 12, fontWeight: 700, color: levelConfig.color,
            padding: "1px 8px", background: levelConfig.bg,
            border: `1px solid ${levelConfig.color}66`, borderRadius: 4,
          }}>
            {report.confidence}% · {levelConfig.label}
          </span>
        </div>
      </div>

      {/* Dependency list */}
      <div style={{ padding: "10px 14px" }}>
        {report.dependencies.length === 0 ? (
          <div style={{ padding: "6px 8px", background: "#1a0a00", borderRadius: 4, fontSize: 10, color: "#c8a45a" }}>
            ⚠ Could not identify specific dependencies from this task.<br />
            Consider adding domain knowledge to your KB, or execute directly.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
              Dependencies · {report.foundFiles.length} covered · {report.missingDeps.length} missing
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: expanded ? 240 : 130, overflowY: "auto" }}>
              {report.dependencies.map((dep, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "4px 6px", borderRadius: 4,
                  background: dep.coverage === "none" ? "#1a0808" : "#0a1a0a",
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                    {dep.coverage === "full" ? "✅" : dep.coverage === "partial" ? "🟡" : "❌"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: dep.coverage === "none" ? "#e05555" : "#ccc", fontWeight: 500 }}>
                      {dep.name}
                      {dep.level === "critical" && (
                        <span style={{ fontSize: 9, color: "#e05555", marginLeft: 6, verticalAlign: "middle" }}>required</span>
                      )}
                    </div>
                    {dep.coveredBy.length > 0 && (
                      <div style={{ fontSize: 9, color: "#4ec9b0", marginTop: 1 }}>
                        → {dep.coveredBy.join(", ")}
                      </div>
                    )}
                    {dep.coverage === "none" && (
                      <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>
                        Add to KB
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {report.dependencies.length > 4 && (
              <button onClick={() => setExpanded(!expanded)} style={linkBtn}>
                {expanded ? "Show less" : `Show all ${report.dependencies.length} items`}
              </button>
            )}
            {report.missingDeps.length > 0 && (
              <div style={{ marginTop: 8, padding: "6px 8px", background: "#1a0808", borderRadius: 4, fontSize: 10, color: "#e05555" }}>
                ❌ Missing: {report.missingDeps.join(", ")}
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{
        padding: "8px 14px",
        borderTop: "1px solid #1a1a2a",
        display: "flex",
        gap: 8,
        justifyContent: "flex-end",
      }}>
        <button onClick={onDismiss} style={ghostBtn}>Cancel</button>
        {report.missingDeps.length > 0 && (
          <button onClick={onAddKnowledge} style={secondaryBtn}>
            ✓ Knowledge added · Re-analyze
          </button>
        )}
        <button onClick={() => onExecute(report.enrichedPrompt)} style={primaryBtn(levelConfig.color)}>
          {report.confidenceLevel === "low" ? "⚠ Execute anyway" : "▶ Execute"}
        </button>
      </div>
    </div>
  );
}

function ConfidenceBar({ score, color }: { score: number; color: string }) {
  return (
    <div style={{ width: 60, height: 4, background: "#222", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "#555", cursor: "pointer",
  fontSize: 10, padding: "2px 0", marginTop: 4,
};
const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid #333", borderRadius: 4,
  color: "#666", cursor: "pointer", fontSize: 11, padding: "4px 12px",
};
const secondaryBtn: React.CSSProperties = {
  background: "#1a1800", border: "1px solid #c8a45a55", borderRadius: 4,
  color: "#c8a45a", cursor: "pointer", fontSize: 11, padding: "4px 12px",
};
const primaryBtn = (color: string): React.CSSProperties => ({
  background: color + "22", border: `1px solid ${color}88`, borderRadius: 4,
  color: color, cursor: "pointer", fontSize: 11, padding: "4px 14px", fontWeight: 600,
});
