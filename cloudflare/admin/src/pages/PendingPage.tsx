import React, { useEffect, useState, useCallback, useMemo } from "react";
import { unzipSync, zipSync } from "fflate";
import { listPending, approvePackage, batchApprove, publishMetadata, uploadPackage, downloadPackageZip } from "../api";
import { Card, SectionTitle, Spinner, TrustBadge, Btn } from "../ui";

type PendingItem = Awaited<ReturnType<typeof listPending>>["items"][number];

// ─── File preview helpers ──────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
  "md", "txt", "rst", "py", "ts", "tsx", "js", "jsx",
  "sh", "bash", "rb", "go", "rs", "yaml", "yml", "json", "toml",
  "css", "html", "xml", "ini", "cfg",
]);

const LANG_COLOR: Record<string, string> = {
  py: "#4ec9b0", ts: "#9cdcfe", tsx: "#9cdcfe", js: "#dcdcaa", jsx: "#dcdcaa",
  sh: "#89e051", bash: "#89e051", rb: "#e06c75", go: "#4fc1ff", rs: "#ce9178",
  yaml: "#d7ba7d", yml: "#d7ba7d", json: "#9cdcfe", toml: "#d7ba7d",
  md: "#d4d4d4", txt: "#d4d4d4",
};

interface FileEntry {
  path: string;
  displayPath: string; // normalized (common prefix stripped)
  data: Uint8Array;
  isText: boolean;
  content?: string;    // original decoded content
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
  catch { return raw.split(",").map(t => t.trim()).filter(Boolean); }
}

function normalizeEntries(entries: FileEntry[]): FileEntry[] {
  if (entries.length <= 1) return entries;
  const paths = entries.map(e => e.path);
  const parts0 = paths[0].split("/").slice(0, -1);
  let common = "";
  for (let i = parts0.length; i >= 1; i--) {
    const cand = parts0.slice(0, i).join("/") + "/";
    if (paths.every(p => p.startsWith(cand))) { common = cand; break; }
  }
  return entries.map(e => ({
    ...e,
    displayPath: common && e.path.startsWith(common) ? e.path.slice(common.length) : e.path,
  }));
}

// ─── File Panel (preview + inline editing) ────────────────────────────────────

function FilePanel({
  entries,
  editedFiles,
  onEdit,
}: {
  entries: FileEntry[];
  editedFiles: Record<string, string>;
  onEdit: (path: string, content: string) => void;
}) {
  const normalized = useMemo(() => normalizeEntries(entries), [entries]);

  const sorted = useMemo(() => [...normalized].sort((a, b) => {
    if (a.displayPath.toLowerCase().endsWith("skill.md")) return -1;
    if (b.displayPath.toLowerCase().endsWith("skill.md")) return 1;
    return a.displayPath.localeCompare(b.displayPath);
  }), [normalized]);

  const [selected, setSelected] = useState(sorted[0]?.path ?? "");
  const [editing, setEditing] = useState(false);

  const entriesKey = sorted.map(e => e.path).join("|");
  useEffect(() => {
    const skill = sorted.find(e => e.displayPath.toLowerCase().endsWith("skill.md"));
    setSelected(skill?.path ?? sorted[0]?.path ?? "");
    setEditing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey]);

  const entry = sorted.find(e => e.path === selected);
  const isModified = selected in editedFiles;
  const currentContent = editedFiles[selected] ?? entry?.content ?? "";
  const ext = selected.split(".").pop()?.toLowerCase() ?? "";
  const contentColor = LANG_COLOR[ext] ?? "#d4d4d4";

  // Group by top-level dir
  const groups = useMemo(() => {
    const g = new Map<string, FileEntry[]>();
    for (const e of sorted) {
      const key = e.displayPath.includes("/") ? e.displayPath.split("/")[0] : "";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    }
    return [...g.entries()].sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : a.localeCompare(b));
  }, [sorted]);

  const lbl: React.CSSProperties = {
    fontSize: 9, color: "#2a3a4a", letterSpacing: 0.5,
    textTransform: "uppercase" as const, userSelect: "none" as const,
  };

  const totalModified = Object.keys(editedFiles).length;

  return (
    <div style={{ border: "1px solid #1a1a2a", borderRadius: 6, overflow: "hidden", background: "#0d0d18", marginTop: 12 }}>
      {/* Header */}
      <div style={{ padding: "5px 12px", borderBottom: "1px solid #1a1a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ ...lbl, color: "#3a3a5a" }}>Package Files</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {totalModified > 0 && (
            <span style={{ fontSize: 9, color: "#c8a45a" }}>
              {totalModified} file{totalModified !== 1 ? "s" : ""} modified
            </span>
          )}
          {entry?.isText && (
            <button
              onClick={() => setEditing(e => !e)}
              style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
                border: `1px solid ${editing ? "#4ec9b0" : "#2a2a3a"}`,
                background: editing ? "#0a2a2a" : "#111118",
                color: editing ? "#4ec9b0" : "#666",
              }}
            >
              {editing ? "Preview" : "Edit file"}
            </button>
          )}
          {isModified && !editing && (
            <span style={{ fontSize: 9, color: "#c8a45a" }}>● modified</span>
          )}
          <span style={{ fontSize: 9, color: "#2a2a4a" }}>{sorted.length} file{sorted.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div style={{ display: "flex", overflow: "hidden" }}>
        {/* File tree */}
        <div style={{ width: 170, flexShrink: 0, borderRight: "1px solid #1a1a2a", overflowY: "auto", maxHeight: 460, fontSize: 10 }}>
          {groups.map(([group, files]) => (
            <div key={group || "__root"}>
              {group && (
                <div style={{ ...lbl, padding: "5px 8px 2px" }}>{group}/</div>
              )}
              {files.map(e => {
                const name = e.displayPath.split("/").pop() ?? e.displayPath;
                const active = e.path === selected;
                const modified = e.path in editedFiles;
                return (
                  <div
                    key={e.path}
                    onClick={() => { setSelected(e.path); setEditing(false); }}
                    title={e.displayPath}
                    style={{
                      padding: `3px 8px 3px ${group ? 18 : 8}px`,
                      cursor: "pointer",
                      background: active ? "#141428" : "transparent",
                      color: modified ? "#c8a45a" : active ? "#4ec9b0" : e.content != null ? "#888" : "#333",
                      borderLeft: `2px solid ${active ? "#4ec9b0" : "transparent"}`,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {name}{modified ? " ●" : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Content / editor area */}
        <div style={{ flex: 1, overflowY: "auto", maxHeight: 460, padding: "8px 12px", minWidth: 0 }}>
          <div style={{ fontSize: 9, color: "#2a2a4a", marginBottom: 6 }}>{entry?.displayPath ?? selected}</div>
          {entry ? (
            editing && entry.isText ? (
              <textarea
                value={currentContent}
                onChange={e => onEdit(selected, e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%", height: 380,
                  background: "#0a0a14", border: "1px solid #2a2a3a", borderRadius: 4,
                  color: contentColor, padding: "8px",
                  fontSize: 11, lineHeight: 1.65,
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  resize: "vertical", outline: "none", boxSizing: "border-box",
                }}
              />
            ) : entry.content != null ? (
              <pre style={{
                margin: 0, fontSize: 11, lineHeight: 1.65, color: contentColor,
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              }}>
                {currentContent}
              </pre>
            ) : (
              <div style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>Binary file — not previewable</div>
            )
          ) : (
            <div style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>Select a file to preview</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pending Item Card ─────────────────────────────────────────────────────────

function PendingCard({
  item,
  onAction,
  onError,
}: {
  item: PendingItem;
  onAction: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");

  // File state
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesErr, setFilesErr] = useState("");

  // Metadata edit state
  const [editTrust, setEditTrust] = useState(item.trust);
  const [editDomain, setEditDomain] = useState(item.domain ?? "");
  const [editDescription, setEditDescription] = useState(item.description ?? "");
  const [editMaturity, setEditMaturity] = useState(item.maturity ?? "L2");
  const [editTagsRaw, setEditTagsRaw] = useState(() => parseTags(item.tags).join(", "));
  const [editTags, setEditTags] = useState(() => parseTags(item.tags));

  const [savingFiles, setSavingFiles] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [acting, setActing] = useState(false);

  const inp: React.CSSProperties = {
    width: "100%", background: "#1a1a24", border: "1px solid #2a2a3a",
    borderRadius: 4, color: "#d4d4d4", padding: "5px 8px", fontSize: 11, outline: "none",
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: "#555", display: "block", marginBottom: 3 };

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true); setFilesErr("");
    try {
      const buf = await downloadPackageZip(item.id, item.version);
      const zipFiles = unzipSync(new Uint8Array(buf));
      const entries: FileEntry[] = [];
      for (const [path, data] of Object.entries(zipFiles)) {
        if (path.endsWith("/") || data.length === 0 || path.startsWith("__MACOSX")) continue;
        const ext = (path.split(".").pop() ?? "").toLowerCase();
        const isText = TEXT_EXTS.has(ext) && data.length <= 200_000;
        const content = isText
          ? (() => { try { return new TextDecoder().decode(data); } catch { return undefined; } })()
          : undefined;
        entries.push({ path, displayPath: path, data, isText, content });
      }
      setFileEntries(entries);
      setFilesLoaded(true);
    } catch (e: any) {
      setFilesErr(e.message ?? "Failed to load package files");
    } finally { setLoadingFiles(false); }
  }, [item.id, item.version]);

  useEffect(() => {
    if (expanded && !filesLoaded && !loadingFiles && item.r2_zip_key) {
      loadFiles();
    }
  }, [expanded, filesLoaded, loadingFiles, item.r2_zip_key, loadFiles]);

  const handleFileEdit = useCallback((path: string, content: string) => {
    setEditedFiles(prev => ({ ...prev, [path]: content }));
  }, []);

  const hasFileEdits = Object.keys(editedFiles).length > 0;

  const handleSaveFiles = async () => {
    setSavingFiles(true); setFilesErr("");
    try {
      const zipData: Record<string, Uint8Array> = {};
      for (const entry of fileEntries) {
        if (editedFiles[entry.path] !== undefined) {
          zipData[entry.path] = new TextEncoder().encode(editedFiles[entry.path]);
        } else {
          zipData[entry.path] = entry.data;
        }
      }
      const zipped = zipSync(zipData);
      const zipFile = new File([zipped.buffer as ArrayBuffer], "package.zip", { type: "application/zip" });

      // Extract edited SKILL.md if any
      const skillmdKey = Object.keys(editedFiles).find(k => k.toLowerCase().endsWith("skill.md"));
      const skillmdFile = skillmdKey
        ? new File([editedFiles[skillmdKey]], "SKILL.md", { type: "text/markdown" })
        : undefined;

      await uploadPackage(item.id, item.version, zipFile, skillmdFile);
      setEditedFiles({});
      onAction(`Files updated for ${item.name}@${item.version}`);
    } catch (e: any) {
      setFilesErr(e.message);
    } finally { setSavingFiles(false); }
  };

  const handleSaveMeta = async () => {
    setSavingMeta(true); setFilesErr("");
    try {
      await publishMetadata({
        id: item.id,
        name: item.name,
        description: editDescription,
        type: item.type,
        version: item.version,
        trust: editTrust,
        maturity: editMaturity,
        domain: editDomain,
        publisher: item.publisher,
        visibility: "public",
        tags: editTags,
        modes: [],
      }, true); // admin saves go directly to published state
      onAction(`Metadata saved for ${item.name}`);
    } catch (e: any) {
      setFilesErr(e.message);
    } finally { setSavingMeta(false); }
  };

  const act = async (action: "approve" | "reject" | "yank") => {
    setActing(true);
    try {
      await approvePackage(item.id, item.version, action, editTrust, note || undefined);
      onAction(
        action === "approve" ? `Approved: ${item.name}@${item.version}`
        : action === "reject" ? `Rejected: ${item.name}@${item.version}`
        : `Yanked: ${item.name}@${item.version}`
      );
    } catch (e: any) {
      onError(e.message);
    } finally { setActing(false); }
  };

  const displayTags = parseTags(item.tags);

  return (
    <Card>
      {/* ── Collapsed header ── */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#ccc", fontWeight: 600, fontSize: 12 }}>{item.name}</span>
            <span style={{ color: "#555", fontSize: 10 }}>v{item.version}</span>
            <TrustBadge trust={item.trust} />
            <span style={{ fontSize: 9, background: "#1a1a2a", borderRadius: 3, padding: "1px 5px", color: "#888" }}>{item.maturity}</span>
            <span style={{ fontSize: 9, background: "#1a1a2a", borderRadius: 3, padding: "1px 5px", color: "#888" }}>{item.type}</span>
            {item.domain && <span style={{ fontSize: 9, color: "#555" }}>{item.domain}</span>}
          </div>
          {item.description && (
            <div style={{ marginTop: 5, fontSize: 11, color: "#999", lineHeight: 1.45, maxWidth: 600 }}>
              {item.description}
            </div>
          )}
          <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#6ab0c8" }}>by {item.publisher}</span>
            {item.zip_size_bytes && (
              <span style={{ fontSize: 10, color: "#4ec9b066" }}>
                {(item.zip_size_bytes / 1024).toFixed(1)} KB
              </span>
            )}
            {!item.r2_zip_key && (
              <span style={{ fontSize: 10, color: "#c8a45a" }}>⚠ no zip</span>
            )}
            {displayTags.slice(0, 5).map(t => (
              <span key={t} style={{ fontSize: 8, padding: "1px 5px", background: "#12121e", border: "1px solid #1e1e2e", borderRadius: 2, color: "#4ec9b055" }}>{t}</span>
            ))}
          </div>
        </div>
        <span style={{ color: "#555", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #2a2a2a" }}>

          {/* Submitter + timestamp */}
          <div style={{ fontSize: 10, color: "#555", marginBottom: 12 }}>
            Submitted {new Date(item.published_at).toLocaleString()} by{" "}
            <span style={{ color: "#6ab0c8", fontWeight: 600 }}>{item.publisher}</span>
          </div>

          {/* ── Metadata edit ── */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#4ec9b0", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Edit Metadata
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Description</label>
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={2}
                  style={{ ...inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                />
              </div>
              <div>
                <label style={lbl}>Domain</label>
                <input value={editDomain} onChange={e => setEditDomain(e.target.value)} style={inp} placeholder="e.g. robotics" />
              </div>
              <div>
                <label style={lbl}>Trust Level</label>
                <select value={editTrust} onChange={e => setEditTrust(e.target.value)} style={{ ...inp, width: "auto" }}>
                  <option value="untrusted">untrusted</option>
                  <option value="reviewed">reviewed</option>
                  <option value="org-approved">org-approved</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Maturity</label>
                <select value={editMaturity} onChange={e => setEditMaturity(e.target.value)} style={{ ...inp, width: "auto" }}>
                  <option value="L1">L1 — no structure</option>
                  <option value="L2">L2 — SKILL.md or knowledge docs</option>
                  <option value="L3">L3 — SKILL.md + scripts + docs</option>
                  <option value="L4">L4 — manifest + tests</option>
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>Tags (comma-separated, Enter to confirm)</label>
                <input
                  value={editTagsRaw}
                  onChange={e => {
                    setEditTagsRaw(e.target.value);
                    setEditTags(e.target.value.split(",").map(t => t.trim()).filter(Boolean));
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = editTagsRaw.trimEnd();
                      if (v && !v.endsWith(",")) {
                        const newRaw = v + ", ";
                        setEditTagsRaw(newRaw);
                        setEditTags(newRaw.split(",").map(t => t.trim()).filter(Boolean));
                      }
                    }
                  }}
                  placeholder="python, typescript, ..."
                  style={inp}
                />
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <Btn size="xs" variant="ghost" onClick={handleSaveMeta} disabled={savingMeta}>
                {savingMeta ? "Saving…" : "Save Metadata"}
              </Btn>
            </div>
          </div>

          {/* ── File preview / editor ── */}
          {item.r2_zip_key ? (
            loadingFiles ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: "#555", marginBottom: 12 }}>
                <Spinner /> Loading package files…
              </div>
            ) : filesErr ? (
              <div style={{ fontSize: 10, color: "#e05555", marginBottom: 12 }}>{filesErr}</div>
            ) : filesLoaded && fileEntries.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#4ec9b0", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Package Files
                </div>
                <FilePanel entries={fileEntries} editedFiles={editedFiles} onEdit={handleFileEdit} />
                {hasFileEdits && (
                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                    <Btn size="xs" variant="success" onClick={handleSaveFiles} disabled={savingFiles}>
                      {savingFiles ? "Uploading…" : `Save file changes (${Object.keys(editedFiles).length} modified)`}
                    </Btn>
                    <Btn size="xs" variant="ghost" onClick={() => setEditedFiles({})}>Discard edits</Btn>
                  </div>
                )}
              </div>
            ) : null
          ) : (
            <div style={{ fontSize: 10, color: "#555", marginBottom: 12 }}>No package zip uploaded yet.</div>
          )}

          {/* ── Approval actions ── */}
          <div style={{ paddingTop: 12, borderTop: "1px solid #1a1a2a" }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>Note (optional)</div>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Reason for approval / rejection…"
                style={{ ...inp }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn variant="success" onClick={() => act("approve")} disabled={acting}>✓ Approve ({editTrust})</Btn>
              <Btn variant="danger" onClick={() => act("reject")} disabled={acting}>✗ Reject</Btn>
              <Btn variant="warn" onClick={() => act("yank")} disabled={acting}>⚑ Yank</Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [approving, setApproving] = useState(false);

  const load = () => {
    setLoading(true);
    listPending()
      .then(d => setItems(d.items))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const approveAll = async () => {
    if (items.length === 0) return;
    setApproving(true);
    try {
      const result = await batchApprove(items.map(i => ({ dd_id: i.id, version: i.version })), "reviewed");
      showToast(`Approved ${result.approved} item(s)`);
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <SectionTitle>Pending Review</SectionTitle>
        <Btn onClick={load} variant="ghost">Refresh</Btn>
        {items.length > 0 && (
          <Btn onClick={approveAll} variant="success" disabled={approving}>
            {approving ? "Approving…" : `✓ Approve All (${items.length})`}
          </Btn>
        )}
      </div>

      {err && <div style={{ color: "#e05555", marginBottom: 12, fontSize: 11 }}>Error: {err}</div>}
      {toast && (
        <div style={{ padding: "6px 12px", background: "#0a2a20", border: "1px solid #4ec9b044", borderRadius: 4, fontSize: 11, color: "#4ec9b0", marginBottom: 12 }}>
          ✓ {toast}
        </div>
      )}

      {loading ? <Spinner /> : items.length === 0 ? (
        <div style={{ color: "#555", padding: 24, textAlign: "center" }}>No pending items — you're all caught up.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(item => (
            <PendingCard
              key={`${item.id}@${item.version}`}
              item={item}
              onAction={msg => { showToast(msg); load(); }}
              onError={msg => setErr(msg)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
