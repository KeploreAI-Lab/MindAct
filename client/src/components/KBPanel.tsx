import React, { useState, useCallback } from "react";
import { useStore } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";
import { TreeNode } from "../store";

async function pickDir(): Promise<string | null> {
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

export default function KBPanel() {
  const {
    vaultTree, platformTree,
    openFilePath, openFileContent, setOpenFile,
    searchQuery, setSearchQuery,
    config, setConfig, setVaultTree, setTerminalBanner,
  } = useStore();

  const [editorHeight, setEditorHeight] = useState(60);
  const [pathInput, setPathInput] = useState(config?.vault_path ?? "");
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(true);
  const [privateOpen, setPrivateOpen] = useState(true);
  const [openFileSource, setOpenFileSource] = useState<OpenFileSource>("private");

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
    setTerminalBanner(`!cd ${trimmed}`);
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

  const createNewPrivateFile = () => {
    const name = prompt("File name (without .md):");
    if (!name || !config?.vault_path) return;
    const path = `${config.vault_path}/${name}.md`;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: `# ${name}\n\n` }) })
      .then(() => { loadVault(config.vault_path); setOpenFile(path, `# ${name}\n\n`); setOpenFileSource("private"); });
  };

  const allFiles = [...platformTree, ...vaultTree];
  const isReadOnly = openFileSource === "platform";
  const editorVaultFiles = vaultTree;
  const editorPlatformFiles = platformTree;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Quick Search ── */}
      <div style={{ padding: "6px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #2a2a2a" }}>
        <span style={{ color: "#555", fontSize: 13, lineHeight: "24px" }}>🔍</span>
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search all files…" style={{ ...inputStyle, flex: 1 }} />
      </div>

      {/* ── Horizontal two-column tree ── */}
      <div style={{ flex: openFilePath ? "0 0 38%" : "1", display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>

        {/* Platform column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #2a2a2a", overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 4, background: "#1a1a1a", borderBottom: "1px solid #2a2a2a", flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#c8a45a", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 }}>Platform</span>
            <span title="Read-only — server provided" style={{ fontSize: 10, color: "#555" }}>🔒</span>
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
            {config?.vault_path && (
              <button onClick={createNewPrivateFile} title="New file" style={plusBtnStyle}>+</button>
            )}
          </div>
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
              : <FileTree nodes={vaultTree} onFileClick={openPrivateFile} activeFile={openFilePath} filterQuery={searchQuery} />}
          </div>
        </div>
      </div>

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
            <div style={{ padding: "4px 8px", background: "#252526", borderBottom: "1px solid #333", fontSize: 11, color: "#888", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isReadOnly && <span style={{ fontSize: 9, background: "#3a2a00", color: "#c8a45a", borderRadius: 2, padding: "1px 5px", letterSpacing: 0.5 }}>PLATFORM · 机密</span>}
                {openFilePath.split("/").pop()}
              </span>
              <button onClick={() => setOpenFile(null, null)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}>×</button>
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
                  onSave={handleSave}
                  onLinkClick={handleLinkClick}
                  onCrossLinkClick={handleCrossLinkClick}
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
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#c8a45a", letterSpacing: 0.5 }}>详情保密，不能显示</div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Platform 文件受平台保护，内容不对外开放</div>
      </div>
      <div style={{
        background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 8,
        padding: "16px 20px", width: "100%", maxWidth: 340,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#c8a45a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
          可用操作
        </div>
        {actions.map((action, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "7px 0", borderBottom: i < actions.length - 1 ? "1px solid #222" : "none",
          }}>
            <span style={{ color: "#c8a45a", fontSize: 11, marginTop: 1, flexShrink: 0 }}>›</span>
            <span style={{ fontSize: 12, color: "#aaa", lineHeight: 1.4 }}>{action}</span>
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
