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
import { encryptApiKeys, decryptApiKeys } from "./lib/apiKeyCrypto";

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

const DEFAULT_REGISTRY_URL = "https://registry.physical-mind.ai";

function SettingsForm({ config, onSave }: { config: import("./store").Config; onSave: (c: import("./store").Config) => void }) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [vault, setVault] = useState(config.vault_path);
  const [project, setProject] = useState(config.project_path);
  const [skills, setSkills] = useState(config.skills_path);
  const [selectedBackend, setSelectedBackend] = useState<"minimax" | "anthropic" | "glm">(config.selected_backend ?? "minimax");
  const [minimaxToken, setMinimaxToken] = useState(config.minimax_token ?? "");
  const [showMinimaxToken, setShowMinimaxToken] = useState(false);
  const [anthropicToken, setAnthropicToken] = useState(config.anthropic_token ?? "");
  const [showAnthropicToken, setShowAnthropicToken] = useState(false);
  const [glmToken, setGlmToken] = useState(config.glm_token ?? "");
  const [showGlmToken, setShowGlmToken] = useState(false);
  const [accountToken, setAccountToken] = useState(config.account_token ?? "");
  const [showAccountToken, setShowAccountToken] = useState(false);
  const [accountStatus, setAccountStatus] = useState<{ email: string; username?: string } | null>(null);
  // Start in "checking" state immediately if a valid-looking token is already present,
  // so the button never flashes "Sign In" before verification completes.
  const [accountChecking, setAccountChecking] = useState(() => {
    const tok = config.account_token ?? "";
    return tok.startsWith("mact_") && tok.length >= 20;
  });
  const [waitingForToken, setWaitingForToken] = useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const focusHandlerRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    setVault(config.vault_path);
    setProject(config.project_path);
    setSkills(config.skills_path);
    setSelectedBackend(config.selected_backend ?? "minimax");
    setMinimaxToken(config.minimax_token ?? "");
    setAnthropicToken(config.anthropic_token ?? "");
    setGlmToken(config.glm_token ?? "");
    setAccountToken(config.account_token ?? "");
  }, [config]);

  // Verify account token and fetch user info whenever the token field changes.
  // Only call the API when the token looks complete (mact_ prefix + at least 20 chars).
  React.useEffect(() => {
    if (!accountToken || !accountToken.startsWith("mact_") || accountToken.length < 20) {
      setAccountStatus(null);
      return;
    }
    setAccountChecking(true);
    fetch("/api/registry/me")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { setAccountStatus(d ? { email: d.email, username: d.username } : null); })
      .catch(() => setAccountStatus(null))
      .finally(() => setAccountChecking(false));
  }, [accountToken]);

  // Clean up poll and focus handler on unmount
  React.useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
    };
  }, []);

  // Inline validation — selected backend must have an API key before saving
  const backendKeyMissing =
    (selectedBackend === 'minimax' && !minimaxToken.trim()) ||
    (selectedBackend === 'anthropic' && !anthropicToken.trim()) ||
    (selectedBackend === 'glm' && !glmToken.trim());

  const backendKeyLabel =
    selectedBackend === 'minimax' ? 'MiniMax API key (sk-api-...)' :
    selectedBackend === 'anthropic' ? 'Anthropic API key (sk-ant-...)' :
    'GLM API key';

  // GLM uses MiniMax/kplr for the AI terminal; warn if neither is available
  const glmTerminalWarning =
    selectedBackend === 'glm' && glmToken.trim() && !minimaxToken.trim();

  // ── API key sync state ──────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState<null | "syncing" | "restoring" | "ok" | "error">(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [cloudDeps, setCloudDeps] = useState<Array<{ id: string; name: string; type: string; version?: string }>>([]);
  const [cloudDepsLoading, setCloudDepsLoading] = useState(false);

  // Load cloud sync metadata whenever the user becomes signed in
  React.useEffect(() => {
    if (!accountStatus) { setSyncedAt(null); setCloudDeps([]); return; }
    // Fetch last sync time
    fetch("/api/user/api-keys")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { if (d?.updated_at) setSyncedAt(d.updated_at); })
      .catch(() => {});
    // Fetch user's cloud dependencies
    setCloudDepsLoading(true);
    fetch("/api/registry/list")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const items: Array<{ id: string; name: string; type: string; version?: string }> = (d?.items ?? [])
          .filter((it: any) => it.visibility === "private" || it.visibility === "org")
          .map((it: any) => ({ id: it.id, name: it.name, type: it.type, version: it.version }));
        setCloudDeps(items);
      })
      .catch(() => {})
      .finally(() => setCloudDepsLoading(false));
  }, [accountStatus]);

  const syncToCloud = async () => {
    if (!accountToken) return;
    setSyncStatus("syncing");
    setSyncMsg("");
    try {
      const keys = { minimax_token: minimaxToken || undefined, anthropic_token: anthropicToken || undefined, glm_token: glmToken || undefined };
      const encrypted = await encryptApiKeys(keys, accountToken);
      const res = await fetch("/api/user/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as any;
      setSyncedAt(data.updated_at ?? new Date().toISOString());
      setSyncStatus("ok");
    } catch (e: any) {
      setSyncStatus("error");
      setSyncMsg(e.message ?? "Unknown error");
    }
  };

  const restoreFromCloud = async () => {
    if (!accountToken) return;
    setSyncStatus("restoring");
    setSyncMsg("");
    try {
      const res = await fetch("/api/user/api-keys");
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json() as any;
      if (!data?.encrypted) throw new Error("No backup found");
      const keys = await decryptApiKeys(data.encrypted, accountToken);
      if (keys.minimax_token !== undefined) setMinimaxToken(keys.minimax_token ?? "");
      if (keys.anthropic_token !== undefined) setAnthropicToken(keys.anthropic_token ?? "");
      if (keys.glm_token !== undefined) setGlmToken(keys.glm_token ?? "");
      if (data.updated_at) setSyncedAt(data.updated_at);
      setSyncStatus("ok");
      setSyncMsg("ok_restore");
    } catch (e: any) {
      setSyncStatus("error");
      setSyncMsg(e.message ?? "Unknown error");
    }
  };

  const save = () => {
    const c: import("./store").Config = {
      vault_path: vault,
      project_path: project,
      skills_path: skills,
      panel_ratio: config.panel_ratio,
      selected_backend: selectedBackend,
      minimax_token: minimaxToken || undefined,
      anthropic_token: anthropicToken || undefined,
      glm_token: glmToken || undefined,
      account_token: accountToken || undefined,
      registry_url: config.registry_url,
      admin_url: config.admin_url,
    };
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

  const openAuthPage = () => {
    const registryUrl = (config as any).registry_url ?? DEFAULT_REGISTRY_URL;
    const callbackUrl = `http://localhost:3001/auth/callback`;
    window.open(`${registryUrl}/register?redirect=${encodeURIComponent(callbackUrl)}`);
    setWaitingForToken(true);
    const startToken = accountToken;
    let attempts = 0;

    const stopPolling = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (focusHandlerRef.current) { window.removeEventListener("focus", focusHandlerRef.current); focusHandlerRef.current = null; }
    };

    const checkToken = () => {
      fetch("/api/config")
        .then(r => r.ok ? r.json() : null)
        .then((d: any) => {
          const newToken: string = d?.account_token ?? "";
          if (newToken && newToken !== startToken) {
            setAccountToken(newToken);
            setWaitingForToken(false);
            stopPolling();
          }
        })
        .catch(() => {});
    };

    // Fire immediately when main window regains focus (popup closed by user or auto-close)
    if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
    const onFocus = () => checkToken();
    focusHandlerRef.current = onFocus;
    window.addEventListener("focus", onFocus);

    // Fallback: poll every 2s in case focus event doesn't fire
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      attempts++;
      checkToken();
      // Stop after 3 minutes (90 × 2s)
      if (attempts >= 90) {
        setWaitingForToken(false);
        stopPolling();
      }
    }, 2000);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccountToken("");
    setAccountStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── AI Model Backend ── */}
      <label style={{ color: "#888", fontSize: 11 }}>AI Model Backend</label>
      <div style={{ display: "flex", gap: 6 }}>
        {(["minimax", "anthropic", "glm"] as const).map(b => {
          const labels: Record<string, string> = { minimax: "MiniMax", anthropic: "Claude (Anthropic)", glm: "GLM (智谱)" };
          const active = selectedBackend === b;
          return (
            <button
              key={b}
              onClick={() => setSelectedBackend(b)}
              style={{
                flex: 1, padding: "5px 6px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                border: active ? "1px solid #007acc" : "1px solid #444",
                background: active ? "#1e3a4f" : "#1e1e1e",
                color: active ? "#007acc" : "#888",
                fontWeight: active ? 600 : 400,
              }}
            >
              {labels[b]}
            </button>
          );
        })}
      </div>

      {/* Inline error: selected backend has no API key */}
      {backendKeyMissing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e05555', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: '#e05555' }}>
            No {backendKeyLabel} found — enter a key below or select a provider that already has a key configured.
          </span>
        </div>
      )}

      {/* Per-backend API key field */}
      {selectedBackend === "minimax" && <>
        <label style={{ color: "#888", fontSize: 11 }}>MiniMax API Key (sk-api-...)</label>
        <div style={{ position: "relative" }}>
          <input
            type={showMinimaxToken ? "text" : "password"}
            value={minimaxToken}
            onChange={e => setMinimaxToken(e.target.value)}
            placeholder="Enter MiniMax API key"
            style={{ ...inputStyle, paddingRight: 60 }}
          />
          <button onClick={() => setShowMinimaxToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
            {showMinimaxToken ? "Hide" : "Show"}
          </button>
        </div>
      </>}

      {selectedBackend === "anthropic" && <>
        <label style={{ color: "#888", fontSize: 11 }}>Anthropic API Key (sk-ant-...)</label>
        <div style={{ position: "relative" }}>
          <input
            type={showAnthropicToken ? "text" : "password"}
            value={anthropicToken}
            onChange={e => setAnthropicToken(e.target.value)}
            placeholder="Enter Anthropic API key"
            style={{ ...inputStyle, paddingRight: 60 }}
          />
          <button onClick={() => setShowAnthropicToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
            {showAnthropicToken ? "Hide" : "Show"}
          </button>
        </div>
      </>}

      {selectedBackend === "glm" && <>
        <label style={{ color: "#888", fontSize: 11 }}>GLM API Key (智谱AI)</label>
        <div style={{ position: "relative" }}>
          <input
            type={showGlmToken ? "text" : "password"}
            value={glmToken}
            onChange={e => setGlmToken(e.target.value)}
            placeholder="Enter GLM API key"
            style={{ ...inputStyle, paddingRight: 60 }}
          />
          <button onClick={() => setShowGlmToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
            {showGlmToken ? "Hide" : "Show"}
          </button>
        </div>
        {glmTerminalWarning ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c8a45a', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: '#c8a45a' }}>
              GLM powers analysis only — the AI terminal requires a MiniMax key. Add one above to enable the terminal.
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 10, color: '#555' }}>GLM powers analysis features. For the AI terminal, also configure a MiniMax key.</span>
        )}
      </>}

      <label style={{ color: "#888", fontSize: 11 }}>Private Decision Dependancy</label>
      <input value={vault} onChange={e => setVault(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>Project Path</label>
      <input value={project} onChange={e => setProject(e.target.value)} style={inputStyle} />
      <label style={{ color: "#888", fontSize: 11 }}>Skills Path</label>
      <input value={skills} onChange={e => setSkills(e.target.value)} style={inputStyle} />

      {/* ── Account section ── */}
      <div style={{ borderTop: "1px solid #444", paddingTop: 12, marginTop: 4 }}>
        <label style={{ color: "#888", fontSize: 11, display: "block", marginBottom: 8 }}>Account Token (mact_...)</label>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input
            type={showAccountToken ? "text" : "password"}
            value={accountToken}
            onChange={e => setAccountToken(e.target.value)}
            placeholder="mact_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            style={{ ...inputStyle, paddingRight: 60, fontFamily: "monospace", fontSize: 11 }}
          />
          <button onClick={() => setShowAccountToken(v => !v)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 11 }}>
            {showAccountToken ? "Hide" : "Show"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          {accountChecking ? (
            <button
              disabled
              style={{
                background: "#1e1e1e", border: "1px solid #44444455", borderRadius: 4,
                color: "#555", cursor: "default", fontSize: 11, padding: "5px 12px", fontWeight: 600,
              }}
            >
              Checking…
            </button>
          ) : accountStatus ? (
            <button
              onClick={handleLogout}
              style={{
                background: "#3a1e1e", border: "1px solid #cc000055", borderRadius: 4,
                color: "#e05555", cursor: "pointer", fontSize: 11, padding: "5px 12px", fontWeight: 600,
              }}
            >
              Sign Out
            </button>
          ) : (
            <button
              onClick={openAuthPage}
              disabled={waitingForToken}
              style={{
                background: "#1e3a2e", border: "1px solid #007acc55", borderRadius: 4,
                color: waitingForToken ? "#555" : "#007acc", cursor: waitingForToken ? "default" : "pointer",
                fontSize: 11, padding: "5px 12px", fontWeight: 600,
              }}
            >
              {waitingForToken ? "Waiting for sign-in…" : "Sign In / Register ↗"}
            </button>
          )}
          <span style={{ fontSize: 10, color: "#555" }}>
            {accountChecking ? "" : accountStatus ? "Signed in — click to sign out and clear cloud skills" : waitingForToken ? "Complete sign-in in the browser window" : "Opens browser to create or retrieve your account token"}
          </span>
        </div>
        {/* Account status indicator */}
        <div style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
          {accountChecking ? (
            <span style={{ color: "#555" }}>Checking…</span>
          ) : accountStatus ? (
            <>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ec9b0", display: "inline-block" }} />
              <span style={{ color: "#4ec9b0" }}>Connected as </span>
              <span style={{ color: "#ccc" }}>{accountStatus.email}</span>
              {accountStatus.username && <span style={{ color: "#555" }}>(@{accountStatus.username})</span>}
            </>
          ) : accountToken ? (
            <>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e05555", display: "inline-block" }} />
              <span style={{ color: "#e05555" }}>Token not recognized</span>
            </>
          ) : (
            <>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#555", display: "inline-block" }} />
              <span style={{ color: "#555" }}>Not signed in — private skills won't sync</span>
            </>
          )}
        </div>
      </div>

      {/* ── Account & Sync panel (only when signed in) ── */}
      {accountStatus && (
        <div style={{ borderTop: "1px solid #333", paddingTop: 14, marginTop: 4, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t(uiLanguage, "account_sync_title")}
          </div>

          {/* Security notice */}
          <div style={{ display: "flex", gap: 8, background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 6, padding: "9px 11px", alignItems: "flex-start" }}>
            <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1 }}>🔒</span>
            <span style={{ fontSize: 10, color: "#4ec9b0", lineHeight: 1.5 }}>
              {t(uiLanguage, "sync_security_notice")}
            </span>
          </div>

          {/* API Keys sync row */}
          <div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>
              {t(uiLanguage, "api_keys_status")}
              <span style={{ marginLeft: 8 }}>
                {syncedAt ? (
                  <>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ec9b0", display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
                    <span style={{ color: "#4ec9b0" }}>{t(uiLanguage, "keys_synced_indicator")}</span>
                    <span style={{ color: "#444", marginLeft: 6 }}>
                      {t(uiLanguage, "last_synced", { date: new Date(syncedAt).toLocaleString() })}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#555", display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
                    <span style={{ color: "#555" }}>{t(uiLanguage, "keys_not_synced")}</span>
                  </>
                )}
              </span>
            </div>
            {/* Masked key preview */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[
                { label: "MiniMax", val: minimaxToken },
                { label: "Anthropic", val: anthropicToken },
                { label: "GLM", val: glmToken },
              ].filter(k => k.val).map(k => (
                <span key={k.label} style={{ fontSize: 9, fontFamily: "monospace", background: "#1a1a1a", border: "1px solid #333", borderRadius: 3, padding: "2px 7px", color: "#666" }}>
                  {k.label}: {k.val.slice(0, 7)}…{k.val.slice(-4)}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={syncToCloud}
                disabled={syncStatus === "syncing" || syncStatus === "restoring"}
                style={{
                  background: "#1a2a1a", border: "1px solid #2a4a2a", borderRadius: 4,
                  color: syncStatus === "syncing" ? "#555" : "#4ec9b0",
                  cursor: syncStatus === "syncing" ? "default" : "pointer",
                  fontSize: 10, padding: "5px 12px", fontWeight: 600,
                }}
              >
                {syncStatus === "syncing" ? t(uiLanguage, "syncing") : t(uiLanguage, "sync_api_keys")}
              </button>
              <button
                onClick={restoreFromCloud}
                disabled={syncStatus === "syncing" || syncStatus === "restoring"}
                style={{
                  background: "#1a1a2a", border: "1px solid #2a2a4a", borderRadius: 4,
                  color: syncStatus === "restoring" ? "#555" : "#7dd3fc",
                  cursor: syncStatus === "restoring" ? "default" : "pointer",
                  fontSize: 10, padding: "5px 12px", fontWeight: 600,
                }}
              >
                {syncStatus === "restoring" ? t(uiLanguage, "syncing") : t(uiLanguage, "restore_api_keys")}
              </button>
              {syncStatus === "ok" && (
                <span style={{ fontSize: 10, color: "#4ec9b0" }}>
                  ✓ {syncMsg === "ok_restore" ? t(uiLanguage, "restore_api_keys") : t(uiLanguage, "sync_success")}
                </span>
              )}
              {syncStatus === "error" && (
                <span style={{ fontSize: 10, color: "#e05555" }}>✗ {t(uiLanguage, "sync_error")}{syncMsg ? `: ${syncMsg}` : ""}</span>
              )}
            </div>
          </div>

          {/* Cloud dependencies */}
          <div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>
              {t(uiLanguage, "cloud_dependencies")}
              {!cloudDepsLoading && cloudDeps.length > 0 && (
                <span style={{ marginLeft: 6, color: "#444" }}>({cloudDeps.length})</span>
              )}
            </div>
            {cloudDepsLoading ? (
              <div style={{ fontSize: 10, color: "#444" }}>…</div>
            ) : cloudDeps.length === 0 ? (
              <div style={{ fontSize: 10, color: "#444" }}>{t(uiLanguage, "no_cloud_deps")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                {cloudDeps.map(dep => (
                  <div key={dep.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#111", borderRadius: 4, padding: "4px 8px" }}>
                    <span style={{ flex: 1, fontSize: 10, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dep.name}</span>
                    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, border: "1px solid #33333388", color: "#777" }}>{dep.type}</span>
                    {dep.version && <span style={{ fontSize: 9, color: "#444" }}>v{dep.version}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onClick={save}
        disabled={backendKeyMissing}
        title={backendKeyMissing ? `Add a ${backendKeyLabel} to save` : undefined}
        style={{ ...btnStyle(!backendKeyMissing), alignSelf: "flex-end", marginTop: 8, opacity: backendKeyMissing ? 0.45 : 1, cursor: backendKeyMissing ? "not-allowed" : "pointer" }}
      >
        {t(uiLanguage, "save")}
      </button>
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
