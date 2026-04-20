import React, { useEffect, useRef, useState } from "react";
import {
  listReleases, uploadReleaseWithProgress, promoteRelease,
  revokeRelease, restoreRelease, deleteRelease, deleteReleaseAsset,
  Release, UploadProgress,
} from "../api";
import { Card, SectionTitle, Btn } from "../ui";

const PLATFORMS = [
  { value: "macos-arm64",   label: "macOS — Apple Silicon",  ext: ".dmg" },
  { value: "macos-x64",     label: "macOS — Intel x64",      ext: ".dmg" },
  { value: "windows-x64",   label: "Windows — x64",          ext: ".exe" },
  { value: "linux-x64",     label: "Linux — x64",            ext: ".AppImage" },
  { value: "linux-arm64",   label: "Linux — ARM64",          ext: ".AppImage" },
  { value: "linux-tarball", label: "Linux — tarball",        ext: ".tar.gz" },
];

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(s: string): string {
  try { return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return s; }
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel = "Confirm", danger = false,
  onConfirm, onCancel,
  extraOption,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (extra?: boolean) => void;
  onCancel: () => void;
  extraOption?: { label: string; checked: boolean; onChange: (v: boolean) => void };
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#111118", border: "1px solid #2a2a3a", borderRadius: 8,
        padding: 24, maxWidth: 400, width: "90%",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: danger ? "#e05555" : "#ccc", marginBottom: 10 }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 16, lineHeight: 1.6 }}>
          {message}
        </div>
        {extraOption && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={extraOption.checked}
              onChange={e => extraOption.onChange(e.target.checked)}
              style={{ accentColor: "#e05555" }}
            />
            <span style={{ fontSize: 11, color: "#888" }}>{extraOption.label}</span>
          </label>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
          <button
            onClick={() => onConfirm()}
            style={{
              fontSize: 11, padding: "5px 14px", borderRadius: 4,
              background: danger ? "#3a0808" : "#0a1a10",
              border: `1px solid ${danger ? "#e05555aa" : "#4ec9b088"}`,
              color: danger ? "#e05555" : "#4ec9b0",
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Platform coverage indicator ─────────────────────────────────────────────

function PlatformCoverage({ assets }: { assets: Release["assets"] }) {
  const covered = new Set(assets.map(a => a.platform));
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {PLATFORMS.map(p => {
        const has = covered.has(p.value);
        return (
          <span
            key={p.value}
            title={p.label}
            style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 3,
              background: has ? "#0a2a20" : "#111118",
              border: `1px solid ${has ? "#4ec9b044" : "#1a1a2a"}`,
              color: has ? "#4ec9b0" : "#333",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {p.value.split("-")[0]}
            {p.value.includes("arm") ? "-arm" : p.value.includes("x64") ? "-x64" : ""}
          </span>
        );
      })}
    </div>
  );
}

// ─── Upload form ──────────────────────────────────────────────────────────────

function fmtSpeed(bps: number): string {
  if (bps <= 0) return "";
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0].value);
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const inp: React.CSSProperties = {
    background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 4,
    color: "#d4d4d4", padding: "6px 8px", fontSize: 11, outline: "none", width: "100%",
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: "#555", display: "block", marginBottom: 3 };

  const handleUpload = async () => {
    setErr(""); setSuccess(""); setProgress(null);
    if (!version.trim()) { setErr("Version is required (e.g. 1.2.0)"); return; }
    if (!file && !downloadUrl.trim()) { setErr("Select a binary file or provide a download URL"); return; }
    setLoading(true);
    try {
      const res = await uploadReleaseWithProgress(
        file,
        {
          version: version.trim(),
          platform,
          channel,
          release_notes: notes.trim(),
          download_url: downloadUrl.trim() || undefined,
        },
        (p) => setProgress(p),
      );
      if (res.download_url) {
        setSuccess(`✓ Registered ${platform} with external URL`);
      } else {
        setSuccess(`✓ Uploaded ${file!.name} — ${fmtBytes(res.size_bytes)} — sha256: ${res.sha256?.slice(0, 12)}…`);
      }
      setFile(null);
      setDownloadUrl("");
      setProgress(null);
      onDone();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : null;

  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#ccc", marginBottom: 14 }}>
        Upload Binary Asset
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={lbl}>Version (semver)</label>
          <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.2.0" style={inp} />
        </div>
        <div>
          <label style={lbl}>Channel</label>
          <select value={channel} onChange={e => setChannel(e.target.value)} style={inp}>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
            <option value="nightly">nightly</option>
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Platform</label>
          <select value={platform} onChange={e => setPlatform(e.target.value)} style={inp}>
            {PLATFORMS.map(p => (
              <option key={p.value} value={p.value}>{p.label} ({p.ext})</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Release Notes (optional, markdown)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="## What's new&#10;- Bug fixes&#10;- Performance improvements"
            style={{ ...inp, resize: "vertical", fontFamily: "ui-monospace, monospace", lineHeight: 1.5 }}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Download URL (optional — use instead of uploading a file)</label>
          <input
            value={downloadUrl}
            onChange={e => setDownloadUrl(e.target.value)}
            placeholder="https://github.com/org/repo/releases/download/v1.0/physmind.dmg"
            style={inp}
          />
        </div>
      </div>

      {/* File drop zone — optional when download URL is provided */}
      <div
        onClick={() => !loading && fileRef.current?.click()}
        style={{
          border: `2px dashed ${file ? "#2a3a2a" : "#2a2a3a"}`,
          borderRadius: 6, padding: "14px 12px", textAlign: "center",
          cursor: loading ? "default" : "pointer", marginBottom: 10, transition: "all 0.15s",
          background: file ? "#0a1a0a" : "transparent",
          opacity: (downloadUrl.trim() && !file) || loading ? 0.5 : 1,
        }}
      >
        {file ? (
          <div style={{ color: "#4ec9b0", fontSize: 11 }}>
            {file.name} <span style={{ color: "#444", fontSize: 10 }}>({fmtBytes(file.size)})</span>
            {!loading && <span style={{ color: "#3a3a5a", marginLeft: 8, fontSize: 10 }}>click to replace</span>}
          </div>
        ) : downloadUrl.trim() ? (
          <div style={{ color: "#555", fontSize: 11 }}>
            Using download URL above — file upload not required
            <span style={{ color: "#3a3a5a", marginLeft: 8, fontSize: 10 }}>(click to attach file instead)</span>
          </div>
        ) : (
          <div style={{ color: "#444", fontSize: 11 }}>
            Click to select binary (.dmg, .exe, .AppImage, .tar.gz)
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".dmg,.exe,.AppImage,.tar.gz,.gz,.zip"
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}
      />

      {/* Progress bar */}
      {loading && file && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            height: 4, background: "#1a1a2a", borderRadius: 2, overflow: "hidden", marginBottom: 5,
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              background: pct != null ? "#4ec9b0" : "#4ec9b044",
              width: pct != null ? `${pct}%` : "100%",
              transition: pct != null ? "width 0.2s ease" : "none",
              animation: pct == null ? "pulse 1.2s ease-in-out infinite" : "none",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555" }}>
            <span>
              {pct != null
                ? `${pct}%  ·  ${fmtBytes(progress!.loaded)} / ${fmtBytes(progress!.total)}`
                : "Uploading…"}
            </span>
            {progress && progress.speedBps > 0 && (
              <span style={{ color: "#4ec9b077" }}>{fmtSpeed(progress.speedBps)}</span>
            )}
          </div>
        </div>
      )}
      {loading && !file && (
        <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>Registering URL…</div>
      )}

      {err && (
        <div style={{ padding: "6px 10px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555", marginBottom: 10 }}>
          {err}
        </div>
      )}
      {success && (
        <div style={{ padding: "6px 10px", background: "#0a2a20", border: "1px solid #4ec9b044", borderRadius: 4, fontSize: 11, color: "#4ec9b0", marginBottom: 10 }}>
          {success}
        </div>
      )}

      <Btn onClick={handleUpload} disabled={loading || (!file && !downloadUrl.trim())}>
        {loading ? (pct != null ? `Uploading… ${pct}%` : "Uploading…") : "Upload Asset"}
      </Btn>
    </Card>
  );
}

// ─── Release row ──────────────────────────────────────────────────────────────

type DialogState =
  | { type: "delete-release"; version: string }
  | { type: "delete-asset"; version: string; platform: string }
  | { type: "revoke"; version: string }
  | null;

function ReleaseRow({
  release,
  onPromote,
  onRevoke,
  onRestore,
  onDeleteRelease,
  onDeleteAsset,
  promoting,
  actioning,
}: {
  release: Release;
  onPromote: (version: string) => void;
  onRevoke: (version: string) => void;
  onRestore: (version: string) => void;
  onDeleteRelease: (version: string, deleteFiles: boolean) => void;
  onDeleteAsset: (version: string, platform: string, deleteFile: boolean) => void;
  promoting: boolean;
  actioning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleteFile, setDeleteFile] = useState(false);

  const isRevoked = release.status === "revoked";
  const channelColor = release.channel === "stable" ? "#4ec9b0" : release.channel === "beta" ? "#c8a45a" : "#888";
  const missingPlatforms = PLATFORMS.filter(p => !release.assets.some(a => a.platform === p.value));

  const rowStyle: React.CSSProperties = {
    borderBottom: "1px solid #1a1a2a",
    opacity: isRevoked ? 0.55 : 1,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
    cursor: "pointer",
    background: isRevoked ? "#140a0a" : expanded ? "#111120" : "transparent",
  };

  return (
    <div style={rowStyle}>
      {/* Confirm dialogs */}
      {dialog?.type === "delete-release" && (
        <ConfirmDialog
          title="Delete Release"
          message={`Permanently delete v${dialog.version} and all ${release.assets.length} asset records? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          extraOption={{ label: "Also delete binary files from R2 storage", checked: deleteFiles, onChange: setDeleteFiles }}
          onConfirm={() => { onDeleteRelease(dialog.version, deleteFiles); setDialog(null); }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "delete-asset" && (
        <ConfirmDialog
          title="Delete Asset"
          message={`Remove the ${dialog.platform} asset from v${dialog.version}?`}
          confirmLabel="Delete Asset"
          danger
          extraOption={{ label: "Also delete binary file from R2 storage", checked: deleteFile, onChange: setDeleteFile }}
          onConfirm={() => { onDeleteAsset(dialog.version, dialog.platform, deleteFile); setDialog(null); }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === "revoke" && (
        <ConfirmDialog
          title="Revoke Release"
          message={`Revoke v${dialog.version}? It will be hidden from public download endpoints and cleared as latest. You can restore it later.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => { onRevoke(dialog.version); setDialog(null); }}
          onCancel={() => setDialog(null)}
        />
      )}

      <div style={headerStyle} onClick={() => setExpanded(v => !v)}>
        {/* Version + badges */}
        <div style={{ flex: "0 0 100px" }}>
          <span style={{
            fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 700,
            color: isRevoked ? "#666" : "#fff",
            textDecoration: isRevoked ? "line-through" : "none",
          }}>
            v{release.version}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          {release.is_latest && !isRevoked && (
            <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "#0a2a20", border: "1px solid #4ec9b044", color: "#4ec9b0", fontWeight: 700 }}>
              LATEST
            </span>
          )}
          {isRevoked && (
            <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: "#2a0808", border: "1px solid #e0555544", color: "#e05555", fontWeight: 700 }}>
              REVOKED
            </span>
          )}
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, border: `1px solid ${channelColor}44`, color: channelColor }}>
            {release.channel}
          </span>
        </div>

        {!isRevoked && <PlatformCoverage assets={release.assets} />}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#444" }}>{fmtDate(release.published_at)}</span>
          <span style={{ fontSize: 9, color: "#333" }}>{release.assets.length} asset{release.assets.length !== 1 ? "s" : ""}</span>

          {/* Action buttons — stop propagation so they don't toggle expand */}
          {!isRevoked && !release.is_latest && (
            <button
              onClick={e => { e.stopPropagation(); onPromote(release.version); }}
              disabled={promoting || actioning}
              style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 4,
                background: "#0a1a10", border: "1px solid #4ec9b033",
                color: "#4ec9b088", cursor: (promoting || actioning) ? "default" : "pointer",
                opacity: (promoting || actioning) ? 0.5 : 1,
              }}
            >
              {promoting ? "…" : "Set Latest"}
            </button>
          )}

          {isRevoked ? (
            <button
              onClick={e => { e.stopPropagation(); onRestore(release.version); }}
              disabled={actioning}
              style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 4,
                background: "#0a1a10", border: "1px solid #4ec9b033",
                color: "#4ec9b077", cursor: actioning ? "default" : "pointer",
                opacity: actioning ? 0.5 : 1,
              }}
            >
              {actioning ? "…" : "Restore"}
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setDialog({ type: "revoke", version: release.version }); }}
              disabled={actioning}
              style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 4,
                background: "#1a0a0a", border: "1px solid #e0555522",
                color: "#e0555566", cursor: actioning ? "default" : "pointer",
                opacity: actioning ? 0.5 : 1,
              }}
            >
              Revoke
            </button>
          )}

          <button
            onClick={e => { e.stopPropagation(); setDeleteFiles(false); setDialog({ type: "delete-release", version: release.version }); }}
            disabled={actioning}
            style={{
              fontSize: 10, padding: "3px 8px", borderRadius: 4,
              background: "#1a0808", border: "1px solid #e0555533",
              color: "#e05555", cursor: actioning ? "default" : "pointer",
              opacity: actioning ? 0.5 : 1,
            }}
            title="Permanently delete this release"
          >
            ✕ Delete
          </button>

          <span style={{ fontSize: 10, color: "#333" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "8px 16px 16px", background: "#0d0d18" }}>
          {/* Release notes */}
          {release.release_notes && (
            <div style={{ marginBottom: 12, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#888", background: "#111118", border: "1px solid #1a1a2a", borderRadius: 4, padding: "8px 10px", whiteSpace: "pre-wrap" }}>
              {release.release_notes}
            </div>
          )}

          {/* Asset table */}
          {release.assets.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ color: "#444" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400, textTransform: "uppercase", letterSpacing: 0.5 }}>Platform</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400 }}>Filename</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 400 }}>Size</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400 }}>SHA-256</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 400 }}>Source</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 400 }}></th>
                </tr>
              </thead>
              <tbody>
                {release.assets.map(a => (
                  <tr key={a.platform} style={{ borderTop: "1px solid #1a1a2a" }}>
                    <td style={{ padding: "5px 8px", color: "#4ec9b0", fontFamily: "ui-monospace, monospace" }}>{a.platform}</td>
                    <td style={{ padding: "5px 8px", color: "#888" }}>{a.filename}</td>
                    <td style={{ padding: "5px 8px", color: "#555", textAlign: "right" }}>{fmtBytes(a.size_bytes)}</td>
                    <td style={{ padding: "5px 8px", color: "#333", fontFamily: "ui-monospace, monospace" }}>
                      {a.sha256 ? a.sha256.slice(0, 16) + "…" : "—"}
                    </td>
                    <td style={{ padding: "5px 8px", fontSize: 9 }}>
                      {a.download_url
                        ? <a href={a.download_url} target="_blank" rel="noreferrer" style={{ color: "#4ec9b088", fontFamily: "ui-monospace, monospace" }}>external ↗</a>
                        : <span style={{ color: "#333" }}>R2</span>}
                    </td>
                    <td style={{ padding: "5px 8px", textAlign: "right" }}>
                      <button
                        onClick={() => { setDeleteFile(false); setDialog({ type: "delete-asset", version: release.version, platform: a.platform }); }}
                        style={{
                          fontSize: 9, padding: "2px 7px", borderRadius: 3,
                          background: "#1a0808", border: "1px solid #e0555533",
                          color: "#e05555aa", cursor: "pointer",
                        }}
                        title={`Delete ${a.platform} asset`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Missing platforms warning */}
          {missingPlatforms.length > 0 && !isRevoked && (
            <div style={{ marginTop: 10, fontSize: 10, color: "#555" }}>
              Missing: {missingPlatforms.map(p => p.label).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Channel tab bar ──────────────────────────────────────────────────────────

function ChannelTabs({
  active, onChange, counts,
}: {
  active: string;
  onChange: (ch: string) => void;
  counts: Record<string, number>;
}) {
  const tabs = ["all", "stable", "beta", "nightly", "revoked"];
  const colors: Record<string, string> = {
    stable: "#4ec9b0", beta: "#c8a45a", nightly: "#888", revoked: "#e05555", all: "#666",
  };
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #1a1a2a", marginBottom: 20 }}>
      {tabs.map(t => {
        const isActive = active === t;
        const color = isActive ? (colors[t] ?? "#aaa") : "#444";
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            style={{
              fontSize: 11, padding: "6px 14px", borderRadius: "4px 4px 0 0",
              background: isActive ? "#111120" : "transparent",
              border: "1px solid " + (isActive ? "#2a2a3a" : "transparent"),
              borderBottom: isActive ? "1px solid #111120" : "1px solid transparent",
              color, cursor: "pointer", marginBottom: -1,
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {counts[t] != null && (
              <span style={{ marginLeft: 6, fontSize: 9, color: isActive ? color : "#333" }}>
                {counts[t]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [promoting, setPromoting] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [channelFilter, setChannelFilter] = useState("all");

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const data = await listReleases();
      setReleases(data.releases);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handlePromote = async (version: string) => {
    setPromoting(version);
    try {
      await promoteRelease(version);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPromoting(null);
    }
  };

  const handleRevoke = async (version: string) => {
    setActioning(version);
    try {
      await revokeRelease(version);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActioning(null);
    }
  };

  const handleRestore = async (version: string) => {
    setActioning(version);
    try {
      await restoreRelease(version);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActioning(null);
    }
  };

  const handleDeleteRelease = async (version: string, deleteFiles: boolean) => {
    setActioning(version);
    try {
      await deleteRelease(version, deleteFiles);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActioning(null);
    }
  };

  const handleDeleteAsset = async (version: string, platform: string, deleteFile: boolean) => {
    setActioning(`${version}:${platform}`);
    try {
      await deleteReleaseAsset(version, platform, deleteFile);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setActioning(null);
    }
  };

  // Compute channel counts
  const counts: Record<string, number> = { all: releases.length, revoked: 0 };
  for (const r of releases) {
    if (r.status === "revoked") {
      counts.revoked = (counts.revoked ?? 0) + 1;
    } else {
      counts[r.channel] = (counts[r.channel] ?? 0) + 1;
    }
  }

  // Filter releases for display
  const filtered = releases.filter(r => {
    if (channelFilter === "all") return true;
    if (channelFilter === "revoked") return r.status === "revoked";
    return r.channel === channelFilter && r.status !== "revoked";
  });

  // Latest per channel (active only)
  const latestByChannel = releases
    .filter(r => r.is_latest && r.status !== "revoked")
    .reduce<Record<string, Release>>((acc, r) => { acc[r.channel] = r; return acc; }, {});

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <SectionTitle>Release Management</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Btn>
          <Btn size="sm" onClick={() => setShowUpload(v => !v)}>
            {showUpload ? "Hide Upload" : "⬆ Upload Asset"}
          </Btn>
        </div>
      </div>

      {err && (
        <div style={{ padding: "7px 12px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555", marginBottom: 16 }}>
          {err}
        </div>
      )}

      {showUpload && (
        <div style={{ marginBottom: 24 }}>
          <UploadForm onDone={load} />
          <div style={{ fontSize: 10, color: "#444", marginTop: 8 }}>
            After uploading all platform assets for a version, click <strong style={{ color: "#555" }}>Set Latest</strong> on that version to make it the default download.
          </div>
        </div>
      )}

      {/* Current latest banners — per channel */}
      {Object.keys(latestByChannel).length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          {["stable", "beta", "nightly"].map(ch => {
            const r = latestByChannel[ch];
            if (!r) return null;
            const color = ch === "stable" ? "#4ec9b0" : ch === "beta" ? "#c8a45a" : "#888";
            return (
              <div key={ch} style={{ background: "#0a1a0a", border: `1px solid ${color}22`, borderRadius: 6, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flex: "1 1 200px" }}>
                <span style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{ch}</span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "#fff" }}>v{r.version}</span>
                <span style={{ fontSize: 10, color: "#444" }}>{r.assets.length} platforms</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Channel tabs */}
      <ChannelTabs active={channelFilter} onChange={setChannelFilter} counts={counts} />

      {/* Release list */}
      {loading ? (
        <div style={{ color: "#444", fontSize: 12 }}>Loading releases…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#444", fontSize: 12 }}>
          {releases.length === 0
            ? "No releases yet. Upload binary assets above to create the first release."
            : `No ${channelFilter === "all" ? "" : channelFilter + " "}releases.`}
        </div>
      ) : (
        <div style={{ background: "#111118", border: "1px solid #1a1a2a", borderRadius: 6, overflow: "hidden" }}>
          {filtered.map(r => (
            <ReleaseRow
              key={r.version}
              release={r}
              onPromote={handlePromote}
              onRevoke={handleRevoke}
              onRestore={handleRestore}
              onDeleteRelease={handleDeleteRelease}
              onDeleteAsset={handleDeleteAsset}
              promoting={promoting === r.version}
              actioning={actioning === r.version || (actioning?.startsWith(r.version + ":") ?? false)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 10, color: "#333" }}>
        Download URLs: <code style={{ color: "#444" }}>https://registry.physical-mind.ai/releases/download/{"<version>/<platform>"}</code>
      </div>
    </div>
  );
}
