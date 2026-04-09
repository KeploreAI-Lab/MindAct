import React, { useState, useCallback } from "react";
import { useStore, TreeNode } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";
import { t } from "../i18n";

async function pickDir(): Promise<string | null> {
  const api = (window as any).electronAPI;
  if (api?.pickFolder) {
    const result = await api.pickFolder();
    if (!result.canceled && result.filePaths?.length) return result.filePaths[0];
    return null;
  }
  const res = await fetch("/api/pick-dir");
  const data = await res.json();
  return data.path ?? null;
}

export default function SkillsExplorer() {
  const { config, setConfig, uiLanguage } = useStore();
  const [skillsTree, setSkillsTree] = useState<TreeNode[]>([]);
  const [loadedPath, setLoadedPath] = useState<string>(config?.skills_path ?? "");
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSkills = useCallback((path: string) => {
    if (!path.trim()) return;
    setLoading(true);
    fetch(`/api/skills/tree?path=${encodeURIComponent(path.trim())}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSkillsTree(data);
          setLoadedPath(path.trim());
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleBrowse = useCallback(async () => {
    const picked = await pickDir();
    if (!picked) return;
    // Save to config
    const newConfig = { ...(config ?? { vault_path: "", project_path: "", skills_path: "", panel_ratio: 0.45 }), skills_path: picked };
    fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newConfig) });
    setConfig(newConfig);
    loadSkills(picked);
  }, [config, setConfig, loadSkills]);

  const openFile = useCallback((node: TreeNode) => {
    if (node.type !== "file") return;
    fetch(`/api/skills/file?path=${encodeURIComponent(node.path)}`)
      .then(r => r.json())
      .then(data => { setOpenFilePath(node.path); setOpenFileContent(data.content ?? ""); });
  }, []);

  const handleSave = useCallback((content: string) => {
    if (!openFilePath) return;
    fetch("/api/skills/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: openFilePath, content }),
    });
  }, [openFilePath]);

  // Auto-load on mount if config has skills_path
  React.useEffect(() => {
    if (config?.skills_path) {
      loadSkills(config.skills_path);
    }
  }, [config?.skills_path, loadSkills]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Folder header */}
      <div style={{ padding: "10px 10px 8px", flexShrink: 0, borderBottom: "1px solid #333" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 }}>
            {uiLanguage === "zh" ? "专家能力文件夹" : "Skills Folder"}
          </span>
          <button
            onClick={handleBrowse}
            title={uiLanguage === "zh" ? "选择文件夹" : "Choose folder"}
            style={browseBtnStyle}
          >
            📁
          </button>
        </div>
        {loadedPath && (
          <div style={{ fontSize: 10, color: "#555", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {loadedPath}
          </div>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333" }}>
        <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t(uiLanguage, "search_skills_files")}
          style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#d4d4d4", padding: "5px 8px", fontSize: 12, outline: "none", flex: 1 }}
        />
      </div>

      {/* File tree */}
      <div style={{ flex: openFilePath ? "0 0 40%" : "1", overflow: "auto" }}>
        {!loadedPath ? (
          <div style={{ color: "#555", padding: "20px 16px", fontSize: 12 }}>
            {uiLanguage === "zh" ? "点击 📁 选择技能文件夹。" : "Click 📁 to choose a skills folder."}
          </div>
        ) : skillsTree.length === 0 && !loading ? (
          <div style={{ color: "#555", padding: 16, fontSize: 12 }}>{t(uiLanguage, "no_files_found_skills")}</div>
        ) : (
          <FileTree nodes={skillsTree} onFileClick={openFile} activeFile={openFilePath} filterQuery={searchQuery} />
        )}
      </div>

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

const browseBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 16,
  padding: "2px 4px",
  lineHeight: 1,
  color: "#888",
};
