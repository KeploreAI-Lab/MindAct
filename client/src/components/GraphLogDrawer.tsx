import React, { useEffect, useRef } from "react";
import { useStore } from "../store";
import { t } from "../i18n";

export default function GraphLogDrawer() {
  const logEntries = useStore(s => s.logEntries);
  const logDrawerOpen = useStore(s => s.logDrawerOpen);
  const setLogDrawerOpen = useStore(s => s.setLogDrawerOpen);
  const analysisRunning = useStore(s => s.analysisRunning);
  const ghostNodes = useStore(s => s.ghostNodes);
  const config = useStore(s => s.config);
  const uiLanguage = useStore(s => s.uiLanguage);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEntries]);

  return (
    <div style={{
      position: "absolute",
      top: 44,
      right: 16,
      width: 280,
      zIndex: 20,
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      pointerEvents: "none",
    }}>
      {/* Log panel — slides down/up */}
      <div style={{
        background: "rgba(10, 10, 20, 0.82)",
        backdropFilter: "blur(8px)",
        border: "1px solid #2a2a3a",
        borderRadius: 8,
        overflow: "hidden",
        maxHeight: logDrawerOpen ? 220 : 0,
        opacity: logDrawerOpen ? 1 : 0,
        transition: "max-height 0.25s ease, opacity 0.2s ease",
        pointerEvents: logDrawerOpen ? "auto" : "none",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "5px 10px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexShrink: 0,
        }}>
          {analysisRunning && (
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "#c8a45a",
              animation: "pulse 1s infinite",
              flexShrink: 0,
            }} />
          )}
          <span style={{ fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: 1 }}>
            {t(uiLanguage, "analysis_log")}
          </span>
        </div>

        {/* Entries */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "6px 10px",
          fontFamily: "monospace",
        }}>
          {logEntries.length === 0 ? (
            <div style={{ fontSize: 10, color: "#333" }}>{t(uiLanguage, "waiting_analysis")}</div>
          ) : (
            logEntries.map(entry => (
              <div key={entry.id} style={{
                fontSize: 10,
                color: entryColor(entry.text),
                lineHeight: 1.6,
                marginBottom: 1,
                wordBreak: "break-word",
              }}>
                {entry.text}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Toggle button — below the panel */}
      <button
        onClick={() => setLogDrawerOpen(!logDrawerOpen)}
        title={logDrawerOpen ? t(uiLanguage, "collapse") : t(uiLanguage, "log")}
        style={{
          pointerEvents: "auto",
          alignSelf: "flex-end",
          marginTop: 4,
          background: "rgba(10, 10, 20, 0.75)",
          backdropFilter: "blur(6px)",
          border: "1px solid #2a2a3a",
          borderRadius: 6,
          color: logDrawerOpen ? "#c8a45a" : "#444",
          cursor: "pointer",
          fontSize: 11,
          padding: "3px 8px",
          display: "flex",
          alignItems: "center",
          gap: 4,
          transition: "color 0.2s",
        }}
      >
        {logDrawerOpen ? `▲ ${t(uiLanguage, "collapse")}` : `▼ ${t(uiLanguage, "log")}`}
      </button>

      {/* Ghost nodes — missing deps, click to create */}
      {ghostNodes.length > 0 && (
        <div style={{
          pointerEvents: "auto",
          marginTop: 8,
          background: "rgba(10, 10, 20, 0.82)",
          backdropFilter: "blur(8px)",
          border: "1px solid #e0555533",
          borderRadius: 8,
          padding: "8px 10px",
        }}>
          <div style={{ fontSize: 9, color: "#e05555aa", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
            {t(uiLanguage, "missing_knowledge_click_create")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {ghostNodes.map(({ name, template }) => (
              <button
                key={name}
                onClick={() => useStore.getState().openGhostNode(name, config?.vault_path ?? "", template)}
                style={{
                  background: "none",
                  border: "1.5px dashed #e05555",
                  borderRadius: 20,
                  color: "#e05555",
                  cursor: "pointer",
                  fontSize: 10,
                  padding: "4px 10px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textAlign: "left",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "#e0555518")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>○</span>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function entryColor(text: string): string {
  if (text.startsWith("✅") || text.startsWith("✓")) return "#4ec9b0";
  if (text.startsWith("❌") || text.startsWith("⚠")) return "#e05555";
  if (text.startsWith("📊")) return "#c8a45a";
  if (text.startsWith("  📄")) return "#7ec8e3";
  return "#555";
}
