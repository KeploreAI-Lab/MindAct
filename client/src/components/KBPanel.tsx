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

export default function KBPanel() {
  const { vaultTree, openFilePath, openFileContent, setOpenFile, searchQuery, setSearchQuery, config, setConfig, setVaultTree } = useStore();
  const [editorHeight, setEditorHeight] = useState(60);
  const [pathInput, setPathInput] = useState(config?.vault_path ?? "");
  const [pathError, setPathError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadVault = useCallback((path: string) => {
    fetch(`/api/vault/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setVaultTree(data); });
  }, [setVaultTree]);

  const saveVaultPath = useCallback(async (path: string) => {
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
    const newConfig = { ...(config ?? { project_path: "", panel_ratio: 0.45 }), vault_path: trimmed };
    await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newConfig) });
    setConfig(newConfig);
    loadVault(trimmed);
  }, [config, setConfig, loadVault]);

  const handleBrowse = useCallback(async () => {
    const picked = await pickDir();
    if (picked) {
      setPathInput(picked);
      setPathError(null);
      setCreating(false);
      await saveVaultPath(picked);
    }
  }, [saveVaultPath]);

  const handleCreateDir = useCallback(async () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    await fetch("/api/create-dir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: trimmed }) });
    await saveVaultPath(trimmed);
    setCreating(false);
  }, [pathInput, saveVaultPath]);

  const openFile = useCallback((node: TreeNode) => {
    fetch(`/api/vault/file?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(data => setOpenFile(node.path, data.content ?? ""));
  }, [setOpenFile]);

  const handleSave = useCallback((content: string) => {
    if (!openFilePath) return;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: openFilePath, content }) });
  }, [openFilePath]);

  const handleLinkClick = useCallback((name: string) => {
    function findFile(nodes: TreeNode[]): TreeNode | null {
      for (const n of nodes) {
        if (n.type === "file" && n.name.replace(/\.md$/, "").toLowerCase() === name.toLowerCase()) return n;
        if (n.children) { const found = findFile(n.children); if (found) return found; }
      }
      return null;
    }
    const found = findFile(vaultTree);
    if (found) openFile(found);
  }, [vaultTree, openFile]);

  const createNewFile = () => {
    const name = prompt("File name (without .md):");
    if (!name || !config?.vault_path) return;
    const path = `${config.vault_path}/${name}.md`;
    fetch("/api/vault/file", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: `# ${name}\n\n` }) })
      .then(() => { loadVault(config.vault_path); setOpenFile(path, `# ${name}\n\n`); });
  };

  const treeHeight = openFilePath ? `${100 - editorHeight}%` : "100%";
  const hasVault = config?.vault_path && vaultTree.length >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Path Picker ── */}
      <div style={{ padding: "10px 10px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Knowledge Path
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={pathInput}
            onChange={e => { setPathInput(e.target.value); setPathError(null); setCreating(false); }}
            onKeyDown={e => { if (e.key === "Enter") saveVaultPath(pathInput); }}
            placeholder="/path/to/your/knowledge-base"
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
        {pathInput && !pathError && pathInput !== config?.vault_path && (
          <div style={{ marginTop: 6 }}>
            <button onClick={() => saveVaultPath(pathInput)} style={smallBtn}>Apply</button>
          </div>
        )}
      </div>

      {/* ── Search + New File ── */}
      <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333", marginTop: 8 }}>
        <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Quick search files..."
          style={{ ...inputStyle, flex: 1 }}
        />
        {config?.vault_path && (
          <button onClick={createNewFile} title="New File" style={iconBtnStyle}>+</button>
        )}
      </div>

      {/* ── File Tree ── */}
      <div style={{ height: treeHeight, overflow: "auto", flexShrink: 0 }}>
        {!config?.vault_path ? (
          <div style={{ color: "#555", padding: "20px 16px", fontSize: 12, lineHeight: 1.6 }}>
            Select a folder above to load your Decision Dependency knowledge base.
          </div>
        ) : vaultTree.length === 0 ? (
          <div style={{ color: "#555", padding: 16, fontSize: 12 }}>No .md files found in this folder.</div>
        ) : (
          <FileTree nodes={vaultTree} onFileClick={openFile} activeFile={openFilePath} filterQuery={searchQuery} />
        )}
      </div>

      {/* ── Editor ── */}
      {openFilePath && openFileContent !== null && (
        <>
          <div
            style={{ height: 4, background: "#333", cursor: "row-resize", flexShrink: 0 }}
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
            <div style={{ padding: "4px 8px", background: "#2d2d2d", borderBottom: "1px solid #333", fontSize: 11, color: "#888", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{openFilePath.split("/").pop()}</span>
              <button onClick={() => setOpenFile(null, null)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <Editor path={openFilePath} content={openFileContent} vaultFiles={vaultTree} onSave={handleSave} onLinkClick={handleLinkClick} />
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

const iconBtnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  border: "1px solid #555",
  borderRadius: 4,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 16,
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
