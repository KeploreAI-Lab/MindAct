import React, { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "./store";
import KBPanel from "./components/KBPanel";
import FileExplorer from "./components/FileExplorer";
import SkillsExplorer from "./components/SkillsExplorer";
import Terminal from "./components/Terminal";
import Graph from "./components/Graph";
import HistoryPanel from "./components/HistoryPanel";
import BrainInspect from "./components/BrainInspect";
import { t } from "./i18n";
import GraphLogDrawer from "./components/GraphLogDrawer";

export default function App() {
  const isConfigComplete = (c: any): c is import("./store").Config =>
    !!c?.vault_path && !!c?.project_path && !!c?.skills_path;

  const config = useStore(s => s.config);
  const configLoaded = useStore(s => s.configLoaded);
  const setConfig = useStore(s => s.setConfig);
  const setConfigLoaded = useStore(s => s.setConfigLoaded);
  const setVaultTree = useStore(s => s.setVaultTree);
  const setPlatformTree = useStore(s => s.setPlatformTree);
  const setProjectTree = useStore(s => s.setProjectTree);
  const activeTab = useStore(s => s.activeTab);
  const setActiveTab = useStore(s => s.setActiveTab);
  const graphMode = useStore(s => s.graphMode);
  const setGraphMode = useStore(s => s.setGraphMode);
  const setKbViewMode = useStore(s => s.setKbViewMode);
  const panelRatio = useStore(s => s.panelRatio);
  const setPanelRatio = useStore(s => s.setPanelRatio);
  const uiLanguage = useStore(s => s.uiLanguage);
  const setUiLanguage = useStore(s => s.setUiLanguage);

  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBrainInspect, setShowBrainInspect] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    // Expose setPlatformTree globally for BrainInspect URL loader
    (window as any).__physmindSetPlatformTree = setPlatformTree;
    // Load platform tree (always available, server-provided)
    fetch("/api/platform/tree")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPlatformTree(data); });

    fetch("/api/config")
      .then(r => r.json())
      .then(data => {
        if (isConfigComplete(data)) {
          setConfig(data);
          setPanelRatio(data.panel_ratio ?? 0.45);
          loadVault(data.vault_path);
          loadProject(data.project_path);
        } else {
          setConfig(null);
        }
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  }, []);

  const loadVault = (path: string) => {
    if (!path) return;
    fetch(`/api/vault/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setVaultTree(data); });
  };

  const loadProject = (path: string) => {
    if (!path) return;
    fetch(`/api/project/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setProjectTree(data); });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = Math.min(0.8, Math.max(0.1, (e.clientX - rect.left) / rect.width));
    setPanelRatio(ratio);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      if (config) {
        fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...config, panel_ratio: panelRatio }),
        });
      }
    }
  }, [config, panelRatio]);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  if (!configLoaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#888" }}>
        Loading...
      </div>
    );
  }

  // Skip forced setup — proceed with whatever config exists (may be partial/null)

  const leftWidth = graphMode ? "100%" : `${panelRatio * 100}%`;
  const rightWidth = graphMode ? "0%" : `${(1 - panelRatio) * 100}%`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#1e1e1e" }}>
      {/* Top bar */}
      <div style={{
        height: 40,
        background: "#323233",
        borderBottom: "1px solid #444",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        flexShrink: 0,
        userSelect: "none",
      }}>
        <span style={{ color: "#007acc", fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>{t(uiLanguage, "app_title")}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#888", fontSize: 11 }}>{t(uiLanguage, "language")}</span>
        <select
          value={uiLanguage}
          onChange={(e) => setUiLanguage(e.target.value as "en" | "zh")}
          style={{ background: "#3a3a3a", border: "1px solid #555", color: "#ddd", borderRadius: 3, fontSize: 12, padding: "2px 6px" }}
        >
          <option value="en">EN</option>
          <option value="zh">中文</option>
        </select>
        <button
          onClick={() => setShowSettings(true)}
          style={btnStyle(false)}
        >
          {t(uiLanguage, "settings")}
        </button>
        <button
          onClick={() => setShowHistory(h => !h)}
          style={btnStyle(showHistory)}
        >
          {t(uiLanguage, "history")}
        </button>
      </div>

      {/* Main area */}
      <div ref={containerRef} style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left panel */}
        <div style={{
          width: leftWidth,
          minWidth: graphMode ? "100%" : 200,
          display: "flex",
          flexDirection: "column",
          borderRight: graphMode ? "none" : "1px solid #444",
          overflow: "hidden",
          transition: "width 0.2s ease",
          position: "relative",
        }}>
          <GraphLogDrawer />
          {graphMode ? (
            <Graph onExitFullscreen={() => { setGraphMode(false); setActiveTab("kb"); setKbViewMode("brain"); }} onBrainInspect={() => setShowBrainInspect(true)} />
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid #444", flexShrink: 0 }}>
                <TabBtn label={t(uiLanguage, "tab_dependency")} active={activeTab === "kb"} onClick={() => setActiveTab("kb")} />
                <TabBtn label={t(uiLanguage, "tab_skills")} active={activeTab === "skills"} onClick={() => setActiveTab("skills")} />
                <TabBtn label={t(uiLanguage, "tab_project")} active={activeTab === "files"} onClick={() => setActiveTab("files")} />
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {activeTab === "kb"
                  ? <KBPanel onFullscreenBrain={() => setGraphMode(true)} onBrainInspect={() => setShowBrainInspect(true)} />
                  : activeTab === "skills"
                    ? <SkillsExplorer />
                    : <FileExplorer />}
              </div>
            </>
          )}
        </div>

        {/* Divider */}
        {!graphMode && (
          <div
            onMouseDown={handleMouseDown}
            style={{
              width: 4,
              background: "#444",
              cursor: "col-resize",
              flexShrink: 0,
              transition: "background 0.1s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#007acc")}
            onMouseLeave={e => (e.currentTarget.style.background = "#444")}
          />
        )}

        {/* Right panel */}
        <div style={{
          width: rightWidth,
          overflow: "hidden",
          transition: "width 0.2s ease",
          display: "flex",
          flexDirection: "row",
        }}>
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <Terminal />
          </div>
          {showHistory && <HistoryPanel />}
        </div>
      </div>

      {/* BrainInspect overlay */}
      {showBrainInspect && <BrainInspect onClose={() => setShowBrainInspect(false)} />}

      {/* Settings modal */}
      {showSettings && (
        <div style={modalOverlayStyle} onClick={() => setShowSettings(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, color: "#d4d4d4" }}>{t(uiLanguage, "settings")}</h3>
            <SettingsForm config={config ?? { vault_path: "", project_path: "", skills_path: "", panel_ratio: 0.45 }} onSave={(c) => {
              setConfig(c);
              loadVault(c.vault_path);
              loadProject(c.project_path);
              setShowSettings(false);
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      padding: "8px 0",
      background: active ? "#252526" : "transparent",
      border: "none",
      borderBottom: active ? "2px solid #007acc" : "2px solid transparent",
      color: active ? "#d4d4d4" : "#888",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: active ? 600 : 400,
    }}>
      {label}
    </button>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    background: active ? "#007acc" : "#3a3a3a",
    border: "none",
    borderRadius: 3,
    color: active ? "#fff" : "#ccc",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
  };
}

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "#252526",
  border: "1px solid #444",
  borderRadius: 8,
  padding: 24,
  minWidth: 420,
  maxWidth: 500,
};

function SettingsForm({ config, onSave }: { config: import("./store").Config; onSave: (c: import("./store").Config) => void }) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [vault, setVault] = useState(config.vault_path);
  const [project, setProject] = useState(config.project_path);
  const [skills, setSkills] = useState(config.skills_path);
  const [token, setToken] = useState(config.kplr_token ?? "");
  const [showToken, setShowToken] = useState(false);
  const [minimaxToken, setMinimaxToken] = useState(config.minimax_token ?? "");
  const [showMinimaxToken, setShowMinimaxToken] = useState(false);

  React.useEffect(() => {
    setVault(config.vault_path);
    setProject(config.project_path);
    setSkills(config.skills_path);
    setToken(config.kplr_token ?? "");
    setMinimaxToken(config.minimax_token ?? "");
  }, [config]);

  const save = () => {
    const c: import("./store").Config = { vault_path: vault, project_path: project, skills_path: skills, panel_ratio: config.panel_ratio, kplr_token: token || undefined, minimax_token: minimaxToken || undefined };
    const body: Record<string, unknown> = { ...c };
    fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Save failed" }));
          alert(err.error || "Save failed");
          return;
        }
        onSave(c);
      });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ color: "#888", fontSize: 11 }}>Private Decision Dependancy</label>
      <input value={vault} onChange={e => setVault(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>Project Path</label>
      <input value={project} onChange={e => setProject(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>Skills Path</label>
      <input value={skills} onChange={e => setSkills(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>PhysMind Key (kplr-...)</label>
      <div style={{ position: "relative" }}>
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="kplr-xxxxxxxxxxxx"
          style={{ ...inputStyle, paddingRight: 60 }}
        />
        <button onClick={() => setShowToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
          {showToken ? "Hide" : "Show"}
        </button>
      </div>
      <label style={{ color: "#888", fontSize: 11 }}>Minimax API Key</label>
      <div style={{ position: "relative" }}>
        <input
          type={showMinimaxToken ? "text" : "password"}
          value={minimaxToken}
          onChange={e => setMinimaxToken(e.target.value)}
          placeholder="Enter Minimax API key"
          style={{ ...inputStyle, paddingRight: 60 }}
        />
        <button onClick={() => setShowMinimaxToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
          {showMinimaxToken ? "Hide" : "Show"}
        </button>
      </div>
      <button onClick={save} style={{ ...btnStyle(true), alignSelf: "flex-end", marginTop: 8 }}>{t(uiLanguage, "save")}</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  border: "1px solid #555",
  borderRadius: 4,
  color: "#d4d4d4",
  padding: "6px 10px",
  fontSize: 13,
  outline: "none",
  width: "100%",
};
