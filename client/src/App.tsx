import React, { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "./store";
import KBPanel from "./components/KBPanel";
import FileExplorer from "./components/FileExplorer";
import Terminal from "./components/Terminal";
import Graph from "./components/Graph";
import SetupDialog from "./components/SetupDialog";

export default function App() {
  const {
    config, configLoaded, setConfig, setConfigLoaded,
    setVaultTree, setProjectTree,
    activeTab, setActiveTab,
    graphMode, setGraphMode,
    panelRatio, setPanelRatio,
  } = useStore();

  const [showSettings, setShowSettings] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    fetch("/api/config")
      .then(r => r.json())
      .then(data => {
        if (data) {
          setConfig(data);
          setPanelRatio(data.panel_ratio ?? 0.45);
          loadVault(data.vault_path);
          loadProject(data.project_path);
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

  if (!config) {
    return <SetupDialog onSave={(c) => {
      setConfig(c);
      setConfigLoaded(true);
      loadVault(c.vault_path);
      loadProject(c.project_path);
    }} />;
  }

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
        <span style={{ color: "#007acc", fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>PhysMind</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setGraphMode(!graphMode)}
          style={btnStyle(graphMode)}
        >
          {graphMode ? "← Back" : "Graph"}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          style={btnStyle(false)}
        >
          Settings
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
        }}>
          {graphMode ? (
            <Graph />
          ) : (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid #444", flexShrink: 0 }}>
                <TabBtn label="Decision Dependency" active={activeTab === "kb"} onClick={() => setActiveTab("kb")} />
                <TabBtn label="Project" active={activeTab === "files"} onClick={() => setActiveTab("files")} />
              </div>
              <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {activeTab === "kb" ? <KBPanel /> : <FileExplorer />}
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
        }}>
          <Terminal />
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div style={modalOverlayStyle} onClick={() => setShowSettings(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, color: "#d4d4d4" }}>Settings</h3>
            <SettingsForm config={config} onSave={(c) => {
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
  const [vault, setVault] = useState(config.vault_path);
  const [project, setProject] = useState(config.project_path);

  const save = () => {
    const c = { vault_path: vault, project_path: project, panel_ratio: config.panel_ratio };
    fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) })
      .then(() => onSave(c));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ color: "#888", fontSize: 11 }}>Vault Path</label>
      <input value={vault} onChange={e => setVault(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>Project Path</label>
      <input value={project} onChange={e => setProject(e.target.value)} style={inputStyle} />
      <button onClick={save} style={{ ...btnStyle(true), alignSelf: "flex-end", marginTop: 8 }}>Save</button>
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
