import React, { useState, useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

// Split MD into sections; the adjacency section is identified by heading
function splitSections(md: string) {
  const ADJ_HEADING = "## 依赖关系图（邻接表）";
  const idx = md.indexOf(ADJ_HEADING);
  if (idx === -1) return [{ type: "editable" as const, text: md }];

  // Find end of adjacency section (next ## heading after the code block)
  const after = md.indexOf("\n## ", idx + ADJ_HEADING.length);
  const adjEnd = after === -1 ? md.length : after;

  return [
    { type: "editable" as const, text: md.slice(0, idx) },
    { type: "readonly" as const, text: md.slice(idx, adjEnd) },
    { type: "editable" as const, text: after === -1 ? "" : md.slice(adjEnd) },
  ].filter(s => s.text.trim() !== "" || s.type === "editable");
}

function joinSections(sections: { type: string; text: string }[]): string {
  return sections.map(s => s.text).join("");
}

// Render MD adjacency section as HTML (code block inside)
function ReadonlySection({ text }: { text: string }) {
  // Extract code block content
  const codeMatch = text.match(/```([\s\S]*?)```/);
  const codeContent = codeMatch ? codeMatch[1].trim() : "";
  const headingMatch = text.match(/^(#+\s+.+)/m);
  const heading = headingMatch ? headingMatch[1].replace(/^#+\s+/, "") : "依赖关系图（邻接表）";
  const warningMatch = text.match(/> (.+)/);
  const warning = warningMatch ? warningMatch[1] : "";

  const lines = codeContent.split("\n");

  return (
    <div style={{ margin: "0 0 0", background: "#1a1a1a", border: "1px solid #3a2a00", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", background: "#2a1800", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#c8a45a" }}>## {heading}</span>
        <span style={{ fontSize: 10, background: "#3a2a00", color: "#e05555", borderRadius: 3, padding: "1px 6px", marginLeft: "auto" }}>🔒 只读 · 系统自动生成</span>
      </div>
      {warning && (
        <div style={{ padding: "6px 14px", background: "#1e1400", fontSize: 11, color: "#888", borderBottom: "1px solid #2a2a2a" }}>
          ⚠ {warning}
        </div>
      )}
      <div style={{ padding: "12px 14px", overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
        {lines.map((line, i) => {
          if (!line.trim()) return <div key={i} style={{ height: 6 }} />;
          if (line.startsWith("#")) return (
            <div key={i} style={{ fontSize: 11, fontWeight: 700, color: "#c8a45a", marginTop: 10, marginBottom: 4 }}>{line}</div>
          );
          const [src, ...rest] = line.split("→");
          if (rest.length) {
            const targets = rest.join("→").trim().split(",").map(t => t.trim());
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3, fontSize: 11, fontFamily: "monospace" }}>
                <span style={{ color: "#9cdcfe", minWidth: 180, flexShrink: 0 }}>{src.trim()}</span>
                <span style={{ color: "#555" }}>→</span>
                <span>
                  {targets.map((t, ti) => (
                    <span key={ti}>
                      <span style={{ color: "#4ec9b0" }}>{t}</span>
                      {ti < targets.length - 1 && <span style={{ color: "#555" }}>, </span>}
                    </span>
                  ))}
                </span>
              </div>
            );
          }
          return <div key={i} style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>{line}</div>;
        })}
      </div>
    </div>
  );
}

export default function BrainInspect({ onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [sections, setSections] = useState<{ type: "editable" | "readonly"; text: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [urlMsg, setUrlMsg] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/brain-index")
      .then(r => r.json())
      .then(d => {
        if (d.content) {
          setContent(d.content);
          setSections(splitSections(d.content));
        }
      });
  }, []);

  const generate = () => {
    setGenerating(true);
    fetch("/api/brain-index/generate", { method: "POST" })
      .then(r => r.json())
      .then(d => {
        setContent(d.content);
        setSections(splitSections(d.content));
        setGenerating(false);
      });
  };

  const updateSection = (idx: number, text: string) => {
    const next = sections.map((s, i) => i === idx ? { ...s, text } : s);
    setSections(next);
    const full = joinSections(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch("/api/brain-index", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: full }) })
        .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
    }, 800);
  };

  const reloadPlatformTree = () => {
    fetch("/api/platform/tree").then(r => r.json()).then(data => {
      if (Array.isArray(data)) (window as any).__physmindSetPlatformTree?.(data);
    });
  };

  const loadUrl = () => {
    const val = urlInput.trim();
    if (!val) return;
    setLoadingUrl(true);
    setUrlMsg("");

    const isLocal = val.startsWith("/") || val.startsWith("~") || val.startsWith(".") ||
      /^[A-Za-z]:[\\\/]/.test(val); // Windows absolute path e.g. C:\...
    const endpoint = isLocal ? "/api/platform/load-local" : "/api/platform/load-url";
    const body = isLocal ? { path: val } : { url: val };

    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json())
      .then(d => {
        setLoadingUrl(false);
        if (d.ok) {
          setUrlMsg(isLocal
            ? `✓ 已导入 ${d.count} 个文件`
            : `✓ 已加载为 Platform 文件：${d.name}`);
          setUrlInput("");
          reloadPlatformTree();
        } else {
          setUrlMsg("❌ " + (d.error || "未知错误"));
        }
      })
      .catch(e => { setLoadingUrl(false); setUrlMsg("❌ " + e.message); });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "#0d0d14", display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", padding: "0 20px",
        height: 44, background: "#1a1a2e", borderBottom: "1px solid #2a2a4a", flexShrink: 0, gap: 12,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#c8a45a", letterSpacing: 0.5 }}>⬡ Brain Inspect</span>
        <span style={{ fontSize: 11, color: "#555" }}>— 知识图谱索引</span>
        <div style={{ flex: 1 }} />
        {saved && <span style={{ fontSize: 11, color: "#4ec9b0" }}>✓ 已保存</span>}
        <button
          onClick={generate}
          disabled={generating}
          style={{ background: "#2a1800", border: "1px solid #c8a45a", borderRadius: 4, color: "#c8a45a", cursor: "pointer", fontSize: 11, padding: "3px 12px" }}
        >{generating ? "生成中…" : "⟳ 重新生成"}</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Main editor */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {!content && !generating && (
            <div style={{ textAlign: "center", paddingTop: 80 }}>
              <div style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>尚未生成索引</div>
              <button onClick={generate} style={{ background: "#007acc", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 13, padding: "8px 24px" }}>
                ⟳ 自动生成 Brain Index
              </button>
            </div>
          )}
          {generating && (
            <div style={{ textAlign: "center", paddingTop: 80, color: "#888" }}>正在分析 Platform 和 Private 文件…</div>
          )}
          {!generating && sections.map((s, i) =>
            s.type === "readonly" ? (
              <ReadonlySection key={i} text={s.text} />
            ) : (
              <textarea
                key={i}
                value={s.text}
                onChange={e => updateSection(i, e.target.value)}
                style={{
                  background: "#141420", border: "1px solid #2a2a3a", borderRadius: 6,
                  color: "#d4d4d4", fontSize: 12, lineHeight: 1.7, padding: "12px 14px",
                  resize: "none", outline: "none", fontFamily: "'JetBrains Mono', monospace",
                  minHeight: s.text.split("\n").length * 20 + 24,
                }}
                spellCheck={false}
              />
            )
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ width: 260, background: "#111118", borderLeft: "1px solid #2a2a3a", padding: "16px", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0, overflowY: "auto" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#7ec8e3", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>加载 Platform 内容</div>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>输入本地目录路径或远程 .md URL，导入为 Platform 模块</div>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") loadUrl(); }}
              placeholder="/path/to/dir 或 https://..."
              style={{ background: "#1a1a2a", border: "1px solid #333", borderRadius: 4, color: "#d4d4d4", fontSize: 11, padding: "5px 8px", outline: "none", width: "100%", boxSizing: "border-box" }}
            />
            <button
              onClick={loadUrl}
              disabled={loadingUrl || !urlInput.trim()}
              style={{ marginTop: 6, width: "100%", background: "#1a3a5a", border: "1px solid #007acc", borderRadius: 4, color: "#7ec8e3", cursor: "pointer", fontSize: 11, padding: "5px 0", opacity: loadingUrl ? 0.6 : 1 }}
            >{loadingUrl ? "加载中…" : "导入"}</button>
            {urlMsg && <div style={{ marginTop: 6, fontSize: 10, color: urlMsg.startsWith("✓") ? "#4ec9b0" : "#e05555" }}>{urlMsg}</div>}
          </div>

          <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>说明</div>
            <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 6 }}>• 蓝色区域可自由编辑（标题、描述、检索说明）</div>
              <div style={{ marginBottom: 6 }}>• <span style={{ color: "#c8a45a" }}>橙色锁定区域</span>为系统自动生成的邻接表，不可手动编辑</div>
              <div style={{ marginBottom: 6 }}>• 点击「重新生成」后系统重新分析所有文件链接</div>
              <div>• 内容保存至 <code style={{ color: "#4ec9b0" }}>~/.physmind/BRAIN_INDEX.md</code></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
