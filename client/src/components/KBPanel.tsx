import React, { useState, useCallback, useRef } from "react";
import { useStore } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";
import Graph from "./Graph";
import { TreeNode } from "../store";

async function pickDir(): Promise<string | null> {
  const api = (window as any).electronAPI;
  if (api?.pickFolder) {
    const result = await api.pickFolder();
    if (!result.canceled && result.filePaths?.length) return result.filePaths[0];
    return null;
  }
  // Fallback to server-side AppleScript
  const res = await fetch("/api/pick-dir");
  const data = await res.json();
  return data.path ?? null;
}

async function checkDir(path: string): Promise<boolean> {
  const res = await fetch(`/api/check-dir?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  return data.exists;
}

type OpenFileSource = "platform" | "private";

export default function KBPanel({ onFullscreenBrain, onBrainInspect }: { onFullscreenBrain?: () => void; onBrainInspect?: () => void }) {
  const {
    vaultTree, platformTree,
    openFilePath, openFileContent, setOpenFile,
    searchQuery, setSearchQuery,
    config, setConfig, setVaultTree, setTerminalBanner,
    kbViewMode, setKbViewMode,
  } = useStore();

  const [editorHeight, setEditorHeight] = useState(60);
  const [pathInput, setPathInput] = useState(config?.vault_path ?? "");
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(true);
  const [privateOpen, setPrivateOpen] = useState(true);
  const [openFileSource, setOpenFileSource] = useState<OpenFileSource>("private");
  const [graphKey, setGraphKey] = useState(0);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketResults, setMarketResults] = useState<any[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const marketTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newFileName, setNewFileName] = useState<string | null>(null); // null=hidden, string=input shown
  const composingNewFile = useRef(false);
  const viewMode = kbViewMode;
  const setViewMode = setKbViewMode;
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);

  const pendingGhostFile = useStore(s => s.pendingGhostFile);
  const clearPendingGhostFile = useStore(s => s.clearPendingGhostFile);

  const loadVault = useCallback((path: string) => {
    fetch(`/api/vault/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setVaultTree(data); });
  }, [setVaultTree]);

  const saveVaultPath = useCallback(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const exists = await checkDir(trimmed);
    if (!exists) { setPathError("Folder not found. Create it?"); setCreating(true); return; }
    setPathError(null);
    setCreating(false);
    const newConfig = { ...(config ?? { project_path: "", panel_ratio: 0.45 }), vault_path: trimmed };
    await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newConfig) });
    setConfig(newConfig);
    loadVault(trimmed);
    const folderName = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    setTerminalBanner(`✓ 已将「${folderName}」决策依赖导入 Private`);
  }, [config, setConfig, loadVault]);

  const handleBrowse = useCallback(async () => {
    const picked = await pickDir();
    if (picked) { setPathInput(picked); setPathError(null); setCreating(false); await saveVaultPath(picked); }
  }, [saveVaultPath]);

  const handleCreateDir = useCallback(async () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    await fetch("/api/create-dir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: trimmed }) });
    await saveVaultPath(trimmed);
    setCreating(false);
  }, [pathInput, saveVaultPath]);

  // Open a platform file (read-only)
  const openPlatformFile = useCallback((node: TreeNode) => {
    if (node.type !== "file") return;
    fetch(`/api/platform/file?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(data => { setOpenFile(node.path, data.content ?? ""); setOpenFileSource("platform"); });
  }, [setOpenFile]);

  // Open a private file (editable)
  const openPrivateFile = useCallback((node: TreeNode) => {
    if (node.type !== "file") return;
    fetch(`/api/vault/file?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(data => { setOpenFile(node.path, data.content ?? ""); setOpenFileSource("private"); });
  }, [setOpenFile]);

  const handleSave = useCallback((content: string) => {
    if (!openFilePath || openFileSource === "platform") return;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: openFilePath, content }) });
  }, [openFilePath, openFileSource]);

  // Save a ghost (pending) file for the first time
  const [ghostEditorContent, setGhostEditorContent] = useState<string | null>(null);
  const handleGhostSave = useCallback((content: string) => {
    if (!openFilePath || !config?.vault_path) return;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: openFilePath, content }) })
      .then(() => {
        clearPendingGhostFile();
        setOpenFileSource("private");
        loadVault(config.vault_path);
        setGraphKey(k => k + 1);
        setGhostEditorContent(null);
      });
  }, [openFilePath, config, clearPendingGhostFile, loadVault]);

  // Generate AI suggestion for a ghost file
  const handleAiSuggest = useCallback(async () => {
    if (!pendingGhostFile || !openFilePath) return;
    setAiSuggestLoading(true);
    try {
      const res = await fetch("/api/dm/suggest-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: pendingGhostFile.name, currentContent: ghostEditorContent ?? openFileContent ?? "" }),
      });
      const data = await res.json() as { content: string };
      setOpenFile(openFilePath, data.content);
      setGhostEditorContent(data.content);
    } finally {
      setAiSuggestLoading(false);
    }
  }, [pendingGhostFile, openFilePath, ghostEditorContent, openFileContent, setOpenFile]);

  // Handle [[link]] — search both trees; cross-section links use {{ }} syntax
  const handleLinkClick = useCallback((name: string) => {
    function findFile(nodes: TreeNode[]): TreeNode | null {
      for (const n of nodes) {
        if (n.type === "file" && n.name.replace(/\.md$/, "").toLowerCase() === name.toLowerCase()) return n;
        if (n.children) { const found = findFile(n.children); if (found) return found; }
      }
      return null;
    }
    // Search private first, then platform
    const inPrivate = findFile(vaultTree);
    if (inPrivate) { openPrivateFile(inPrivate); return; }
    const inPlatform = findFile(platformTree);
    if (inPlatform) { openPlatformFile(inPlatform); return; }
  }, [vaultTree, platformTree, openPrivateFile, openPlatformFile]);

  // {{ link }} cross-section link click — same resolution but marks as cross-section
  const handleCrossLinkClick = useCallback((name: string) => {
    handleLinkClick(name); // same resolution, different visual style in editor
  }, [handleLinkClick]);

  const searchMarket = useCallback((q: string) => {
    if (marketTimerRef.current) clearTimeout(marketTimerRef.current);
    marketTimerRef.current = setTimeout(() => {
      fetch(`/api/platform/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(data => { setMarketResults(data); setMarketOpen(true); });
    }, 300);
  }, []);

  const installModule = useCallback((id: string) => {
    setInstalling(id);
    fetch("/api/platform/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      .then(r => r.json())
      .then(() => {
        setInstalling(null);
        setMarketResults(prev => prev.map(m => m.id === id ? { ...m, installed: true } : m));
        // Reload platform tree
        fetch("/api/platform/tree").then(r => r.json()).then(data => { if (Array.isArray(data)) useStore.getState().setPlatformTree(data); });
        setGraphKey(k => k + 1);
      });
  }, []);

  const createNewPrivateFile = () => setNewFileName("");

  const confirmNewFile = () => {
    const name = (newFileName ?? "").trim();
    if (!name || !config?.vault_path) { setNewFileName(null); return; }
    const path = `${config.vault_path}/${name}.md`;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: `# ${name}\n\n` }) })
      .then(() => { loadVault(config.vault_path); setOpenFile(path, `# ${name}\n\n`); setOpenFileSource("private"); setGraphKey(k => k + 1); setNewFileName(null); });
  };

  const allFiles = [...platformTree, ...vaultTree];
  const isReadOnly = openFileSource === "platform";
  const editorVaultFiles = vaultTree;
  const editorPlatformFiles = platformTree;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── View toggle + Search bar ── */}
      <div style={{ padding: "6px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #2a2a2a", alignItems: "center" }}>
        {/* Toggle buttons */}
        <div style={{ display: "flex", background: "#1a1a1a", borderRadius: 5, border: "1px solid #333", flexShrink: 0 }}>
          <button
            onClick={() => setViewMode("files")}
            title="文件浏览"
            style={{ background: viewMode === "files" ? "#007acc" : "none", border: "none", borderRadius: "4px 0 0 4px", color: viewMode === "files" ? "#fff" : "#666", cursor: "pointer", fontSize: 13, padding: "3px 8px", lineHeight: 1 }}
          >☰</button>
          <button
            onClick={() => setViewMode("brain")}
            title="Brain 图谱"
            style={{ background: viewMode === "brain" ? "#007acc" : "none", border: "none", borderRadius: "0 4px 4px 0", color: viewMode === "brain" ? "#fff" : "#666", cursor: "pointer", fontSize: 13, padding: "3px 8px", lineHeight: 1 }}
          >⛓</button>
        </div>
        {viewMode === "files" && (
          <>
            <span style={{ color: "#555", fontSize: 13, lineHeight: "24px" }}>🔍</span>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search all files…" style={{ ...inputStyle, flex: 1 }} />
          </>
        )}
        {viewMode === "brain" && config?.vault_path && (
          <button onClick={createNewPrivateFile} title="新建 Private 文件" style={{ ...plusBtnStyle, marginLeft: "auto", fontSize: 18, color: "#7ec8e3" }}>+</button>
        )}
      </div>

      {viewMode === "brain" ? (
        /* ── Brain Graph (compact) ── */
        <div style={{ flex: openFilePath ? "0 0 45%" : "1", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {newFileName !== null && (
            <div style={{ display: "flex", padding: "4px 8px", gap: 4, borderBottom: "1px solid #2a2a2a", background: "#111", flexShrink: 0 }}>
              <input
                autoFocus
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onCompositionStart={() => { composingNewFile.current = true; }}
                onCompositionEnd={() => { composingNewFile.current = false; }}
                onKeyDown={e => { if (e.key === "Enter" && !composingNewFile.current) confirmNewFile(); if (e.key === "Escape") setNewFileName(null); }}
                placeholder="文件名 (不含 .md)"
                style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "3px 6px" }}
              />
              <button onClick={confirmNewFile} style={smallBtn}>✓</button>
              <button onClick={() => setNewFileName(null)} style={{ ...smallBtn, background: "#555" }}>✕</button>
            </div>
          )}
          <Graph
            key={graphKey}
            compact
            onNodeOpen={(path, content, readOnly) => {
              setOpenFile(path, content);
              setOpenFileSource(readOnly ? "platform" : "private");
            }}
            onFullscreen={onFullscreenBrain}
            onBrainInspect={onBrainInspect}
          />
        </div>
      ) : (

        /* ── Horizontal two-column tree ── */
        <div style={{ flex: openFilePath ? "0 0 38%" : "1", display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>

          {/* Platform column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #2a2a2a", overflow: "hidden", minWidth: 0 }}>
            <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, background: "#1a1a1a", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#c8a45a", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 }}>Platform</span>
              <span title="Read-only — server provided" style={{ fontSize: 10, color: "#555" }}>🔒</span>
            </div>
            {/* Marketplace search */}
            <div style={{ padding: "4px 6px", borderBottom: "1px solid #2a2a2a", flexShrink: 0, position: "relative" }}>
              <input
                value={marketSearch}
                onChange={e => { setMarketSearch(e.target.value); searchMarket(e.target.value); }}
                onFocus={() => { if (!marketOpen) searchMarket(marketSearch); }}
                placeholder="🔍 搜索能力模块…"
                style={{ ...inputStyle, fontSize: 10, padding: "3px 6px", width: "100%" }}
              />
              {marketOpen && marketResults.length > 0 && (
                <div style={{
                  position: "absolute", left: 6, right: 6, top: "100%", zIndex: 200,
                  background: "#1e1e1e", border: "1px solid #3a3a3a", borderRadius: 4,
                  maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px #0008",
                }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 4px" }}>
                    <button onClick={() => setMarketOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                  {marketResults.map(m => (
                    <div key={m.id} style={{ padding: "6px 10px", borderBottom: "1px solid #2a2a2a", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#d4d4d4", fontWeight: 600 }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: "#666", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.description}</div>
                      </div>
                      {m.installed ? (
                        <span style={{ fontSize: 10, color: "#4ec9b0", flexShrink: 0 }}>✓ 已安装</span>
                      ) : (
                        <button
                          onClick={() => installModule(m.id)}
                          disabled={installing === m.id}
                          style={{ ...smallBtn, fontSize: 10, padding: "2px 8px", flexShrink: 0, opacity: installing === m.id ? 0.6 : 1 }}
                        >{installing === m.id ? "安装中…" : "安装"}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {platformTree.length === 0
                ? <div style={{ color: "#444", fontSize: 11, padding: "8px 12px" }}>Loading…</div>
                : <FileTree nodes={platformTree} onFileClick={openPlatformFile} activeFile={openFilePath} filterQuery={searchQuery} />}
            </div>
          </div>

          {/* Private column */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, background: "#1a1a1a", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#7ec8e3", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 }}>Private</span>
              <button onClick={handleBrowse} title="选择/更换文件夹" style={{ ...plusBtnStyle, fontSize: 13, color: "#555" }}>📁</button>
              {config?.vault_path && (
                <button onClick={createNewPrivateFile} title="New file" style={plusBtnStyle}>+</button>
              )}
            </div>
            {newFileName !== null && (
              <div style={{ display: "flex", padding: "4px 6px", gap: 4, borderBottom: "1px solid #2a2a2a", background: "#111" }}>
                <input
                  autoFocus
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onCompositionStart={() => { composingNewFile.current = true; }}
                onCompositionEnd={() => { composingNewFile.current = false; }}
                onKeyDown={e => { if (e.key === "Enter" && !composingNewFile.current) confirmNewFile(); if (e.key === "Escape") setNewFileName(null); }}
                  placeholder="文件名 (不含 .md)"
                  style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "3px 6px" }}
                />
                <button onClick={confirmNewFile} style={smallBtn}>✓</button>
                <button onClick={() => setNewFileName(null)} style={{ ...smallBtn, background: "#555" }}>✕</button>
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto" }}>
              {!config?.vault_path ? (
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>Select your private notes folder:</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input value={pathInput} onChange={e => { setPathInput(e.target.value); setPathError(null); setCreating(false); }}
                      onKeyDown={e => { if (e.key === "Enter") saveVaultPath(pathInput); }}
                      placeholder="/path/to/notes" style={inputStyle} />
                    <button onClick={handleBrowse} title="Browse" style={browseBtn}>📁</button>
                  </div>
                  {pathError && (
                    <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#e07b53" }}>{pathError}</span>
                      {creating && <button onClick={handleCreateDir} style={smallBtn}>Create</button>}
                    </div>
                  )}
                </div>
              ) : vaultTree.length === 0
                ? <div style={{ color: "#444", fontSize: 11, padding: "8px 12px" }}>No .md files found.</div>
                : <FileTree nodes={vaultTree} onFileClick={openPrivateFile} activeFile={openFilePath} filterQuery={searchQuery} onFileDelete={(node) => {
                    if (!window.confirm(`删除 ${node.name}？`)) return;
                    fetch(`/api/vault/file?path=${encodeURIComponent(node.path)}`, { method: "DELETE" })
                      .then(() => { loadVault(config!.vault_path); if (openFilePath === node.path) setOpenFile(null, null); });
                  }} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Editor ── */}
      {openFilePath && openFileContent !== null && (
        <>
          <div
            style={{ height: 4, background: "#2a2a2a", cursor: "row-resize", flexShrink: 0 }}
            onMouseDown={(e) => {
              e.preventDefault();
              const startY = e.clientY;
              const startH = editorHeight;
              const onMove = (ev: MouseEvent) => {
                const parentH = (e.currentTarget as HTMLElement).parentElement?.clientHeight || 400;
                const delta = (startY - ev.clientY) / parentH * 100;
                setEditorHeight(Math.min(90, Math.max(20, startH + delta)));
              };
              const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <div style={{ padding: "4px 8px", background: "#252526", borderBottom: "1px solid #333", fontSize: 11, color: "#888", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isReadOnly && <span style={{ fontSize: 9, background: "#3a2a00", color: "#c8a45a", borderRadius: 2, padding: "1px 5px", letterSpacing: 0.5 }}>PLATFORM · 机密</span>}
                {pendingGhostFile && <span style={{ fontSize: 9, background: "#2a0a0a", color: "#e05555", borderRadius: 2, padding: "1px 5px", letterSpacing: 0.5 }}>Unsaved</span>}
                {openFilePath.split("/").pop()}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {pendingGhostFile && (
                  <button
                    onClick={handleAiSuggest}
                    disabled={aiSuggestLoading}
                    style={{ background: aiSuggestLoading ? "#1a1a2a" : "#1a1800", border: "1px solid #c8a45a55", borderRadius: 4, color: "#c8a45a", cursor: aiSuggestLoading ? "default" : "pointer", fontSize: 10, padding: "2px 8px" }}
                  >
                    {aiSuggestLoading ? "⟳ Generating..." : "✦ AI Suggest"}
                  </button>
                )}
                {pendingGhostFile && (
                  <button
                    onClick={() => {
                      const content = ghostEditorContent ?? openFileContent ?? "";
                      handleGhostSave(content);
                    }}
                    style={{ background: "#0a2a0a", border: "1px solid #4ec9b055", borderRadius: 4, color: "#4ec9b0", cursor: "pointer", fontSize: 10, padding: "2px 8px", fontWeight: 600 }}
                  >
                    ✓ Save
                  </button>
                )}
                <button onClick={() => { setOpenFile(null, null); clearPendingGhostFile(); setGhostEditorContent(null); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}>×</button>
              </span>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {isReadOnly ? (
                <PlatformClassifiedView fileName={openFilePath.split("/").pop()?.replace(/\.md$/, "") ?? ""} />
              ) : (
                <Editor
                  path={openFilePath}
                  content={openFileContent}
                  readOnly={false}
                  vaultFiles={editorVaultFiles}
                  platformFiles={editorPlatformFiles}
                  onSave={pendingGhostFile ? undefined : handleSave}
                  onLinkClick={handleLinkClick}
                  onCrossLinkClick={handleCrossLinkClick}
                  onContentChange={pendingGhostFile ? setGhostEditorContent : undefined}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const PLATFORM_ACTIONS: Record<string, string[]> = {
  physics: [
    "查询牛顿力学公式与约束条件",
    "计算关节加速度上限（扭矩/惯量）",
    "评估碰撞避让裕量（冲量-动量定理）",
    "分析无人机流体动力学参数（雷诺数）",
    "推导刚体旋转响应（惯性张量）",
  ],
  robots: [
    "评估执行器饱和风险（扭矩上限）",
    "选择夹爪柔顺性匹配策略",
    "设计控制架构（PID vs MPC）",
    "分析传感器延迟对控制带宽的影响",
    "制定传感器失效安全策略",
  ],
  algorithms: [
    "选择路径规划算法（A* / RRT* / D* Lite）",
    "评估算法时间与空间复杂度",
    "高维配置空间运动规划",
    "实时重规划策略设计",
    "凸优化问题求解（梯度下降 / ADMM）",
  ],
  system_design: [
    "识别系统单点故障并制定缓解方案",
    "设计水平扩展路径",
    "选择数据一致性模型（强一致 / 最终一致）",
    "容量规划（QPS × P99延迟）",
    "架构模式选型（事件驱动 / CQRS / Saga）",
  ],
  materials: [
    "根据载荷类型选择材料",
    "查询杨氏模量与屈服强度",
    "评估疲劳极限与循环载荷耐久性",
    "高温 / 腐蚀环境合金选型",
    "重量预算下的材料优化（铝 / CFRP / 钛）",
  ],
};

function PlatformClassifiedView({ fileName }: { fileName: string }) {
  const actions = PLATFORM_ACTIONS[fileName.toLowerCase()] ?? [
    "查看关联决策依赖",
    "分析跨模块链接关系",
    "导出结构化知识图谱",
  ];

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", padding: "32px 24px", gap: 20,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, marginBottom: 6 }}>🔒</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#c8a45a", letterSpacing: 0.3 }}>详情保密，不能显示</div>
        <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>Platform 文件受平台保护，内容不对外开放</div>
      </div>
      <div style={{
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
        padding: "16px 20px", width: "100%", maxWidth: 400,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#c8a45a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
          可用操作
        </div>
        {actions.map((action, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 0", borderBottom: i < actions.length - 1 ? "1px solid #222" : "none",
          }}>
            <span style={{ color: "#c8a45a", fontSize: 14, marginTop: 1, flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 14, color: "#ccc", lineHeight: 1.5 }}>{action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ label, open, onToggle, badge, badgeTitle, action }: {
  label: string; open: boolean; onToggle: () => void;
  badge?: string; badgeTitle?: string; action?: React.ReactNode;
}) {
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "center", padding: "5px 10px 5px 8px", cursor: "pointer", userSelect: "none", background: "#1e1e1e", borderBottom: "1px solid #2a2a2a", gap: 6 }}
      onMouseEnter={e => (e.currentTarget.style.background = "#252526")}
      onMouseLeave={e => (e.currentTarget.style.background = "#1e1e1e")}
    >
      <span style={{ color: "#555", fontSize: 9, width: 10 }}>{open ? "▼" : "▶"}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 }}>{label}</span>
      {badge && <span title={badgeTitle} style={{ fontSize: 11, color: "#555" }}>{badge}</span>}
      {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
    </div>
  );
}

const plusBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#555", cursor: "pointer",
  fontSize: 16, lineHeight: 1, padding: "0 2px", borderRadius: 3,
};

const inputStyle: React.CSSProperties = {
  background: "#2a2a2a", border: "1px solid #444", borderRadius: 4,
  color: "#d4d4d4", padding: "5px 8px", fontSize: 12, outline: "none", width: "100%",
};

const browseBtn: React.CSSProperties = {
  background: "#3a3a3a", border: "1px solid #555", borderRadius: 4,
  color: "#ccc", cursor: "pointer", fontSize: 14, padding: "0 8px",
  flexShrink: 0, whiteSpace: "nowrap",
};

const smallBtn: React.CSSProperties = {
  background: "#007acc", border: "none", borderRadius: 3,
  color: "#fff", cursor: "pointer", fontSize: 11, padding: "3px 8px",
};
