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
import SkillCreatorChat from "./components/SkillCreatorChat";
import SettingsPanel from "./components/SettingsPanel";
import FeedbackDialog from "./components/FeedbackDialog";


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
  const skillCreatorChatOpen = useStore(s => s.skillCreatorChatOpen);

  const updateInfo = useStore(s => s.updateInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);

  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showBrainInspect, setShowBrainInspect] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    // Listen for electron-updater "update-downloaded" IPC event → show update banner
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.onUpdateDownloaded) {
      electronAPI.onUpdateDownloaded((info: { version: string }) => {
        setUpdateInfo(info);
      });
    }
    // Listen for native menu IPC events
    if (electronAPI?.onMenuEvent) {
      electronAPI.onMenuEvent((event: string, data?: any) => {
        if (event === "menu-open-settings") setShowSettings(true);
        if (event === "menu-toggle-history") setShowHistory(h => !h);
        if (event === "menu-contact-us") setShowFeedback(true);
        if (event === "menu-open-project" && data) {
          // Update project path via config save
          const currentConfig = useStore.getState().config;
          if (currentConfig) {
            const updated = { ...currentConfig, project_path: data };
            fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) })
              .then(r => r.ok ? r.json() : null)
              .then(() => { useStore.getState().setConfig(updated); })
              .catch(() => {});
          }
        }
      });
    }
  }, []);

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
        if (data) {
          // Always store whatever the server returns so account_token is never lost,
          // even when paths aren't configured yet.
          const cfg: import("./store").Config = {
            vault_path: data.vault_path ?? "",
            project_path: data.project_path ?? "",
            skills_path: data.skills_path ?? "",
            panel_ratio: data.panel_ratio ?? 0.45,
            kplr_token: data.kplr_token,
            minimax_token: data.minimax_token,
            account_token: data.account_token,
            registry_url: data.registry_url,
            admin_url: data.admin_url,
          };
          setConfig(cfg);
          setPanelRatio(cfg.panel_ratio);
          if (isConfigComplete(cfg)) {
            loadVault(cfg.vault_path);
            loadProject(cfg.project_path);
          }
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
        {/* Logo: icon + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: "linear-gradient(135deg, #1e40af, #3b82f6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, letterSpacing: 0.3 }}>{t(uiLanguage, "app_title")}</span>
        </div>
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

      {/* Auto-update banner — only shown when a new version is downloaded and ready */}
      {updateInfo && (
        <div style={{
          background: "#0057FF",
          color: "#fff",
          padding: "5px 16px",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}>
          <span>MindAct v{updateInfo.version} 已就绪</span>
          <button
            onClick={() => {
              const api = (window as any).electronAPI;
              if (api?.installUpdate) {
                api.installUpdate();
              } else {
                alert("请重启 MindAct 以应用更新。");
              }
            }}
            style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "2px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
          >
            重启以应用
          </button>
          <button
            onClick={() => setUpdateInfo(null)}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 12 }}
          >
            稍后
          </button>
        </div>
      )}

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

      {/* Skill Creator Chat floating window */}
      {skillCreatorChatOpen && <SkillCreatorChat />}

      {/* Settings modal */}
      {showSettings && (
        <div style={modalOverlayStyle} onClick={() => setShowSettings(false)}>
          <div style={settingsPanelStyle} onClick={e => e.stopPropagation()}>
            <SettingsPanel
              config={config ?? { vault_path: "", project_path: "", skills_path: "", panel_ratio: 0.45 }}
              onSave={(c) => {
                setConfig(c);
                loadVault(c.vault_path);
                loadProject(c.project_path);
                setShowSettings(false);
              }}
              onClose={() => setShowSettings(false)}
              onContactUs={() => { setShowSettings(false); setShowFeedback(true); }}
            />
          </div>
        </div>
      )}

      {/* Feedback / Contact Us modal */}
      {showFeedback && (
        <div style={modalOverlayStyle} onClick={() => setShowFeedback(false)}>
          <div onClick={e => e.stopPropagation()}>
            <FeedbackDialog onClose={() => setShowFeedback(false)} />
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

const settingsPanelStyle: React.CSSProperties = {
  background: "#252526",
  border: "1px solid #3a3a3a",
  borderRadius: 8,
  width: 640,
  maxWidth: "96vw",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};

