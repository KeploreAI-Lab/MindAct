import React, { useEffect, useRef, useCallback, useState, useLayoutEffect } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../store";
import { t } from "../i18n";
import type { AnalysisReport } from "../types/analysis";
import DependencyReport from "./DependencyReport";

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[\d;]*[A-Za-z]/g, "").replace(/\x1B[()][AB012]/g, "").replace(/\x1B./g, "");
}

function Terminal() {
  const terminalBanner = useStore(s => s.terminalBanner);
  const setTerminalBanner = useStore(s => s.setTerminalBanner);
  const { addHistoryEntry, setScrollToTerminalLine, setIsThinking } = useStore.getState();
  const isThinking = useStore(s => s.isThinking);

  const uiLanguage = useStore(s => s.uiLanguage);
  const analysisMode = useStore(s => s.analysisMode);
  const analysisRunning = useStore(s => s.analysisRunning);
  const analysisModeRef = useRef(analysisMode);
  const analysisRunningRef = useRef(analysisRunning);
  useEffect(() => { analysisModeRef.current = analysisMode; }, [analysisMode]);
  useEffect(() => { analysisRunningRef.current = analysisRunning; }, [analysisRunning]);
  const { setAnalysisMode, setAnalysisRunning, addLogEntry, clearLog, setGraphHighlights, clearGraphHighlights, setGhostNodes, clearGhostNodes, setLogDrawerOpen } = useStore.getState();

  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(null);
  const [createdSkillPathForReport, setCreatedSkillPathForReport] = useState<string | null>(null);
  const [skillDraftOpen, setSkillDraftOpen] = useState(false);
  const [skillDraftName, setSkillDraftName] = useState("");
  const [skillDraftContent, setSkillDraftContent] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillTemplateLoading, setSkillTemplateLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compatibilityModeRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputBufferRef = useRef<string[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [inputValue, setInputValue] = useState("");
  const composingRef = useRef(false); // track IME composition state
  const lastAnalysisTaskRef = useRef<string>("");
  const analysisAbortRef = useRef<AbortController | null>(null);

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
      setIsThinking(true);
    }
    // Send each character as a separate PTY write, same as original xterm key-by-key behavior.
    // Bundling into one string ("1\r") can confuse Ink's raw-mode input handlers.
    for (const ch of text) sendToPty(ch);
    sendToPty("\r");
  }, [sendToPty, addHistoryEntry]);

  const runDependencyAnalysis = useCallback(async (task: string) => {
    lastAnalysisTaskRef.current = task;
    analysisAbortRef.current?.abort();
    const abort = new AbortController();
    analysisAbortRef.current = abort;

    setAnalysisRunning(true);
    setAnalysisReport(null);
    setCreatedSkillPathForReport(null);
    clearLog();
    clearGraphHighlights();
    clearGhostNodes();
    setLogDrawerOpen(true);

    const lang = useStore.getState().uiLanguage;
    try {
      const res = await fetch("/api/dm/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, lang }),
        signal: abort.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const event = JSON.parse(line) as { type: string; data: unknown };
            if (event.type === "log") {
              addLogEntry(event.data as string);
            } else if (event.type === "highlight") {
              const hl = event.data as { nodes: { id: string; status: "found" | "missing" }[] };
              setGraphHighlights(hl.nodes);
            } else if (event.type === "ghost") {
              const gh = event.data as { nodes: { name: string; template: string }[] };
              setGhostNodes(gh.nodes);
            } else if (event.type === "report") {
              setAnalysisReport(event.data as AnalysisReport);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if ((err as any)?.name === "AbortError") {
        addLogEntry("⏹ Analysis stopped");
      } else {
        addLogEntry(`❌ Connection failed: ${err?.message}`);
      }
    } finally {
      setAnalysisRunning(false);
    }
  }, []);

  const openSkillDraft = useCallback(async (report: AnalysisReport) => {
    if (skillTemplateLoading) return;
    setSkillTemplateLoading(true);
    try {
      addLogEntry("🧠 Generating skill template from current knowledge...");
      const res = await fetch("/api/skills/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: report.task,
          domain: report.domain,
          dependencies: report.dependencies,
          foundFiles: report.foundFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.content) {
        addLogEntry(`❌ Skill template generation failed: ${data?.error ?? "unknown error"}`);
        return;
      }
      const suggested = report.domain && report.domain !== "skill" ? `${report.domain}-skill` : "generated-skill";
      setSkillDraftName(suggested);
      setSkillDraftContent(data.content);
      setSkillDraftOpen(true);
    } catch (err: any) {
      addLogEntry(`❌ Skill template generation failed: ${err?.message ?? String(err)}`);
    } finally {
      setSkillTemplateLoading(false);
    }
  }, [skillTemplateLoading]);

  const saveSkillDraft = useCallback(async () => {
    if (!skillDraftName.trim() || !skillDraftContent.trim()) return;
    setSkillSaving(true);
    try {
      const res = await fetch("/api/skills/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: skillDraftName, content: skillDraftContent }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        addLogEntry(`❌ Skill save failed: ${data?.error ?? "unknown error"}`);
        return;
      }
      addLogEntry(`✅ Skill saved: ${data.path}`);
      setSkillDraftOpen(false);
      setSkillDraftContent("");
      setSkillDraftName("");
      setCreatedSkillPathForReport(data.path);
      setTerminalBanner(`✓ Skill saved: ${data.path}`);
    } catch (err: any) {
      addLogEntry(`❌ Skill save failed: ${err?.message ?? String(err)}`);
    } finally {
      setSkillSaving(false);
    }
  }, [skillDraftName, skillDraftContent]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Ignore Enter while IME is composing (e.g. selecting Chinese characters)
      if (composingRef.current) return;
      e.preventDefault();
      const val = inputValue.trim();
      if (val) {
        if (analysisModeRef.current && !analysisRunningRef.current) {
          // Intercept: run dependency analysis before sending to Claude
          runDependencyAnalysis(val);
          setInputValue("");
        } else {
          submitInput(val);
          setInputValue("");
        }
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
      if (wsRef.current !== ws) return;
      compatibilityModeRef.current = false;
      if (exitNoticeTimerRef.current) {
        clearTimeout(exitNoticeTimerRef.current);
        exitNoticeTimerRef.current = null;
      }
      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (term && fit) {
        fit.fit();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: Math.max(5, term.rows) }));
      }
      setTimeout(() => textareaRef.current?.focus(), 100);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        const term = termRef.current;
        if (!term) return;
        if (msg.type === "data") {
          if (typeof msg.data === "string" && msg.data.includes("PTY unavailable")) {
            compatibilityModeRef.current = true;
            if (exitNoticeTimerRef.current) {
              clearTimeout(exitNoticeTimerRef.current);
              exitNoticeTimerRef.current = null;
            }
          }

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
            // Detect when CLI returns to prompt — bracketed-paste enable is sent
            // right before the input prompt is drawn (standard for Ink/readline CLIs).
            // Also catch the plain "> " / "? " prompt fallback.
            const stripped = stripAnsi(data);
            if (
              data.includes("\x1b[?2004h") ||
              /\n[>?]\s*$/.test(stripped) ||
              /\r[>?]\s/.test(stripped)
            ) {
              setIsThinking(false);
            }
            t.write(data, () => { t.scrollToBottom(); });
          }, 16);
        } else if (msg.type === "exit") {
          setIsThinking(false);
          // Delay notice a bit; if compatibility fallback message arrives, suppress it.
          if (exitNoticeTimerRef.current) clearTimeout(exitNoticeTimerRef.current);
          exitNoticeTimerRef.current = setTimeout(() => {
            if (!compatibilityModeRef.current) {
              term.writeln("\r\n\x1b[33m[Process exited. Click Restart to reconnect.]\x1b[0m");
            }
          }, 800);
        }
      } catch {}
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      reconnectTimerRef.current = setTimeout(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
      }, 3000);
    };
  }, []);

  const restart = useCallback(() => {
    setIsThinking(false);
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
      disableStdin: false,
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
        wsRef.current.send(JSON.stringify({ type: "resize", cols, rows: Math.max(5, rows) }));
      }
    });
    // Let xterm forward raw keys directly to PTY so TUI navigation works.
    term.onData((data) => sendToPty(data));

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
      if (exitNoticeTimerRef.current) clearTimeout(exitNoticeTimerRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
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
          {terminalBanner!.startsWith("!") ? (
            <>
              <span style={{ fontSize: 13, color: "#89cff0", flex: 1 }}>
                {t(uiLanguage, "terminal_run_hint")}{" "}
                <code style={{
                  marginLeft: 8, background: "#0d2137", padding: "2px 8px",
                  borderRadius: 4, fontFamily: "monospace", color: "#7dd3fc",
                  userSelect: "text", cursor: "text",
                }}>{terminalBanner!.slice(1)}</code>
              </span>
              <button onClick={() => navigator.clipboard.writeText(terminalBanner!.slice(1))} style={smallBtnStyle}>{t(uiLanguage, "copy")}</button>
            </>
          ) : (
            <span style={{ fontSize: 13, color: "#4ec9b0", flex: 1 }}>
              {terminalBanner}
            </span>
          )}
          <button onClick={() => setTerminalBanner(null)} style={{ background: "none", border: "none", color: "#89cff0", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
      )}

      {/* Header */}
      <div style={{ height: 32, display: "flex", alignItems: "center", padding: "0 12px", background: "#252526", borderBottom: "1px solid #333", flexShrink: 0, gap: 8 }}>
        <span style={{ color: "#888", fontSize: 11 }}>TERMINAL — PhysMind</span>
        <span style={{ flex: 1 }} />
        {isThinking && (
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#4ec9b0" }}>
            <span style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ec9b0", animation: "thinkPulse 1.2s ease-in-out infinite" }} />
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ec9b0", animation: "thinkPulse 1.2s ease-in-out 0.2s infinite" }} />
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ec9b0", animation: "thinkPulse 1.2s ease-in-out 0.4s infinite" }} />
            </span>
            Thinking
          </span>
        )}
        <button onClick={restart} style={{ background: "#3a3a3a", border: "1px solid #555", borderRadius: 3, color: "#ccc", cursor: "pointer", fontSize: 11, padding: "2px 10px" }}>
          Restart
        </button>
      </div>

      {/* xterm output — display only, disableStdin */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }} onClick={() => termRef.current?.focus()}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0, padding: "4px 0 0 4px" }} />
      </div>

      {/* Dependency Analysis Report (floats above input) */}
      {analysisReport && (
        <DependencyReport
          report={analysisReport}
          onExecute={(enrichedPrompt) => {
            if (analysisReport?.matchedSkill) {
              const { name, score } = analysisReport.matchedSkill;
              const pct = Math.round(score * 100);
              termRef.current?.write(`\r\n\x1b[36m[MindAct] ✓ Skill loaded: ${name} (${pct}%)\x1b[0m\r\n`);
            }
            submitInput(enrichedPrompt);
            setAnalysisReport(null);
            setCreatedSkillPathForReport(null);
            clearGraphHighlights();
          }}
          onExecuteRaw={(rawTask) => {
            submitInput(rawTask);
            setAnalysisReport(null);
            setCreatedSkillPathForReport(null);
            clearGraphHighlights();
          }}
          onApplyCreatedSkill={(rawTask) => {
            const path = createdSkillPathForReport;
            const lang = useStore.getState().uiLanguage;
            const prompt = path
              ? t(lang, "apply_created_skill_prompt", { path, task: rawTask })
              : rawTask;
            submitInput(prompt);
            setAnalysisReport(null);
            setCreatedSkillPathForReport(null);
            clearGraphHighlights();
          }}
          onDismiss={() => {
            setAnalysisReport(null);
            setCreatedSkillPathForReport(null);
            clearGraphHighlights();
          }}
          onAddKnowledge={() => {
            setAnalysisReport(null);
            clearGraphHighlights();
            clearGhostNodes();
            if (lastAnalysisTaskRef.current) {
              runDependencyAnalysis(lastAnalysisTaskRef.current);
            }
          }}
          onCreateSkill={(report) => { openSkillDraft(report); }}
          createdSkillReady={!!createdSkillPathForReport}
          creatingSkill={skillTemplateLoading}
        />
      )}

      {skillDraftOpen && (
        <div style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            width: "min(920px, 95%)",
            height: "min(82vh, 760px)",
            background: "#111118",
            border: "1px solid #2a2a3a",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #242436", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#c8a45a", fontSize: 12, fontWeight: 600 }}>Skill Template</span>
              <input
                value={skillDraftName}
                onChange={e => setSkillDraftName(e.target.value)}
                placeholder="skill name"
                style={{ marginLeft: "auto", width: 260, background: "#1a1a24", border: "1px solid #34344a", color: "#ddd", borderRadius: 4, padding: "4px 8px", fontSize: 12 }}
              />
            </div>
            <textarea
              value={skillDraftContent}
              onChange={e => setSkillDraftContent(e.target.value)}
              style={{
                flex: 1,
                background: "#0f0f16",
                color: "#d4d4d4",
                border: "none",
                outline: "none",
                resize: "none",
                padding: 12,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', Menlo, monospace",
                lineHeight: 1.5,
              }}
            />
            <div style={{ padding: "10px 12px", borderTop: "1px solid #242436", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setSkillDraftOpen(false)} style={ghostBtnStyle}>Cancel</button>
              <button onClick={saveSkillDraft} disabled={skillSaving} style={smallBtnStyle}>
                {skillSaving ? "Saving..." : "Save to skills-test"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed multi-line input */}
      <div style={{ flexShrink: 0, background: "#1e1e1e", padding: "12px 16px 14px", position: "relative" }}>
        <div style={{
          background: analysisMode ? "#1a1400" : "#2a2a2a",
          border: `1.5px solid ${analysisMode ? "#c8a45a88" : "#3a3a3a"}`,
          borderRadius: 12,
          padding: "10px 14px",
          display: "flex", flexDirection: "column", gap: 8,
          boxShadow: analysisMode
            ? "0 0 0 1px #c8a45a22, 0 4px 24px #c8a45a11"
            : "0 0 0 1px #007acc22, 0 4px 24px #00000066",
          transition: "border-color 0.2s, background 0.2s, box-shadow 0.2s",
        }}
          onFocusCapture={e => (e.currentTarget.style.borderColor = analysisMode ? "#c8a45acc" : "#007acc88")}
          onBlurCapture={e => (e.currentTarget.style.borderColor = analysisMode ? "#c8a45a88" : "#3a3a3a")}
        >
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <span style={{
              color: analysisMode ? "#c8a45a" : "#007acc",
              fontSize: 16, fontFamily: "monospace", flexShrink: 0, paddingBottom: 2,
            }}>❯</span>
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onPaste={handlePaste}
              placeholder={analysisMode ? "Enter task — dependencies will be analyzed automatically…" : "Message PhysMind…"}
              autoFocus
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: analysisMode ? "#e8d4a0" : "#e0e0e0",
                fontSize: 14, resize: "none", lineHeight: 1.6,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
                caretColor: analysisMode ? "#c8a45a" : "#007acc",
                minHeight: 24, maxHeight: 200, overflowY: "auto",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t(uiLanguage, "upload_file")}
              style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1, borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
              onMouseLeave={e => (e.currentTarget.style.color = "#555")}
            >📎</button>
            <span style={{ flex: 1 }} />
            {analysisRunning && (
              <span style={{ fontSize: 10, color: "#c8a45a", animation: "fadeInOut 1.2s infinite" }}>
                ⟳ Analyzing...
              </span>
            )}
            {/* Stop button — sends Ctrl+C to PTY */}
            <button
              onClick={() => { sendToPty("\x03"); analysisAbortRef.current?.abort(); }}
              title="Stop Agent (Ctrl+C)"
              style={{
                background: "none",
                border: "1px solid #3a3a3a",
                borderRadius: 4,
                color: "#666",
                cursor: "pointer",
                fontSize: 10,
                padding: "1px 7px",
                display: "flex",
                alignItems: "center",
                gap: 3,
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#e05555"; e.currentTarget.style.color = "#e05555"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#3a3a3a"; e.currentTarget.style.color = "#666"; }}
            >
              ⏹ Stop
            </button>
            <span style={{ color: "#3a3a3a", fontSize: 10 }}>Shift+Enter new line · Enter send</span>
            <button
              onClick={() => {
                setAnalysisMode(!analysisMode);
                if (analysisMode) {
                  clearGraphHighlights();
                  setAnalysisReport(null);
                }
              }}
              title={analysisMode ? "Disable analysis mode" : "Enable analysis mode"}
              style={{
                background: analysisMode ? "#c8a45a" : "none",
                border: `1px solid ${analysisMode ? "#c8a45a" : "#3a3a3a"}`,
                borderRadius: 20,
                color: analysisMode ? "#1a1000" : "#555",
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 8px 2px 6px",
                display: "flex",
                alignItems: "center",
                gap: 4,
                letterSpacing: 0.3,
                boxShadow: analysisMode ? "0 0 8px #c8a45a55" : "none",
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 11 }}>⬡</span>
              Analysis {analysisMode ? "ON" : "OFF"}
            </button>
          </div>
        </div>
        <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileChange} />

      </div>

      <style>{`
        @keyframes fadeInOut { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes thinkPulse { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  background: "#2d6a9f", border: "none", color: "#fff",
  cursor: "pointer", fontSize: 11, borderRadius: 3,
  padding: "3px 8px", flexShrink: 0,
};

const ghostBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #444",
  color: "#bbb",
  cursor: "pointer",
  fontSize: 11,
  borderRadius: 3,
  padding: "3px 10px",
};

export default React.memo(Terminal);
