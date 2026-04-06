import React, { useRef, useEffect } from "react";
import { useStore, HistoryEntry } from "../store";

export default function HistoryPanel() {
  const { chatHistory, scrollToTerminalLine, clearHistory } = useStore();
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll list to bottom when new entries arrive (scoped to this container only)
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chatHistory.length]);

  const handleClick = (entry: HistoryEntry) => {
    if (scrollToTerminalLine) {
      scrollToTerminalLine(Math.max(0, entry.line - 3));
    }
  };

  return (
    <div style={{
      width: 220,
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid #333",
      background: "#1a1a1a",
      flexShrink: 0,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        background: "#252526",
        borderBottom: "1px solid #333",
        flexShrink: 0,
        gap: 6,
      }}>
        <span style={{ color: "#888", fontSize: 10, flex: 1, textTransform: "uppercase", letterSpacing: 0.5 }}>
          History
        </span>
        {chatHistory.length > 0 && (
          <button
            onClick={clearHistory}
            title="Clear history"
            style={{
              background: "none", border: "none", color: "#555",
              cursor: "pointer", fontSize: 10, padding: "2px 4px",
              borderRadius: 2,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e07b53")}
            onMouseLeave={e => (e.currentTarget.style.color = "#555")}
          >
            Clear
          </button>
        )}
      </div>

      {/* Message list */}
      <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: "6px 0" }}>
        {chatHistory.length === 0 ? (
          <div style={{ color: "#444", fontSize: 10, padding: "16px 10px", textAlign: "center", lineHeight: 1.6 }}>
            Start a conversation in the terminal to see history here.
          </div>
        ) : (
          chatHistory.map((entry) => (
            <div
              key={entry.id}
              onClick={() => handleClick(entry)}
              title="Click to jump to this message in terminal"
              style={{
                cursor: "pointer",
                padding: "5px 8px",
                margin: "2px 6px",
                borderRadius: 4,
                borderLeft: `2px solid ${entry.role === "user" ? "#007acc" : "#608b4e"}`,
                background: entry.role === "user" ? "rgba(0,122,204,0.06)" : "rgba(96,139,78,0.06)",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background =
                  entry.role === "user" ? "rgba(0,122,204,0.15)" : "rgba(96,139,78,0.15)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background =
                  entry.role === "user" ? "rgba(0,122,204,0.06)" : "rgba(96,139,78,0.06)";
              }}
            >
              <div style={{
                fontSize: 9,
                color: entry.role === "user" ? "#4fc3f7" : "#81c784",
                marginBottom: 2,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontWeight: 600,
              }}>
                {entry.role === "user" ? "You" : "Claude"}
              </div>
              <div style={{
                fontSize: 10,
                color: "#bbb",
                lineHeight: 1.4,
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
                maxHeight: 60,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
              }}>
                {entry.text}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
