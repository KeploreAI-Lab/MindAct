import React, { useState, useCallback } from "react";
import { useStore, TreeNode } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";

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

export default function FileExplorer() {
  const { projectTree, config, setConfig, setProjectTree, setTerminalBanner } = useStore();
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(config?.project_path ?? "");
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadProject = useCallback((path: string) => {
    fetch(`/api/project/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setProjectTree(data); });
  }, [setProjectTree]);

  const saveProjectPath = useCallback(async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const exists = await checkDir(trimmed);
    if (!exists) {
      setPathError("Folder not found. Create it?");
      setCreating(true);
      return;
    }
    setPathError(null);
    setCreating(false);
    const newConfig = { ...(config ?? { vault_path: "", panel_ratio: 0.45 }), project_path: trimmed };
    await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newConfig) });
    setConfig(newConfig);
    loadProject(trimmed);
    setTerminalBanner(`!cd ${trimmed}`);
  }, [config, setConfig, loadProject]);

  const handleBrowse = useCallback(async () => {
    const picked = await pickDir();
    if (picked) {
      setPathInput(picked);
      setPathError(null);
      setCreating(false);
      await saveProjectPath(picked);
    }
  }, [saveProjectPath]);

  const handleCreateDir = useCallback(async () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    await fetch("/api/create-dir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: trimmed }) });
    await saveProjectPath(trimmed);
    setCreating(false);
  }, [pathInput, saveProjectPath]);

  const openFile = useCallback((node: TreeNode) => {
    if (node.type !== "file") return;
    fetch(`/api/project/file?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(data => { setOpenFilePath(node.path); setOpenFileContent(data.content ?? ""); });
  }, []);

  const handleSave = useCallback((content: string) => {
    if (!openFilePath) return;
    fetch("/api/project/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: openFilePath, content }) });
  }, [openFilePath]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Path Picker ── */}
      <div style={{ padding: "10px 10px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Project Path
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={pathInput}
            onChange={e => { setPathInput(e.target.value); setPathError(null); setCreating(false); }}
            onKeyDown={e => { if (e.key === "Enter") saveProjectPath(pathInput); }}
            placeholder="/path/to/your/project"
            style={inputStyle}
          />
          <button onClick={handleBrowse} title="Browse" style={browseBtn}>
            📁
          </button>
        </div>
        {pathError && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#e07b53" }}>{pathError}</span>
            {creating && (
              <button onClick={handleCreateDir} style={smallBtn}>Create folder</button>
            )}
          </div>
        )}
        {pathInput && !pathError && pathInput !== config?.project_path && (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => saveProjectPath(pathInput)} style={smallBtn}>Apply</button>
          </div>
        )}
      </div>

      {/* ── Quick Search ── */}
      <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333", marginTop: 8 }}>
        <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Quick search files..."
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>

      {/* ── File Tree ── */}
      <div style={{ flex: openFilePath ? "0 0 40%" : "1", overflow: "auto" }}>
        {!config?.project_path ? (
          <div style={{ color: "#555", padding: "20px 16px", fontSize: 12, lineHeight: 1.6 }}>
            Select a project folder above to browse your project files.
          </div>
        ) : projectTree.length === 0 ? (
          <div style={{ color: "#555", padding: 16, fontSize: 12 }}>No files found in this folder.</div>
        ) : (
          <FileTree nodes={projectTree} onFileClick={openFile} activeFile={openFilePath} filterQuery={searchQuery} />
        )}
      </div>

      {/* ── File Preview ── */}
      {openFilePath && openFileContent !== null && (
        <>
          <div style={{ height: 1, background: "#444", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <div style={{ padding: "4px 8px", background: "#2d2d2d", borderBottom: "1px solid #333", fontSize: 11, color: "#888", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontStyle: "italic" }}>{openFilePath.split("/").pop()}</span>
              <button onClick={() => { setOpenFilePath(null); setOpenFileContent(null); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <Editor path={openFilePath} content={openFileContent} onSave={handleSave} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#d4d4d4",
  padding: "5px 8px",
  fontSize: 12,
  outline: "none",
  width: "100%",
};

const browseBtn: React.CSSProperties = {
  background: "#3a3a3a",
  border: "1px solid #555",
  borderRadius: 4,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 14,
  padding: "0 8px",
  flexShrink: 0,
  whiteSpace: "nowrap",
};

const smallBtn: React.CSSProperties = {
  background: "#007acc",
  border: "none",
  borderRadius: 3,
  color: "#fff",
  cursor: "pointer",
  fontSize: 11,
  padding: "3px 8px",
};
