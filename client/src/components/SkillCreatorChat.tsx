import React, { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../store";
import type { HistoryEntry } from "../store";

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[\d;]*[A-Za-z]/g, "").replace(/\x1B[()][AB012]/g, "").replace(/\x1B./g, "");
}

export default function SkillCreatorChat() {
  const skillCreatorChatTarget = useStore(s => s.skillCreatorChatTarget);
  const setSkillCreatorChatOpen = useStore(s => s.setSkillCreatorChatOpen);
  const setPendingTerminalInput = useStore(s => s.setPendingTerminalInput);
  const chatHistory = useStore(s => s.chatHistory);

  const defaultMessage = `Let's create a skill for ${skillCreatorChatTarget ?? "this"} together using your skill-creator skill. First ask me what the skill should do.`;

  const [inputValue, setInputValue] = useState(defaultMessage);
  const [installing, setInstalling] = useState(false);
  const [sessionStartId, setSessionStartId] = useState<number>(-1);
  const [pos, setPos] = useState({ x: window.innerWidth - 444, y: window.innerHeight - 450 });
  const [minimized, setMinimized] = useState(false);

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const firstSentRef = useRef(false);

  // Auto-scroll to bottom when new messages arrive
  const sessionMessages: HistoryEntry[] = chatHistory.filter(e => e.id > sessionStartId);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionMessages.length]);

  // Drag handlers
  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const newX = Math.max(0, Math.min(window.innerWidth - 420, e.clientX - dragOffsetRef.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffsetRef.current.y));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || installing) return;

    // On first send, check/install skill-creator then invoke
    if (!firstSentRef.current) {
      setInstalling(true);
      try {
        const listRes = await fetch("/api/registry/list?query=skill-creator&limit=5");
        const listData = await listRes.json() as { items?: { id?: string; name: string; installedAt?: string }[] };
        const items = listData.items ?? [];
        const alreadyInstalled = items.find(
          i => (i.id === "skill-creator" || i.name.toLowerCase().includes("skill-creator")) && i.installedAt
        );
        if (!alreadyInstalled) {
          const installRes = await fetch("/api/registry/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "skill-creator" }),
          });
          const installData = await installRes.json() as { installed?: boolean; error?: string };
          if (!installRes.ok || !installData.installed) {
            console.warn("skill-creator install failed:", installData.error);
            // Proceed anyway — agent may already have it or handle gracefully
          }
        }
      } catch (err) {
        console.warn("skill-creator check failed:", err);
      } finally {
        setInstalling(false);
      }

      // Capture session start from current chatHistory length before sending
      const currentIds = useStore.getState().chatHistory;
      const maxId = currentIds.length > 0 ? Math.max(...currentIds.map(e => e.id)) : -1;
      setSessionStartId(maxId);
      firstSentRef.current = true;
    }

    setInputValue("");
    setPendingTerminalInput(text);
  }, [inputValue, installing, setPendingTerminalInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClose = useCallback(() => {
    setSkillCreatorChatOpen(false);
  }, [setSkillCreatorChatOpen]);

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: 420,
        zIndex: 200,
        background: "#111118",
        border: "1px solid #2a2a3a",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'JetBrains Mono', Menlo, monospace",
      }}
    >
      {/* Title bar / drag handle */}
      <div
        onMouseDown={handleTitleMouseDown}
        style={{
          padding: "8px 12px",
          borderBottom: minimized ? "none" : "1px solid #242436",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "grab",
          background: "#16161e",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#4ec9b0", fontSize: 11, fontWeight: 600, flex: 1 }}>
          ✦ Create with Agent
        </span>
        {skillCreatorChatTarget && (
          <span style={{ color: "#666", fontSize: 10, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {skillCreatorChatTarget}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setMinimized(v => !v); }}
          title={minimized ? "Expand" : "Minimize"}
          style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}
        >
          {minimized ? "□" : "─"}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          title="Close"
          style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </button>
      </div>

      {!minimized && (
        <>
          {/* Messages area */}
          <div
            style={{
              height: 260,
              overflowY: "auto",
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {sessionMessages.length === 0 && (
              <div style={{ color: "#555", fontSize: 11, textAlign: "center", marginTop: 80 }}>
                Edit the message below and click Send to start
              </div>
            )}
            {sessionMessages.map(entry => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: entry.role === "user" ? "flex-end" : "flex-start",
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 9, color: "#555", marginBottom: 1 }}>
                  {entry.role === "user" ? "you" : "agent"}
                </span>
                <div
                  style={{
                    maxWidth: "85%",
                    background: entry.role === "user" ? "#1a2a1a" : "#1a1a2a",
                    border: `1px solid ${entry.role === "user" ? "#4ec9b033" : "#7c7ccc33"}`,
                    borderRadius: entry.role === "user" ? "8px 8px 2px 8px" : "8px 8px 8px 2px",
                    padding: "6px 10px",
                    fontSize: 11,
                    color: "#d4d4d4",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {stripAnsi(entry.text)}
                </div>
              </div>
            ))}
            {installing && (
              <div style={{ color: "#c8a45a", fontSize: 10, textAlign: "center" }}>
                ⬇ Installing skill-creator…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div
            style={{
              borderTop: "1px solid #242436",
              padding: "8px 10px",
              display: "flex",
              gap: 6,
              alignItems: "flex-end",
              background: "#0f0f16",
              flexShrink: 0,
            }}
          >
            <textarea
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={installing}
              rows={3}
              style={{
                flex: 1,
                background: "#1a1a24",
                border: "1px solid #2a2a3a",
                borderRadius: 6,
                color: "#d4d4d4",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', Menlo, monospace",
                lineHeight: 1.5,
                padding: "6px 8px",
                resize: "none",
                outline: "none",
              }}
              placeholder="Message…"
            />
            <button
              onClick={handleSend}
              disabled={installing || !inputValue.trim()}
              style={{
                background: installing || !inputValue.trim() ? "#1a1a2a" : "#0d2a1a",
                border: `1px solid ${installing || !inputValue.trim() ? "#2a2a3a" : "#4ec9b055"}`,
                borderRadius: 6,
                color: installing || !inputValue.trim() ? "#555" : "#4ec9b0",
                cursor: installing || !inputValue.trim() ? "default" : "pointer",
                fontSize: 11,
                fontWeight: 600,
                padding: "6px 12px",
                whiteSpace: "nowrap",
                alignSelf: "stretch",
              }}
            >
              {installing ? "…" : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
