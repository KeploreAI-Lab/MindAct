import React, { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
    }

    const ws = new WebSocket("ws://localhost:3001/ws/pty");
    wsRef.current = ws;

    ws.onopen = () => {
      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (term && fit) {
        fit.fit();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const term = termRef.current;
        if (!term) return;
        if (msg.type === "data") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln("\r\n\x1b[33m[Process exited. Click Restart to reconnect.]\x1b[0m");
        }
      } catch {}
    };

    ws.onclose = () => {
      // Auto-reconnect after 3s
      reconnectTimerRef.current = setTimeout(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) {
          connect();
        }
      }, 3000);
    };

    ws.onerror = () => {
      // will trigger onclose
    };
  }, []);

  const restart = useCallback(() => {
    const term = termRef.current;
    if (term) {
      term.clear();
      term.writeln("\x1b[90m[Restarting...]\x1b[0m");
    }
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
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        black: "#1e1e1e",
        red: "#f44747",
        green: "#608b4e",
        yellow: "#dcdcaa",
        blue: "#569cd6",
        magenta: "#c586c0",
        cyan: "#4ec9b0",
        white: "#d4d4d4",
        brightBlack: "#808080",
        brightRed: "#f44747",
        brightGreen: "#b5cea8",
        brightYellow: "#d7ba7d",
        brightBlue: "#9cdcfe",
        brightMagenta: "#c586c0",
        brightCyan: "#4ec9b0",
        brightWhite: "#ffffff",
        selectionBackground: "#264f78",
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    connect();

    const ro = new ResizeObserver(() => {
      if (fitAddon && term) {
        try {
          fitAddon.fit();
        } catch {}
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e" }}>
      {/* Terminal header */}
      <div style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        background: "#252526",
        borderBottom: "1px solid #333",
        flexShrink: 0,
        gap: 8,
      }}>
        <span style={{ color: "#888", fontSize: 11, flex: 1 }}>TERMINAL — Claude Code</span>
        <button
          onClick={restart}
          style={{
            background: "#3a3a3a",
            border: "1px solid #555",
            borderRadius: 3,
            color: "#ccc",
            cursor: "pointer",
            fontSize: 11,
            padding: "2px 10px",
          }}
        >
          Restart
        </button>
      </div>
      {/* Terminal container */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", padding: "4px 0 0 4px" }}
      />
    </div>
  );
}
