import React, { useState, useCallback, useEffect } from "react";
import { useStore, TreeNode, type RegistryConnectionStatus } from "../store";
import FileTree from "./FileTree";
import Editor from "./Editor";
import { t } from "../i18n";
import type { DecisionDependency } from "../types/analysis";

// ─── Type helpers ─────────────────────────────────────────────────────────────

function typeIcon(type: string): string {
  switch (type) {
    case "skill":     return "⚡";
    case "knowledge": return "📚";
    case "connector": return "🔌";
    case "memory":    return "🧠";
    default:          return "📦";
  }
}

function trustColor(trust: string): string {
  switch (trust) {
    case "org-approved": return "#4ec9b0";
    case "reviewed":     return "#7dd3fc";
    default:             return "#c8a45a";
  }
}

const MATURITY_DESCS: Record<string, { en: string; zh: string }> = {
  L0: { en: "L0 · Draft — experimental, may be incomplete", zh: "L0 · 草稿 — 实验性，可能不完整" },
  L1: { en: "L1 · Basic — functional but limited in scope",  zh: "L1 · 基础可用 — 功能有限" },
  L2: { en: "L2 · Tested — reliable for most use cases",    zh: "L2 · 已测试 — 大多数场景下可靠" },
  L3: { en: "L3 · Production — fully certified and robust", zh: "L3 · 生产就绪 — 已认证，稳定可用" },
};

function maturityBar(maturity: string, lang: string): React.ReactNode {
  const level = parseInt(maturity?.replace("L", "") ?? "0", 10);
  const key = maturity ?? "L0";
  const tooltip = MATURITY_DESCS[key]?.[lang === "zh" ? "zh" : "en"] ?? key;
  return (
    <div title={tooltip} style={{ display: "flex", gap: 2, alignItems: "center", cursor: "default" }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: 1,
          background: i < level ? "#4ec9b0" : "#333",
        }} />
      ))}
      <span style={{ fontSize: 8, color: "#555", marginLeft: 2 }}>{key}</span>
    </div>
  );
}

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

// ─── GitHub Import Wizard ─────────────────────────────────────────────────────

interface GitHubCandidate {
  draft: DecisionDependency;
  maturity: string;
  confidence: number;
  explanation: string;
  recommendations: string[];
  missingFields: string[];
}

interface GitHubPreview {
  candidates: GitHubCandidate[];
  repoMeta: { url: string; ref: string; commitSha?: string; importHash: string };
}

function GitHubImportWizard({ onClose, onImported, lang }: {
  onClose: () => void;
  onImported: () => void;
  lang: string;
}) {
  const [step, setStep] = useState<"input" | "preview" | "confirm">("input");
  const [repoUrl, setRepoUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<GitHubPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [uploadToCloud, setUploadToCloud] = useState(false);

  const handlePreview = async () => {
    if (!repoUrl.trim()) { setError("GitHub URL is required"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/registry/import/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), ref: ref.trim() || "main" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Preview failed"); return; }
      setPreview(data as GitHubPreview);
      setSelected((data as GitHubPreview).candidates.map((_, i) => i));
      setStep("preview");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview || selected.length === 0) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/registry/import/github/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importHash: preview.repoMeta.importHash,
          selectedCandidates: selected,
          overrides: selected.map(() => ({})),
          previewCandidates: preview.candidates.map(c => c.draft),
          uploadToCloud,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Confirm failed"); return; }
      onImported();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{
      position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)",
      zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#1a1a24", border: "1px solid #444", borderRadius: 8,
        width: "min(520px, 92%)", maxHeight: "80vh", overflow: "auto",
        padding: "16px 18px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ color: "#ccc", fontWeight: 700, fontSize: 13 }}>
            {lang === "zh" ? "从 GitHub 导入" : "Import from GitHub"}
            <span style={{ marginLeft: 8, fontSize: 10, color: "#555" }}>
              {step === "input" ? "1/3" : step === "preview" ? "2/3" : "3/3"}
            </span>
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>

        {error && (
          <div style={{ padding: "6px 10px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555", marginBottom: 10 }}>
            {error}
          </div>
        )}

        {step === "input" && (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: "#666", display: "block", marginBottom: 4 }}>GitHub URL</label>
              <input
                value={repoUrl}
                onChange={e => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                style={{ width: "100%", boxSizing: "border-box", background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#d4d4d4", padding: "7px 10px", fontSize: 12, outline: "none" }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 10, color: "#666", display: "block", marginBottom: 4 }}>Branch / Ref</label>
              <input
                value={ref}
                onChange={e => setRef(e.target.value)}
                placeholder="main"
                style={{ width: "100%", boxSizing: "border-box", background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#d4d4d4", padding: "7px 10px", fontSize: 12, outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
              <button onClick={handlePreview} disabled={loading} style={primaryBtnStyle}>
                {loading ? "Scanning..." : "Preview →"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && preview && (
          <>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>
              Found <b style={{ color: "#ccc" }}>{preview.candidates.length}</b> candidate(s) in {preview.repoMeta.url}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {preview.candidates.map((c, i) => (
                <div key={i} style={{
                  padding: "8px 10px", background: selected.includes(i) ? "#0a1a0a" : "#1a1a1a",
                  border: `1px solid ${selected.includes(i) ? "#4ec9b044" : "#333"}`,
                  borderRadius: 6, cursor: "pointer",
                }}
                  onClick={() => setSelected(sel =>
                    sel.includes(i) ? sel.filter(s => s !== i) : [...sel, i]
                  )}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12 }}>{typeIcon(c.draft.type)}</span>
                    <span style={{ fontSize: 11, color: "#ccc", fontWeight: 600 }}>{c.draft.name}</span>
                    <span style={{ fontSize: 8, background: "#333", borderRadius: 3, padding: "1px 5px", color: "#888" }}>{c.maturity}</span>
                    <span style={{ fontSize: 9, color: selected.includes(i) ? "#4ec9b0" : "#555", marginLeft: "auto" }}>
                      {selected.includes(i) ? "✓ Selected" : "○ Skip"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{c.explanation}</div>
                  {c.recommendations.length > 0 && (
                    <div style={{ fontSize: 9, color: "#c8a45a", marginTop: 4 }}>
                      💡 {c.recommendations[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Upload-to-cloud toggle */}
            <div style={{
              marginBottom: 12, padding: "8px 10px", background: "#111118",
              border: "1px solid #333", borderRadius: 6,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: 1 }}>
                <input
                  type="checkbox"
                  checked={uploadToCloud}
                  onChange={e => setUploadToCloud(e.target.checked)}
                  style={{ accentColor: "#4ec9b0" }}
                />
                <span style={{ fontSize: 11, color: "#ccc" }}>
                  {lang === "zh" ? "上传到云端注册表" : "Upload to cloud registry"}
                </span>
              </label>
              <span style={{ fontSize: 9, color: "#555" }}>
                {uploadToCloud
                  ? (lang === "zh" ? "将打包并上传到 R2，状态为 pending（需管理员审核）" : "Packs & uploads to R2 — status: pending (admin review required)")
                  : (lang === "zh" ? "仅写入本地磁盘" : "Local disk only")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setStep("input")} style={ghostBtn}>← Back</button>
              <button onClick={handleConfirm} disabled={selected.length === 0 || confirming} style={primaryBtnStyle}>
                {confirming ? (lang === "zh" ? "导入中…" : "Importing…") : `Import ${selected.length} →`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Registry Card ────────────────────────────────────────────────────────────

function RegistryCard({ dd, lang, onInstalled }: { dd: DecisionDependency; lang: string; onInstalled?: () => void }) {
  const { installedPackageIds, installProgress, markInstalled, setInstallProgress, clearInstallProgress } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showUntrustedDialog, setShowUntrustedDialog] = useState(false);
  const color = trustColor(dd.trust);

  const isInstalled = installedPackageIds.has(dd.id);
  const progress = installProgress.get(dd.id);
  const isInstalling = progress !== undefined;

  const handleExpand = async () => {
    if (!expanded && content === null) {
      setLoadingContent(true);
      try {
        const res = await fetch(`/api/registry/item/${encodeURIComponent(dd.id)}/content`);
        if (res.ok) setContent(await res.text());
      } catch {}
      setLoadingContent(false);
    }
    setExpanded(!expanded);
  };

  const doInstall = async () => {
    setInstallError(null);
    setInstallProgress(dd.id, 10);
    try {
      setInstallProgress(dd.id, 30);
      const res = await fetch("/api/registry/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: dd.id, version: dd.version }),
      });
      setInstallProgress(dd.id, 80);
      const data = await res.json() as { installed?: boolean; install_warning?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInstallProgress(dd.id, 100);
      setTimeout(() => {
        markInstalled(dd.id);
        clearInstallProgress(dd.id);
        onInstalled?.();   // refresh Local tab tree
      }, 400);
      if (data.install_warning) setInstallError(data.install_warning);
    } catch (e: any) {
      setInstallError(e.message);
      clearInstallProgress(dd.id);
    }
  };

  const handleInstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInstalling || isInstalled) return;
    if (dd.trust === "untrusted") {
      setShowUntrustedDialog(true);
    } else {
      doInstall();
    }
  };

  return (
    <>
    {/* Untrusted install confirmation dialog */}
    {showUntrustedDialog && (
      <div
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
          zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onClick={e => { e.stopPropagation(); setShowUntrustedDialog(false); }}
      >
        <div
          style={{
            background: "#1a1a24", border: "1px solid #e0555544", borderRadius: 8,
            width: "min(400px, 90%)", padding: "18px 20px",
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 13, color: "#e05555", fontWeight: 700, marginBottom: 8 }}>
            ⚠ {lang === "zh" ? "未经审核的包" : "Unreviewed Package"}
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 6 }}>
            <b style={{ color: "#ccc" }}>{dd.name}</b>{" "}
            {lang === "zh"
              ? "未经任何审核人审核。仅在信任来源时安装。"
              : "has not been reviewed by a trusted reviewer. Only install from sources you trust."}
          </div>
          <div style={{ fontSize: 10, color: "#666", marginBottom: 14 }}>
            {lang === "zh"
              ? "安装后，该技能在执行时会受到限制（trust=untrusted）。"
              : "After install, this skill's execution will be restricted (trust=untrusted)."}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowUntrustedDialog(false)}
              style={ghostBtn}
            >
              {lang === "zh" ? "取消" : "Cancel"}
            </button>
            <button
              onClick={() => { setShowUntrustedDialog(false); doInstall(); }}
              style={{
                background: "#2a0808", border: "1px solid #e05555aa", borderRadius: 4,
                color: "#e05555", cursor: "pointer", fontSize: 11, padding: "5px 14px", fontWeight: 600,
              }}
            >
              {lang === "zh" ? "仍然安装" : "Install Anyway"}
            </button>
          </div>
        </div>
      </div>
    )}
    <div style={{
      padding: "8px 10px", background: "#111118",
      border: `1px solid ${isInstalled ? "#4ec9b044" : `${color}33`}`, borderRadius: 6,
      marginBottom: 6, cursor: "pointer",
    }}
      onClick={handleExpand}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13 }}>{typeIcon(dd.type)}</span>
        <span style={{ fontSize: 11, color: "#ccc", fontWeight: 600, flex: 1 }}>{dd.name}</span>
        <span style={{ fontSize: 9, color, border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 5px" }}>
          {dd.trust === "org-approved" ? "🟢" : dd.trust === "reviewed" ? "🔵" : "🟡"} {dd.trust}
        </span>
        {/* Install button / badge */}
        {isInstalled ? (
          <span style={{ fontSize: 9, color: "#4ec9b0", border: "1px solid #4ec9b044", borderRadius: 3, padding: "1px 6px" }}>
            ✓ {lang === "zh" ? "已安装" : "Installed"}
          </span>
        ) : (
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            style={{
              fontSize: 9, border: "1px solid #4ec9b044", borderRadius: 3, padding: "1px 6px",
              background: isInstalling ? "#0a1a14" : "none",
              color: isInstalling ? "#4ec9b088" : "#4ec9b0",
              cursor: isInstalling ? "default" : "pointer",
            }}
          >
            {isInstalling ? `${lang === "zh" ? "安装中" : "Installing"} ${progress}%` : (lang === "zh" ? "⬇ 安装" : "⬇ Install")}
          </button>
        )}
      </div>

      {/* Install progress bar */}
      {isInstalling && (
        <div style={{ marginTop: 4, height: 2, background: "#1a1a1a", borderRadius: 1 }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "#4ec9b0", borderRadius: 1, transition: "width 0.3s ease" }} />
        </div>
      )}

      {installError && (
        <div style={{ fontSize: 9, color: "#c8a45a", marginTop: 3 }}>⚠ {installError}</div>
      )}

      {dd.description && (
        <div style={{ fontSize: 10, color: "#888", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap" }}>
          {dd.description}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
        {maturityBar(dd.maturity, lang)}
        {dd.tags?.slice(0, 3).map((tag, i) => (
          <span key={i} style={{ fontSize: 8, background: "#2a2a2a", borderRadius: 3, padding: "1px 5px", color: "#666" }}>{tag}</span>
        ))}
        <span style={{ fontSize: 8, color: "#444", marginLeft: "auto" }}>v{dd.version}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #333" }}>
          {loadingContent ? (
            <div style={{ fontSize: 10, color: "#555" }}>Loading...</div>
          ) : content ? (
            <pre style={{ fontSize: 9, color: "#aaa", margin: 0, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>
              {content.slice(0, 1500)}{content.length > 1500 ? "\n…" : ""}
            </pre>
          ) : (
            <div style={{ fontSize: 10, color: "#555" }}>No content available</div>
          )}
        </div>
      )}
    </div>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSyncTime(date: Date, lang: string): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return lang === "zh" ? "刚刚同步" : "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return lang === "zh" ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return lang === "zh" ? `${diffHr} 小时前` : `${diffHr}h ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

type TabType = "local" | "registry";

export default function SkillsExplorer() {
  const { config, setConfig, uiLanguage, registryStatus, registryStats, lastRegistrySync, setRegistryStatus, initInstalledFromLocal } = useStore();
  const lang = uiLanguage;

  // Local tab state
  const [skillsTree, setSkillsTree] = useState<TreeNode[]>([]);
  const [loadedPath, setLoadedPath] = useState<string>(config?.skills_path ?? "");
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFileContent, setOpenFileContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Registry tab state
  const [activeTab, setActiveTab] = useState<TabType>("local");
  const [registryItems, setRegistryItems] = useState<DecisionDependency[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryQuery, setRegistryQuery] = useState("");
  const [showGitHubWizard, setShowGitHubWizard] = useState(false);
  const [installToast, setInstallToast] = useState<string | null>(null);

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

  const loadRegistry = useCallback((query = "") => {
    setRegistryLoading(true);
    const params = query ? `?query=${encodeURIComponent(query)}` : "";
    fetch(`/api/registry/list${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.items) {
          setRegistryItems(data.items);
          // Seed installed state from items that are already on local disk
          const localIds = (data.items as Array<{ id: string; source?: { type: string } }>)
            .filter(i => i.source?.type === "local")
            .map(i => i.id);
          if (localIds.length > 0) initInstalledFromLocal(localIds);
        }
      })
      .finally(() => setRegistryLoading(false));
  }, [initInstalledFromLocal]);

  const handleBrowse = useCallback(async () => {
    const picked = await pickDir();
    if (!picked) return;
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

  useEffect(() => {
    if (config?.skills_path) loadSkills(config.skills_path);
  }, [config?.skills_path, loadSkills]);

  // Auto-load registry on mount (not gated on tab switch)
  useEffect(() => {
    loadRegistry();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload registry list when switching to registry tab after initial load
  useEffect(() => {
    if (activeTab === "registry" && registryItems.length === 0) loadRegistry();
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll registry health status + refresh list every 5 minutes so admin edits propagate
  useEffect(() => {
    let lastUpdated: string | null = null;
    const pollStatus = () => {
      fetch("/api/registry/status")
        .then(r => r.json())
        .then((data: { status: string; stats?: { total_packages: number; total_installs: number; last_updated: string | null }; registry_url?: string }) => {
          const s = data.status === "connected" ? "connected"
            : data.status === "degraded" ? "degraded"
            : "unreachable";
          setRegistryStatus(s as any, data.stats ?? null, data.registry_url);
          // Refresh package list if cloud has new content (last_updated changed)
          const newTs = data.stats?.last_updated ?? null;
          if (newTs && newTs !== lastUpdated) {
            lastUpdated = newTs;
            loadRegistry();
          }
        })
        .catch(() => setRegistryStatus("unreachable", null));
    };
    pollStatus();
    const timer = setInterval(pollStatus, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRegistry = registryQuery
    ? (() => {
        // Tokenize query, normalize hyphens/underscores → spaces so that
        // "vertex api" matches "vertex-ai-api-dev" and similar slug-style names.
        const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, " ");
        const tokens = normalize(registryQuery).split(/\s+/).filter(Boolean);
        return registryItems.filter(i => {
          const haystack = [
            normalize(i.name),
            normalize(i.description),
            ...i.tags.map(normalize),
          ].join(" ");
          return tokens.every(tok => haystack.includes(tok));
        });
      })()
    : registryItems;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #333", flexShrink: 0 }}>
        {(["local", "registry"] as TabType[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: 1, padding: "8px 0", background: "none",
            border: "none", borderBottom: activeTab === tab ? "2px solid #4ec9b0" : "2px solid transparent",
            color: activeTab === tab ? "#4ec9b0" : "#666",
            cursor: "pointer", fontSize: 11, fontWeight: activeTab === tab ? 700 : 400,
            textTransform: "uppercase", letterSpacing: 0.6,
          }}>
            {tab === "local" ? (lang === "zh" ? "本地" : "Local") : (lang === "zh" ? "注册表" : "Registry")}
          </button>
        ))}
      </div>

      {/* ── Local Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "local" && (
        <>
          <div style={{ padding: "10px 10px 8px", flexShrink: 0, borderBottom: "1px solid #333" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 }}>
                {lang === "zh" ? "专家能力文件夹" : "Skills Folder"}
              </span>
              <button onClick={handleBrowse} title={lang === "zh" ? "选择文件夹" : "Choose folder"} style={browseBtnStyle}>
                📁
              </button>
            </div>
            {loadedPath && (
              <div style={{ fontSize: 10, color: "#555", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {loadedPath}
              </div>
            )}
          </div>

          <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333" }}>
            <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t(uiLanguage, "search_skills_files")}
              style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#d4d4d4", padding: "5px 8px", fontSize: 12, outline: "none", flex: 1 }}
            />
          </div>

          <div style={{ flex: openFilePath ? "0 0 40%" : "1", overflow: "auto" }}>
            {!loadedPath ? (
              <div style={{ color: "#555", padding: "20px 16px", fontSize: 12 }}>
                {lang === "zh" ? "点击 📁 选择技能文件夹。" : "Click 📁 to choose a skills folder."}
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
        </>
      )}

      {/* Install toast */}
      {installToast && (
        <div style={{
          position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
          background: "#1a3a2a", border: "1px solid #4ec9b0", borderRadius: 6,
          color: "#4ec9b0", fontSize: 12, padding: "8px 14px", zIndex: 100,
          pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          ✅ {installToast} {lang === "zh" ? "已安装" : "installed"}
        </div>
      )}

      {/* ── Registry Tab ──────────────────────────────────────────────────── */}
      {activeTab === "registry" && (
        <>
          {/* Connection status bar */}
          <div style={{
            padding: "6px 10px", flexShrink: 0,
            borderBottom: "1px solid #2a2a2a",
            background: "#0d0d14",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 8 }}>
              {registryStatus === "connected" ? "🟢" : registryStatus === "degraded" ? "🟡" : registryStatus === "connecting" ? "⬜" : "🔴"}
            </span>
            <span style={{ fontSize: 10, color: registryStatus === "connected" ? "#4ec9b0" : registryStatus === "degraded" ? "#c8a45a" : "#888", flex: 1 }}>
              {registryStatus === "connecting"
                ? (lang === "zh" ? "连接中…" : "Connecting…")
                : registryStatus === "connected"
                  ? (lang === "zh" ? "已连接云端注册表" : "Connected")
                  : registryStatus === "degraded"
                    ? (lang === "zh" ? "部分可用" : "Degraded")
                    : (lang === "zh" ? "无法连接注册表" : "Unreachable")}
            </span>
            {registryStats && (
              <span style={{ fontSize: 9, color: "#555" }}>
                {registryStats.total_packages} {lang === "zh" ? "个包" : "pkgs"}
              </span>
            )}
            {lastRegistrySync && (
              <span style={{ fontSize: 9, color: "#444" }}>
                · {formatSyncTime(lastRegistrySync, lang)}
              </span>
            )}
          </div>

          <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexShrink: 0, borderBottom: "1px solid #333" }}>
            <span style={{ color: "#555", fontSize: 14, lineHeight: "28px" }}>🔍</span>
            <input
              value={registryQuery}
              onChange={e => setRegistryQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && loadRegistry(registryQuery)}
              placeholder={lang === "zh" ? "搜索注册表…" : "Search registry…"}
              style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#d4d4d4", padding: "5px 8px", fontSize: 12, outline: "none", flex: 1 }}
            />
            <button onClick={() => setShowGitHubWizard(true)} title={lang === "zh" ? "从 GitHub 导入" : "Import from GitHub"} style={{ ...browseBtnStyle, fontSize: 13 }}>
              ⬇ GitHub
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
            {registryLoading ? (
              <div style={{ color: "#555", padding: 16, fontSize: 12 }}>Loading registry…</div>
            ) : filteredRegistry.length === 0 ? (
              <div style={{ color: "#555", padding: 16, fontSize: 12 }}>
                {lang === "zh" ? "注册表为空。点击 ⬇ GitHub 导入技能。" : "Registry is empty. Click ⬇ GitHub to import skills."}
              </div>
            ) : (
              filteredRegistry.map((dd, i) => (
                <RegistryCard key={`${dd.id}-${i}`} dd={dd} lang={lang}
                  onInstalled={() => {
                    if (config?.skills_path) loadSkills(config.skills_path);
                    setInstallToast(dd.name ?? dd.id);
                    setTimeout(() => setInstallToast(null), 3000);
                  }}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* GitHub Import Wizard overlay */}
      {showGitHubWizard && (
        <GitHubImportWizard
          lang={lang}
          onClose={() => setShowGitHubWizard(false)}
          onImported={() => {
            loadRegistry();
            if (config?.skills_path) loadSkills(config.skills_path);
          }}
        />
      )}
    </div>
  );
}

const browseBtnStyle: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  fontSize: 16, padding: "2px 4px", lineHeight: 1, color: "#888",
};
const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid #333", borderRadius: 4,
  color: "#666", cursor: "pointer", fontSize: 11, padding: "5px 12px",
};
const primaryBtnStyle: React.CSSProperties = {
  background: "#0a2a20", border: "1px solid #4ec9b088", borderRadius: 4,
  color: "#4ec9b0", cursor: "pointer", fontSize: 11, padding: "5px 14px", fontWeight: 600,
};
