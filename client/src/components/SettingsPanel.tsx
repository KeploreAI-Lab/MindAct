import React, { useState, useEffect, useRef } from "react";
import { useStore } from "../store";
import type { Config } from "../store";
import { t } from "../i18n";
import { encryptApiKeys, decryptApiKeys } from "../lib/apiKeyCrypto";

const DEFAULT_REGISTRY_URL = "https://registry.physical-mind.ai";

type SettingsTab = "account" | "ai_model" | "paths" | "advanced";

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#d4d4d4",
  padding: "7px 10px",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  marginBottom: 4,
  display: "block",
  fontWeight: 600,
  letterSpacing: 0.3,
};

const hintStyle: React.CSSProperties = {
  color: "#555",
  fontSize: 10,
  marginTop: 3,
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const fieldGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

function PasswordInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 52, fontFamily: "monospace", fontSize: 11 }}
      />
      <button
        onClick={() => setShow(v => !v)}
        style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 10,
        }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

// ── Tab: Account & Sync ───────────────────────────────────────────────────────
function AccountTab({
  accountToken, setAccountToken,
  minimaxToken, anthropicToken, glmToken, nvidiaToken, customKey,
  customProviderUrl, customProviderModel, customProviderModelFast,
  onRestoreKeys,
}: {
  accountToken: string; setAccountToken: (v: string) => void;
  minimaxToken: string; anthropicToken: string; glmToken: string;
  nvidiaToken: string; customKey: string;
  customProviderUrl: string; customProviderModel: string; customProviderModelFast: string;
  onRestoreKeys: (keys: {
    minimax_token?: string; anthropic_token?: string; glm_token?: string;
    nvidia_token?: string; custom_key?: string;
    custom_provider_url?: string; custom_provider_model?: string; custom_provider_model_fast?: string;
  }) => void;
}) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [accountStatus, setAccountStatus] = useState<{ email: string; username?: string } | null>(null);
  const [accountChecking, setAccountChecking] = useState(() => {
    return accountToken.startsWith("mact_") && accountToken.length >= 20;
  });
  const [waitingForToken, setWaitingForToken] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusHandlerRef = useRef<(() => void) | null>(null);

  const [syncStatus, setSyncStatus] = useState<null | "syncing" | "restoring" | "ok" | "error">(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [cloudDeps, setCloudDeps] = useState<Array<{ id: string; name: string; type: string; version?: string }>>([]);
  const [cloudDepsLoading, setCloudDepsLoading] = useState(false);

  useEffect(() => {
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

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!accountStatus) { setSyncedAt(null); setCloudDeps([]); return; }
    fetch("/api/user/api-keys")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => { if (d?.updated_at) setSyncedAt(d.updated_at); })
      .catch(() => {});
    setCloudDepsLoading(true);
    fetch("/api/registry/list")
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const items = (d?.items ?? [])
          .filter((it: any) => it.visibility === "private" || it.visibility === "org")
          .map((it: any) => ({ id: it.id, name: it.name, type: it.type, version: it.version }));
        setCloudDeps(items);
      })
      .catch(() => {})
      .finally(() => setCloudDepsLoading(false));
  }, [accountStatus]);

  const openAuthPage = () => {
    const registryUrl = DEFAULT_REGISTRY_URL;
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
    if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
    focusHandlerRef.current = () => checkToken();
    window.addEventListener("focus", focusHandlerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      attempts++;
      checkToken();
      if (attempts >= 90) { setWaitingForToken(false); stopPolling(); }
    }, 2000);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccountToken("");
    setAccountStatus(null);
  };

  const syncToCloud = async () => {
    if (!accountToken) return;
    setSyncStatus("syncing"); setSyncMsg("");
    try {
      const keys = {
        minimax_token: minimaxToken || undefined,
        anthropic_token: anthropicToken || undefined,
        glm_token: glmToken || undefined,
        nvidia_token: nvidiaToken || undefined,
        custom_key: customKey || undefined,
        // Include non-secret custom provider config alongside the key so restore works on a new device
        custom_provider_url: customProviderUrl || undefined,
        custom_provider_model: customProviderModel || undefined,
        custom_provider_model_fast: customProviderModelFast || undefined,
      };
      const encrypted = await encryptApiKeys(keys, accountToken);
      // provider_list: only the providers that have a key set (no actual key values)
      const provider_list = [
        minimaxToken && "minimax",
        anthropicToken && "anthropic",
        glmToken && "glm",
        nvidiaToken && "nvidia",
        customKey && "custom",
      ].filter(Boolean) as string[];
      const res = await fetch("/api/user/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted, provider_list }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json() as any;
      setSyncedAt(data.updated_at ?? new Date().toISOString());
      setSyncStatus("ok");
    } catch (e: any) { setSyncStatus("error"); setSyncMsg(e.message ?? ""); }
  };

  const restoreFromCloud = async () => {
    if (!accountToken) return;
    setSyncStatus("restoring"); setSyncMsg("");
    try {
      const res = await fetch("/api/user/api-keys");
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json() as any;
      if (!data?.encrypted) throw new Error("No backup found");
      const keys = await decryptApiKeys(data.encrypted, accountToken);
      onRestoreKeys(keys);
      if (data.updated_at) setSyncedAt(data.updated_at);
      setSyncStatus("ok"); setSyncMsg("ok_restore");
    } catch (e: any) { setSyncStatus("error"); setSyncMsg(e.message ?? ""); }
  };

  return (
    <div style={sectionStyle}>
      {/* Token input */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>Account Token</label>
        <PasswordInput value={accountToken} onChange={setAccountToken} placeholder="mact_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
        <span style={hintStyle}>
          {accountChecking ? "Checking…"
            : accountStatus ? `Connected as ${accountStatus.email}${accountStatus.username ? ` (@${accountStatus.username})` : ""}`
            : accountToken ? "Token not recognized"
            : "Sign in to enable cloud sync and private skills"}
        </span>
      </div>

      {/* Status indicator + buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block",
          background: accountChecking ? "#555" : accountStatus ? "#4ec9b0" : accountToken ? "#e05555" : "#444",
        }} />
        {accountChecking ? (
          <button disabled style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#555", cursor: "default", fontSize: 11, padding: "5px 14px" }}>
            Checking…
          </button>
        ) : accountStatus ? (
          <button onClick={handleLogout} style={{ background: "#3a1e1e", border: "1px solid #cc000055", borderRadius: 4, color: "#e05555", cursor: "pointer", fontSize: 11, padding: "5px 14px", fontWeight: 600 }}>
            Sign Out
          </button>
        ) : (
          <button onClick={openAuthPage} disabled={waitingForToken} style={{ background: "#1e3a2e", border: "1px solid #007acc55", borderRadius: 4, color: waitingForToken ? "#555" : "#007acc", cursor: waitingForToken ? "default" : "pointer", fontSize: 11, padding: "5px 14px", fontWeight: 600 }}>
            {waitingForToken ? "Waiting for sign-in…" : "Sign In / Register ↗"}
          </button>
        )}
      </div>

      {/* Cloud sync section — only when signed in */}
      {accountStatus && (
        <>
          <div style={{ borderTop: "1px solid #333", paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
              {t(uiLanguage, "account_sync_title")}
            </div>

            {/* Security notice */}
            <div style={{ display: "flex", gap: 8, background: "#0d1a10", border: "1px solid #1a3a1a", borderRadius: 6, padding: "9px 11px", alignItems: "flex-start", marginBottom: 10 }}>
              <span style={{ fontSize: 13, flexShrink: 0 }}>🔒</span>
              <span style={{ fontSize: 10, color: "#4ec9b0", lineHeight: 1.5 }}>{t(uiLanguage, "sync_security_notice")}</span>
            </div>

            {/* API key status + masked preview */}
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>
              {t(uiLanguage, "api_keys_status")}
              <span style={{ marginLeft: 8 }}>
                {syncedAt ? (
                  <>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ec9b0", display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
                    <span style={{ color: "#4ec9b0" }}>{t(uiLanguage, "keys_synced_indicator")}</span>
                    <span style={{ color: "#444", marginLeft: 6 }}>{t(uiLanguage, "last_synced", { date: new Date(syncedAt).toLocaleString() })}</span>
                  </>
                ) : (
                  <>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#555", display: "inline-block", marginRight: 4, verticalAlign: "middle" }} />
                    <span style={{ color: "#555" }}>{t(uiLanguage, "keys_not_synced")}</span>
                  </>
                )}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {[
                { label: "MiniMax", val: minimaxToken },
                { label: "Anthropic", val: anthropicToken },
                { label: "GLM", val: glmToken },
                { label: "Nvidia", val: nvidiaToken },
                { label: "Custom", val: customKey },
              ].filter(k => k.val).map(k => (
                <span key={k.label} style={{ fontSize: 9, fontFamily: "monospace", background: "#1a1a1a", border: "1px solid #333", borderRadius: 3, padding: "2px 7px", color: "#666" }}>
                  {k.label}: {k.val.slice(0, 7)}…{k.val.slice(-4)}
                </span>
              ))}
            </div>

            {/* Sync buttons */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={syncToCloud} disabled={syncStatus === "syncing" || syncStatus === "restoring"}
                style={{ background: "#1a2a1a", border: "1px solid #2a4a2a", borderRadius: 4, color: syncStatus === "syncing" ? "#555" : "#4ec9b0", cursor: syncStatus === "syncing" ? "default" : "pointer", fontSize: 10, padding: "5px 12px", fontWeight: 600 }}>
                {syncStatus === "syncing" ? t(uiLanguage, "syncing") : t(uiLanguage, "sync_api_keys")}
              </button>
              <button onClick={restoreFromCloud} disabled={syncStatus === "syncing" || syncStatus === "restoring"}
                style={{ background: "#1a1a2a", border: "1px solid #2a2a4a", borderRadius: 4, color: syncStatus === "restoring" ? "#555" : "#7dd3fc", cursor: syncStatus === "restoring" ? "default" : "pointer", fontSize: 10, padding: "5px 12px", fontWeight: 600 }}>
                {syncStatus === "restoring" ? t(uiLanguage, "syncing") : t(uiLanguage, "restore_api_keys")}
              </button>
              {syncStatus === "ok" && <span style={{ fontSize: 10, color: "#4ec9b0" }}>✓ {t(uiLanguage, "sync_success")}</span>}
              {syncStatus === "error" && <span style={{ fontSize: 10, color: "#e05555" }}>✗ {t(uiLanguage, "sync_error")}{syncMsg ? `: ${syncMsg}` : ""}</span>}
            </div>
          </div>

          {/* Cloud dependencies */}
          <div>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>
              {t(uiLanguage, "cloud_dependencies")}
              {!cloudDepsLoading && cloudDeps.length > 0 && <span style={{ marginLeft: 6, color: "#444" }}>({cloudDeps.length})</span>}
            </div>
            {cloudDepsLoading ? <div style={{ fontSize: 10, color: "#444" }}>…</div>
              : cloudDeps.length === 0 ? <div style={{ fontSize: 10, color: "#444" }}>{t(uiLanguage, "no_cloud_deps")}</div>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 110, overflowY: "auto" }}>
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
        </>
      )}
    </div>
  );
}

// ── Tab: AI Model ─────────────────────────────────────────────────────────────
function AiModelTab({
  selectedBackend, setSelectedBackend,
  minimaxToken, setMinimaxToken,
  anthropicToken, setAnthropicToken,
  glmToken, setGlmToken,
  nvidiaToken, setNvidiaToken,
  customKey, setCustomKey,
  customProviderUrl, setCustomProviderUrl,
  customProviderModel, setCustomProviderModel,
  customProviderModelFast, setCustomProviderModelFast,
}: {
  selectedBackend: "minimax" | "anthropic" | "glm" | "nvidia" | "custom";
  setSelectedBackend: (v: "minimax" | "anthropic" | "glm" | "nvidia" | "custom") => void;
  minimaxToken: string; setMinimaxToken: (v: string) => void;
  anthropicToken: string; setAnthropicToken: (v: string) => void;
  glmToken: string; setGlmToken: (v: string) => void;
  nvidiaToken: string; setNvidiaToken: (v: string) => void;
  customKey: string; setCustomKey: (v: string) => void;
  customProviderUrl: string; setCustomProviderUrl: (v: string) => void;
  customProviderModel: string; setCustomProviderModel: (v: string) => void;
  customProviderModelFast: string; setCustomProviderModelFast: (v: string) => void;
}) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const backendKeyMissing =
    (selectedBackend === "minimax" && !minimaxToken.trim()) ||
    (selectedBackend === "anthropic" && !anthropicToken.trim()) ||
    (selectedBackend === "glm" && !glmToken.trim()) ||
    (selectedBackend === "nvidia" && !nvidiaToken.trim()) ||
    (selectedBackend === "custom" && (!customKey.trim() || !customProviderUrl.trim() || !customProviderModel.trim()));
  const backendKeyLabel =
    selectedBackend === "minimax" ? "MiniMax API key (sk-api-...)" :
    selectedBackend === "anthropic" ? "Anthropic API key (sk-ant-...)" :
    selectedBackend === "nvidia" ? "Nvidia API key" :
    selectedBackend === "custom" ? "Custom provider URL + model + API key" : "GLM API key";
  const glmTerminalWarning = selectedBackend === "glm" && glmToken.trim() && !minimaxToken.trim();

  const backendLabels: Record<string, string> = {
    minimax: "MiniMax",
    anthropic: "Claude",
    glm: "GLM (智谱)",
    nvidia: "Nvidia NIM",
    custom: "Custom",
  };

  return (
    <div style={sectionStyle}>
      {/* Backend selector */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_backend_label")}</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["minimax", "anthropic", "glm", "nvidia", "custom"] as const).map(b => {
            const active = selectedBackend === b;
            return (
              <button key={b} onClick={() => setSelectedBackend(b)} style={{
                flex: "1 1 auto", padding: "7px 6px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                border: active ? "1px solid #007acc" : "1px solid #444",
                background: active ? "#1e3a4f" : "#1e1e1e",
                color: active ? "#007acc" : "#888",
                fontWeight: active ? 600 : 400,
                transition: "all 0.15s",
              }}>
                {backendLabels[b]}
              </button>
            );
          })}
        </div>
        {backendKeyMissing && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e05555", display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: "#e05555" }}>
              {t(uiLanguage, "settings_apikey_missing", { label: backendKeyLabel })}
            </span>
          </div>
        )}
      </div>

      {/* MiniMax key */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>MiniMax API Key</label>
        <PasswordInput value={minimaxToken} onChange={setMinimaxToken} placeholder="sk-api-..." />
        {selectedBackend !== "minimax" && (
          <span style={hintStyle}>Used by GLM backend for AI terminal</span>
        )}
      </div>

      {/* Anthropic key */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>Anthropic API Key</label>
        <PasswordInput value={anthropicToken} onChange={setAnthropicToken} placeholder="sk-ant-..." />
      </div>

      {/* GLM key */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>GLM API Key (智谱AI)</label>
        <PasswordInput value={glmToken} onChange={setGlmToken} placeholder="Enter GLM API key" />
        {glmTerminalWarning && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c8a45a", display: "inline-block", flexShrink: 0 }} />
            <span style={{ color: "#c8a45a" }}>{t(uiLanguage, "settings_glm_terminal_warning")}</span>
          </div>
        )}
      </div>

      {/* Nvidia key */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>Nvidia NIM API Key</label>
        <PasswordInput value={nvidiaToken} onChange={setNvidiaToken} placeholder="nvapi-..." />
        <span style={hintStyle}>
          Free-tier via <span style={{ color: "#7dd3fc" }}>build.nvidia.com</span> — includes Kimi 2.5, Llama 3, and more
        </span>
      </div>

      {/* Custom provider */}
      <div style={{ ...fieldGroupStyle, borderTop: "1px solid #2a2a2a", paddingTop: 14 }}>
        <div style={{ fontSize: 10, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          Custom Provider (OpenAI-compatible)
        </div>
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Base URL</label>
          <input
            value={customProviderUrl}
            onChange={e => setCustomProviderUrl(e.target.value)}
            style={inputStyle}
            placeholder="https://your-provider.com/v1"
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ ...fieldGroupStyle, flex: 1 }}>
            <label style={labelStyle}>Default Model</label>
            <input
              value={customProviderModel}
              onChange={e => setCustomProviderModel(e.target.value)}
              style={inputStyle}
              placeholder="model-name"
            />
          </div>
          <div style={{ ...fieldGroupStyle, flex: 1 }}>
            <label style={labelStyle}>Fast Model <span style={{ color: "#444" }}>(optional)</span></label>
            <input
              value={customProviderModelFast}
              onChange={e => setCustomProviderModelFast(e.target.value)}
              style={inputStyle}
              placeholder="model-name-fast"
            />
          </div>
        </div>
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>API Key</label>
          <PasswordInput value={customKey} onChange={setCustomKey} placeholder="Enter API key" />
        </div>
      </div>
    </div>
  );
}

// ── Tab: Paths ────────────────────────────────────────────────────────────────
function PathsTab({
  vault, setVault, project, setProject, skills, setSkills,
}: { vault: string; setVault: (v: string) => void; project: string; setProject: (v: string) => void; skills: string; setSkills: (v: string) => void; }) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const pickDir = async () => {
    const api = (window as any).electronAPI;
    if (api?.pickFolder) {
      const res = await api.pickFolder();
      if (!res.canceled && res.filePaths?.[0]) return res.filePaths[0] as string;
    }
    return null;
  };

  return (
    <div style={sectionStyle}>
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_vault_label")}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={vault} onChange={e => setVault(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="/path/to/vault" />
          <button onClick={async () => { const p = await pickDir(); if (p) setVault(p); }}
            style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#888", cursor: "pointer", fontSize: 11, padding: "0 12px", whiteSpace: "nowrap" }}>
            Browse
          </button>
        </div>
        <span style={hintStyle}>{t(uiLanguage, "settings_vault_hint")}</span>
      </div>

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_project_label")}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={project} onChange={e => setProject(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="/path/to/project" />
          <button onClick={async () => { const p = await pickDir(); if (p) setProject(p); }}
            style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#888", cursor: "pointer", fontSize: 11, padding: "0 12px", whiteSpace: "nowrap" }}>
            Browse
          </button>
        </div>
        <span style={hintStyle}>{t(uiLanguage, "settings_project_hint")}</span>
      </div>

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_skills_label")}</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={skills} onChange={e => setSkills(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="/path/to/skills" />
          <button onClick={async () => { const p = await pickDir(); if (p) setSkills(p); }}
            style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#888", cursor: "pointer", fontSize: 11, padding: "0 12px", whiteSpace: "nowrap" }}>
            Browse
          </button>
        </div>
        <span style={hintStyle}>{t(uiLanguage, "settings_skills_hint")}</span>
      </div>
    </div>
  );
}

// ── Tab: Advanced ─────────────────────────────────────────────────────────────
function AdvancedTab({
  registryUrl, setRegistryUrl, adminUrl, setAdminUrl, onContactUs,
}: { registryUrl: string; setRegistryUrl: (v: string) => void; adminUrl: string; setAdminUrl: (v: string) => void; onContactUs?: () => void; }) {
  const uiLanguage = useStore(s => s.uiLanguage);
  return (
    <div style={sectionStyle}>
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_registry_label")}</label>
        <input value={registryUrl} onChange={e => setRegistryUrl(e.target.value)} style={inputStyle} placeholder="https://registry.physical-mind.ai" />
        <span style={hintStyle}>{t(uiLanguage, "settings_registry_hint")}</span>
      </div>
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>{t(uiLanguage, "settings_admin_label")}</label>
        <input value={adminUrl} onChange={e => setAdminUrl(e.target.value)} style={inputStyle} placeholder="" />
        <span style={hintStyle}>{t(uiLanguage, "settings_admin_hint")}</span>
      </div>

      <div style={{ borderTop: "1px solid #333", paddingTop: 16, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
          {t(uiLanguage, "feedback_title")}
        </div>
        <p style={{ fontSize: 11, color: "#666", margin: "0 0 10px", lineHeight: 1.6 }}>
          {uiLanguage === "zh"
            ? "遇到问题或有功能建议？我们很乐意听取反馈。"
            : "Found a bug or have a suggestion? We'd love to hear from you."}
        </p>
        <button onClick={onContactUs} style={{ background: "#1e2a3a", border: "1px solid #2a4a6a", borderRadius: 4, color: "#7dd3fc", cursor: "pointer", fontSize: 11, padding: "6px 16px", fontWeight: 600 }}>
          {t(uiLanguage, "feedback_title")} ↗
        </button>
      </div>
    </div>
  );
}

// ── Main SettingsPanel ────────────────────────────────────────────────────────
export default function SettingsPanel({
  config, onSave, onClose, onContactUs,
}: {
  config: Config;
  onSave: (c: Config) => void;
  onClose: () => void;
  onContactUs?: () => void;
}) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");

  // Form state — all tabs share one state block so Save works across tabs
  const [vault, setVault] = useState(config.vault_path);
  const [project, setProject] = useState(config.project_path);
  const [skills, setSkills] = useState(config.skills_path);
  const [selectedBackend, setSelectedBackend] = useState<"minimax" | "anthropic" | "glm" | "nvidia" | "custom">(config.selected_backend ?? "minimax");
  const [minimaxToken, setMinimaxToken] = useState(config.minimax_token ?? "");
  const [anthropicToken, setAnthropicToken] = useState(config.anthropic_token ?? "");
  const [glmToken, setGlmToken] = useState(config.glm_token ?? "");
  const [nvidiaToken, setNvidiaToken] = useState(config.nvidia_token ?? "");
  const [customProviderKey, setCustomProviderKey] = useState(config.custom_provider_key ?? "");
  const [customProviderUrl, setCustomProviderUrl] = useState(config.custom_provider_url ?? "");
  const [customProviderModel, setCustomProviderModel] = useState(config.custom_provider_model ?? "");
  const [customProviderModelFast, setCustomProviderModelFast] = useState(config.custom_provider_model_fast ?? "");
  const [accountToken, setAccountToken] = useState(config.account_token ?? "");
  const [registryUrl, setRegistryUrl] = useState(config.registry_url ?? "");
  const [adminUrl, setAdminUrl] = useState(config.admin_url ?? "");

  useEffect(() => {
    setVault(config.vault_path);
    setProject(config.project_path);
    setSkills(config.skills_path);
    setSelectedBackend(config.selected_backend ?? "minimax");
    setMinimaxToken(config.minimax_token ?? "");
    setAnthropicToken(config.anthropic_token ?? "");
    setGlmToken(config.glm_token ?? "");
    setNvidiaToken(config.nvidia_token ?? "");
    setCustomProviderKey(config.custom_provider_key ?? "");
    setCustomProviderUrl(config.custom_provider_url ?? "");
    setCustomProviderModel(config.custom_provider_model ?? "");
    setCustomProviderModelFast(config.custom_provider_model_fast ?? "");
    setAccountToken(config.account_token ?? "");
    setRegistryUrl(config.registry_url ?? "");
    setAdminUrl(config.admin_url ?? "");
  }, [config]);

  const backendKeyMissing =
    (selectedBackend === "minimax" && !minimaxToken.trim()) ||
    (selectedBackend === "anthropic" && !anthropicToken.trim()) ||
    (selectedBackend === "glm" && !glmToken.trim()) ||
    (selectedBackend === "nvidia" && !nvidiaToken.trim()) ||
    (selectedBackend === "custom" && (!customProviderKey.trim() || !customProviderUrl.trim() || !customProviderModel.trim()));

  const save = () => {
    const c: Config = {
      vault_path: vault,
      project_path: project,
      skills_path: skills,
      panel_ratio: config.panel_ratio,
      selected_backend: selectedBackend,
      minimax_token: minimaxToken || undefined,
      anthropic_token: anthropicToken || undefined,
      glm_token: glmToken || undefined,
      nvidia_token: nvidiaToken || undefined,
      custom_provider_key: customProviderKey || undefined,
      custom_provider_url: customProviderUrl || undefined,
      custom_provider_model: customProviderModel || undefined,
      custom_provider_model_fast: customProviderModelFast || undefined,
      account_token: accountToken || undefined,
      registry_url: registryUrl || undefined,
      admin_url: adminUrl || undefined,
    };
    fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Save failed" }));
          alert((err as any).error || "Save failed");
          return;
        }
        onSave(c);
      });
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "account",  label: t(uiLanguage, "settings_tab_account") },
    { id: "ai_model", label: t(uiLanguage, "settings_tab_ai_model") },
    { id: "paths",    label: t(uiLanguage, "settings_tab_paths") },
    { id: "advanced", label: t(uiLanguage, "settings_tab_advanced") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px", borderBottom: "1px solid #333", flexShrink: 0 }}>
        <span style={{ color: "#d4d4d4", fontWeight: 700, fontSize: 14 }}>{t(uiLanguage, "settings")}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 6px" }}>✕</button>
      </div>

      {/* Body: left nav + right content */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left nav */}
        <div style={{ width: 155, borderRight: "1px solid #333", padding: "10px 0", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "9px 16px", fontSize: 12, border: "none", borderRadius: 0, cursor: "pointer",
              background: activeTab === tab.id ? "#2a2d2e" : "transparent",
              color: activeTab === tab.id ? "#d4d4d4" : "#888",
              fontWeight: activeTab === tab.id ? 600 : 400,
              borderLeft: activeTab === tab.id ? "2px solid #007acc" : "2px solid transparent",
              transition: "all 0.1s",
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div style={{ flex: 1, padding: "20px", overflowY: "auto", minWidth: 0 }}>
          {activeTab === "account" && (
            <AccountTab
              accountToken={accountToken} setAccountToken={setAccountToken}
              minimaxToken={minimaxToken} anthropicToken={anthropicToken} glmToken={glmToken}
              nvidiaToken={nvidiaToken} customKey={customProviderKey}
              customProviderUrl={customProviderUrl} customProviderModel={customProviderModel} customProviderModelFast={customProviderModelFast}
              onRestoreKeys={keys => {
                if (keys.minimax_token !== undefined) setMinimaxToken(keys.minimax_token);
                if (keys.anthropic_token !== undefined) setAnthropicToken(keys.anthropic_token);
                if (keys.glm_token !== undefined) setGlmToken(keys.glm_token);
                if (keys.nvidia_token !== undefined) setNvidiaToken(keys.nvidia_token);
                if (keys.custom_key !== undefined) setCustomProviderKey(keys.custom_key);
                if (keys.custom_provider_url !== undefined) setCustomProviderUrl(keys.custom_provider_url);
                if (keys.custom_provider_model !== undefined) setCustomProviderModel(keys.custom_provider_model);
                if (keys.custom_provider_model_fast !== undefined) setCustomProviderModelFast(keys.custom_provider_model_fast);
              }}
            />
          )}
          {activeTab === "ai_model" && (
            <AiModelTab
              selectedBackend={selectedBackend} setSelectedBackend={setSelectedBackend}
              minimaxToken={minimaxToken} setMinimaxToken={setMinimaxToken}
              anthropicToken={anthropicToken} setAnthropicToken={setAnthropicToken}
              glmToken={glmToken} setGlmToken={setGlmToken}
              nvidiaToken={nvidiaToken} setNvidiaToken={setNvidiaToken}
              customKey={customProviderKey} setCustomKey={setCustomProviderKey}
              customProviderUrl={customProviderUrl} setCustomProviderUrl={setCustomProviderUrl}
              customProviderModel={customProviderModel} setCustomProviderModel={setCustomProviderModel}
              customProviderModelFast={customProviderModelFast} setCustomProviderModelFast={setCustomProviderModelFast}
            />
          )}
          {activeTab === "paths" && (
            <PathsTab vault={vault} setVault={setVault} project={project} setProject={setProject} skills={skills} setSkills={setSkills} />
          )}
          {activeTab === "advanced" && (
            <AdvancedTab registryUrl={registryUrl} setRegistryUrl={setRegistryUrl} adminUrl={adminUrl} setAdminUrl={setAdminUrl} onContactUs={onContactUs} />
          )}
        </div>
      </div>

      {/* Footer: Save button */}
      <div style={{ borderTop: "1px solid #333", padding: "12px 20px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {backendKeyMissing && (
          <span style={{ fontSize: 11, color: "#e05555", flex: 1 }}>
            {t(uiLanguage, "settings_apikey_missing", {
              label: selectedBackend === "minimax" ? "MiniMax"
                : selectedBackend === "anthropic" ? "Anthropic"
                : selectedBackend === "glm" ? "GLM"
                : selectedBackend === "nvidia" ? "Nvidia"
                : "Custom provider",
            })}
          </span>
        )}
        <button onClick={onClose} style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#888", cursor: "pointer", fontSize: 12, padding: "6px 18px" }}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={backendKeyMissing}
          style={{
            background: backendKeyMissing ? "#2a2a2a" : "#007acc",
            border: "1px solid " + (backendKeyMissing ? "#444" : "#007acc"),
            borderRadius: 4, color: backendKeyMissing ? "#444" : "#fff",
            cursor: backendKeyMissing ? "not-allowed" : "pointer",
            fontSize: 12, padding: "6px 20px", fontWeight: 600,
          }}
        >
          {t(uiLanguage, "save")}
        </button>
      </div>
    </div>
  );
}
