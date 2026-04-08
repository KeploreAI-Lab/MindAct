import React, { useState, useCallback } from "react";
import { useStore, TreeNode } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";
import { t } from "../i18n";

export default function SkillsExplorer() {
  const { config, uiLanguage } = useStore();
  const [skillsTree, setSkillsTree] = useState<TreeNode[]>([]);
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadSkills = useCallback((path: string) => {
    if (!path) return;
    fetch(`/api/skills/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSkillsTree(data); });
  }, []);

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

  React.useEffect(() => {
    if (config?.skills_path) loadSkills(config.skills_path);
  }, [config?.skills_path, loadSkills]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "10px 10px 0", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t(uiLanguage, "skills_path")}
        </div>
        <input
          value={config?.skills_path ?? ""}
          readOnly
          style={inputStyle}
        />
      </div>

      <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333", marginTop: 8 }}>
        <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t(uiLanguage, "search_skills_files")}
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>

      <div style={{ flex: openFilePath ? "0 0 40%" : "1", overflow: "auto" }}>
        {!config?.skills_path ? (
          <div style={{ color: "#555", padding: "20px 16px", fontSize: 12 }}>{t(uiLanguage, "skills_not_configured")}</div>
        ) : skillsTree.length === 0 ? (
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
