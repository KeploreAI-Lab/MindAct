import React, { useEffect, useRef, useCallback, useState, useLayoutEffect } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../store";

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[\d;]*[A-Za-z]/g, "").replace(/\x1B[()][AB012]/g, "").replace(/\x1B./g, "");
}

function Terminal() {
  const terminalBanner = useStore(s => s.terminalBanner);
  const setTerminalBanner = useStore(s => s.setTerminalBanner);
  const { addHistoryEntry, setScrollToTerminalLine } = useStore.getState();

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputBufferRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [inputValue, setInputValue] = useState("");
  const composingRef = useRef(false); // track IME composition state

  // Auto-resize textarea height
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [inputValue]);

  const histRef = useRef({
    lineCount: 0,
    assistantBuffer: "",
    waitingForAssistant: false,
    lastAssistantLine: 0,
    entryCounter: 0,
  });

  // Send raw data to PTY
  const sendToPty = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  // Submit user message from input box
  const submitInput = useCallback((text: string) => {
    const h = histRef.current;
    // Finalize pending assistant entry
    if (h.waitingForAssistant && h.assistantBuffer.trim()) {
      const preview = stripAnsi(h.assistantBuffer).replace(/\s+/g, " ").trim().slice(0, 300);
      if (preview) {
        addHistoryEntry({ id: h.entryCounter++, role: "assistant", text: preview, line: h.lastAssistantLine });
      }
      h.assistantBuffer = "";
    }
    if (text.trim()) {
      addHistoryEntry({ id: h.entryCounter++, role: "user", text: text.trim(), line: h.lineCount });
      h.waitingForAssistant = true;
      h.lastAssistantLine = h.lineCount;
      h.assistantBuffer = "";
    }
    // Send each character as a separate PTY write, same as original xterm key-by-key behavior.
    // Bundling into one string ("1\r") can confuse Ink's raw-mode input handlers.
    for (const ch of text) sendToPty(ch);
    sendToPty("\r");
  }, [sendToPty, addHistoryEntry]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Ignore Enter while IME is composing (e.g. selecting Chinese characters)
      if (composingRef.current) return;
      e.preventDefault();
      const val = inputValue.trim();
      if (val) {
        submitInput(val);
        setInputValue("");
      } else {
        // Empty Enter — forward raw \r so dialog confirmations / default selections work
        sendToPty("\r");
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); sendToPty("\x1b"); return; }
    if (e.key === "Tab")    { e.preventDefault(); sendToPty("\t");   return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); sendToPty("\x1b[A"); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); sendToPty("\x1b[B"); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); sendToPty("\x1b[D"); return; }
    if (e.key === "ArrowRight"){ e.preventDefault(); sendToPty("\x1b[C"); return; }
    if (e.ctrlKey) {
      if (e.key === "c") { e.preventDefault(); sendToPty("\x03"); }
      if (e.key === "d") { e.preventDefault(); sendToPty("\x04"); }
      if (e.key === "l") { e.preventDefault(); termRef.current?.clear(); }
    }
  }, [inputValue, submitInput, sendToPty]);

  // Paste handler: intercept files/images, insert absolute path
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files) as (File & { path?: string })[];
    const hasFiles = files.length > 0;
    const hasImage = files.some(f => f.type.startsWith("image/"));

    if (!hasFiles) return; // plain text — let browser handle it normally

    e.preventDefault();
    const paths: string[] = [];

    // Use preload-exposed Electron API to get real clipboard file paths
    const electronPaths: string[] = (window as any).electronAPI?.getClipboardFilePaths?.() ?? [];

    if (electronPaths.length > 0) {
      paths.push(...electronPaths);
    } else if (hasImage) {
      // In-memory screenshot (no real FS path) — save to temp
      for (const file of files.filter(f => f.type.startsWith("image/"))) {
        const ext = file.type.split("/")[1] || "png";
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/upload-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: base64, ext }),
        });
        const data = await res.json();
        paths.push(data.path);
      }
    }

    if (paths.length > 0) {
      const insert = paths.join(" ");
      setInputValue(v => v + (v && !v.endsWith(" ") ? " " : "") + insert + " ");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, []);

  // File picker: insert file path into textarea
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] as (File & { path?: string }) | undefined;
    if (!file) return;
    // In Electron, File objects have a .path property with the real FS path
    const filePath = file.path || file.name;
    setInputValue(v => v + (v && !v.endsWith(" ") ? " " : "") + filePath + " ");
    e.target.value = "";
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} }

    const ws = new WebSocket("ws://localhost:3001/ws/pty");
    wsRef.current = ws;

    ws.onopen = () => {
      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (term && fit) {
        fit.fit();
        // Tell PTY it has 3 fewer rows — Ink renders its input prompt in those rows,
        // which we cover with an overlay, hiding the duplicate prompt
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: Math.max(5, term.rows - 12) }));
      }
      setTimeout(() => textareaRef.current?.focus(), 100);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const term = termRef.current;
        if (!term) return;
        if (msg.type === "data") {
          // Buffer output for ~16ms so Ink's full re-render arrives as one batch,
          // preventing flicker from intermediate cursor-up/clear/redraw chunks
          outputBufferRef.current.push(msg.data);
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
          flushTimerRef.current = setTimeout(() => {
            const t = termRef.current;
            if (!t || outputBufferRef.current.length === 0) return;
            const data = outputBufferRef.current.join("");
            outputBufferRef.current = [];
            const h = histRef.current;
            const newlines = (data.match(/\n/g) || []).length;
            if (h.waitingForAssistant) h.assistantBuffer += data;
            h.lineCount += newlines;
            t.write(data, () => { t.scrollToBottom(); });
          }, 16);
        } else if (msg.type === "exit") {
          term.writeln("\r\n\x1b[33m[Process exited. Click Restart to reconnect.]\x1b[0m");
        }
      } catch {}
    };

    ws.onclose = () => {
      reconnectTimerRef.current = setTimeout(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
      }, 3000);
    };
  }, []);

  const restart = useCallback(() => {
    const term = termRef.current;
    if (term) { term.clear(); term.writeln("\x1b[90m[Restarting...]\x1b[0m"); }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "restart" }));
    } else {
      connect();
    }
  }, [connect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#1e1e1e",
        black: "#1e1e1e", red: "#f44747", green: "#608b4e", yellow: "#dcdcaa",
        blue: "#569cd6", magenta: "#c586c0", cyan: "#4ec9b0", white: "#d4d4d4",
        brightBlack: "#808080", brightRed: "#f44747", brightGreen: "#b5cea8",
        brightYellow: "#d7ba7d", brightBlue: "#9cdcfe", brightMagenta: "#c586c0",
        brightCyan: "#4ec9b0", brightWhite: "#ffffff", selectionBackground: "#264f78",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorWidth: 0,       // zero-width: hides xterm's own cursor (Ink's prompt still visible as text)
      scrollback: 5000,
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Inject CSS to hide xterm's cursor canvas layer entirely.
    // cursorWidth/cursorColor options are unreliable for bar-style cursors —
    // the only guaranteed way is to hide the dedicated canvas layer.
    const cursorStyle = document.createElement("style");
    cursorStyle.textContent = ".xterm-cursor-layer { display: none !important; }";
    document.head.appendChild(cursorStyle);

    setScrollToTerminalLine((line: number) => { termRef.current?.scrollToLine(line); });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows: Math.max(5, rows - 3) }));
      }
    });

    connect();

    const handleWindowFocus = () => setTimeout(() => textareaRef.current?.focus(), 50);
    window.addEventListener("focus", handleWindowFocus);

    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (fitTimer) clearTimeout(fitTimer);
      fitTimer = setTimeout(() => { try { fitAddon.fit(); } catch {} }, 100);
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (fitTimer) clearTimeout(fitTimer);
      window.removeEventListener("focus", handleWindowFocus);
      cursorStyle.remove();
      term.dispose();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      setScrollToTerminalLine(null);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", position: "relative" }}>

      {/* Floating banner */}
      {terminalBanner && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: "absolute", top: 40, left: 0, right: 0, zIndex: 10,
            margin: "8px 10px", background: "#1e3a5f", border: "1px solid #2d6a9f",
            borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center",
            gap: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
          <span style={{ fontSize: 13, color: "#89cff0", flex: 1 }}>
            💡 在终端里执行：
            <code style={{
              marginLeft: 8, background: "#0d2137", padding: "2px 8px",
              borderRadius: 4, fontFamily: "monospace", color: "#7dd3fc",
              userSelect: "text", cursor: "text",
            }}>{terminalBanner}</code>
          </span>
          <button onClick={() => navigator.clipboard.writeText(terminalBanner!)} style={smallBtnStyle}>复制</button>
          <button onClick={() => setTerminalBanner(null)} style={{ background: "none", border: "none", color: "#89cff0", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{ height: 32, display: "flex", alignItems: "center", padding: "0 12px", background: "#252526", borderBottom: "1px solid #333", flexShrink: 0, gap: 8 }}>
        <span style={{ color: "#888", fontSize: 11, flex: 1 }}>TERMINAL — Claude Code</span>
        <button onClick={restart} style={{ background: "#3a3a3a", border: "1px solid #555", borderRadius: 3, color: "#ccc", cursor: "pointer", fontSize: 11, padding: "2px 10px" }}>
          Restart
        </button>
      </div>

      {/* xterm output — display only, disableStdin */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }} onClick={() => textareaRef.current?.focus()}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0, padding: "4px 0 0 4px" }} />
        {/* Cover the bottom rows where Ink renders its own input prompt */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 240, background: "#1e1e1e", pointerEvents: "none" }} />
      </div>

      {/* Fixed multi-line input */}
      <div style={{ flexShrink: 0, background: "#1e1e1e", padding: "12px 16px 14px" }}>
        <div style={{
          background: "#2a2a2a",
          border: "1.5px solid #3a3a3a",
          borderRadius: 12,
          padding: "10px 14px",
          display: "flex", flexDirection: "column", gap: 8,
          boxShadow: "0 0 0 1px #007acc22, 0 4px 24px #00000066",
          transition: "border-color 0.15s",
        }}
          onFocusCapture={e => (e.currentTarget.style.borderColor = "#007acc88")}
          onBlurCapture={e => (e.currentTarget.style.borderColor = "#3a3a3a")}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <span style={{ color: "#007acc", fontSize: 16, fontFamily: "monospace", flexShrink: 0, paddingBottom: 2 }}>❯</span>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onPaste={handlePaste}
              placeholder="给 Claude 发消息…"
              autoFocus
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#e0e0e0", fontSize: 14, resize: "none", lineHeight: 1.6,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
                caretColor: "#007acc", minHeight: 24, maxHeight: 200, overflowY: "auto",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              title="上传文件或图片"
              style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1, borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
              onMouseLeave={e => (e.currentTarget.style.color = "#555")}
            >📎</button>
            <span style={{ flex: 1 }} />
            <span style={{ color: "#3a3a3a", fontSize: 10 }}>Shift+Enter 换行 · Enter 发送</span>
          </div>
        </div>
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileChange} />
      </div>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  background: "#2d6a9f", border: "none", color: "#fff",
  cursor: "pointer", fontSize: 11, borderRadius: 3,
  padding: "3px 8px", flexShrink: 0,
};

export default React.memo(Terminal);
