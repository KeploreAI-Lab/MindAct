import React, { useEffect, useState } from "react";
import { listPackages, listVersions, setStatus, approvePackage, publishMetadata, getItemManifest, trustAllPublished } from "../api";
import { Card, SectionTitle, Spinner, StatusBadge, TrustBadge, Btn, Select } from "../ui";

type Pkg = Awaited<ReturnType<typeof listPackages>>["items"][number];
type VerRow = Awaited<ReturnType<typeof listVersions>>["versions"][number];

function fmtBytes(n: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
  catch { return raw.split(",").map(t => t.trim()).filter(Boolean); }
}

function bumpVersion(v: string, part: "major" | "minor" | "patch"): string {
  const [maj, min, pat] = v.split(".").map(n => parseInt(n, 10) || 0);
  if (part === "major") return `${maj + 1}.0.0`;
  if (part === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

// ─── Keyword → domain/tag inference (mirrors UploadPage logic) ───────────────

const KW_DOMAIN_P: [string[], string][] = [
  [["robot", "ros", "navigat", "slam", "lidar", "sensor", "drone", "arm"], "robotics"],
  [["code", "program", "debug", "refactor", "lint", "compil", "develop"], "coding"],
  [["data", "analys", "dataset", "pandas", "numpy", "statistic", "csv", "excel"], "data-science"],
  [["deploy", "docker", "kubernetes", "k8s", "pipeline", "infra", "cicd", "ci/cd"], "devops"],
  [["nlp", "language model", "text", "tokeniz", "embed", "llm", "gpt", "claude"], "nlp"],
  [["web", "http", "rest", "graphql", "frontend", "backend", "server", "endpoint"], "web"],
  [["machine learning", "neural", "tensorflow", "pytorch", "train model", "model"], "ml"],
  [["security", "auth", "encrypt", "vulnerab", "pentest", "scan", "cve"], "security"],
  [["test", "qa", "quality", "coverage", "unit test", "integration test"], "testing"],
  [["doc", "documentation", "readme", "spec", "guide", "tutorial"], "documentation"],
  [["task", "schedule", "calendar", "note", "todo", "organiz"], "productivity"],
  [["finance", "trading", "stock", "crypto", "accounting", "billing", "invoice"], "finance"],
  [["pcb", "circuit", "schematic", "gerber", "kicad", "eagle", "altium", "netlist", "footprint"], "pcb"],
  [["electronic", "microcontroller", "arduino", "raspberry", "fpga", "firmware", "uart", "spi", "i2c", "gpio"], "electronics"],
  [["hardware", "embedded", "rtos", "baremetal", "bare-metal"], "embedded"],
];

const KW_TAGS_P: [string[], string][] = [
  [["python", " py "], "python"],
  [["typescript", " ts "], "typescript"],
  [["javascript", " js "], "javascript"],
  [["ros2", "ros "], "ros2"],
  [["automat"], "automation"],
  [["analys", "analyz"], "analysis"],
  [["debug"], "debugging"],
  [["refactor"], "refactor"],
  [["document", "readme"], "documentation"],
  [[" api ", "endpoint"], "api"],
  [["cli", "command-line", "command line"], "cli"],
  [["test", "qa ", "quality"], "testing"],
  [["llm", "gpt", "claude ", "openai", "language model"], "llm"],
  [["workflow"], "workflow"],
  [["search", "query", "retriev"], "search"],
  [["github", " git "], "github"],
  [["docker", "container"], "docker"],
  [["kubernetes", "k8s"], "kubernetes"],
  [["sql", "database", "postgres", "mysql", "sqlite"], "database"],
];

function inferKw<T extends string>(text: string, map: [string[], T][]): T[] {
  const lower = ` ${text.toLowerCase()} `;
  return map.filter(([kws]) => kws.some(k => lower.includes(k))).map(([, v]) => v);
}

/** Exact word → tag */
const PTERM_TAG: Record<string, string> = {
  python: "python", py: "python",
  typescript: "typescript", ts: "typescript",
  javascript: "javascript", js: "javascript",
  rust: "rust", golang: "golang", java: "java",
  kotlin: "kotlin", ruby: "ruby", bash: "bash", shell: "bash",
  swift: "swift",
  ros: "ros2", ros2: "ros2", gazebo: "ros2", rviz: "ros2",
  pytorch: "pytorch", tensorflow: "tensorflow", keras: "keras",
  sklearn: "sklearn", openai: "llm", langchain: "llm",
  llamaindex: "llm", embedding: "llm", transformer: "llm",
  pandas: "pandas", numpy: "numpy", polars: "polars",
  sql: "database", postgres: "database", mysql: "database",
  sqlite: "database", mongodb: "database", redis: "database",
  docker: "docker", kubernetes: "kubernetes", k8s: "kubernetes",
  terraform: "terraform", ansible: "ansible",
  fastapi: "api", flask: "api", django: "api",
  express: "api", graphql: "api", grpc: "api",
  react: "react", vue: "vue", angular: "angular",
  pytest: "testing", jest: "testing",
  selenium: "testing", playwright: "testing",
  automation: "automation", workflow: "workflow",
  analytics: "analysis", visualization: "analysis",
  refactoring: "refactor", linting: "refactor",
  documentation: "documentation", cli: "cli",
  search: "search", retrieval: "search",
};

/** Exact word → domain */
const PTERM_DOMAIN: Record<string, string> = {
  ros: "robotics", ros2: "robotics", gazebo: "robotics", rviz: "robotics",
  slam: "robotics", lidar: "robotics", sensor: "robotics",
  drone: "robotics", robot: "robotics", navigation: "robotics",
  linter: "coding", debugger: "coding", compiler: "coding",
  refactor: "coding", ide: "coding",
  pandas: "data-science", numpy: "data-science", polars: "data-science",
  analytics: "data-science", dataset: "data-science", csv: "data-science",
  dataframe: "data-science", statistics: "data-science",
  docker: "devops", kubernetes: "devops", k8s: "devops",
  terraform: "devops", ansible: "devops", jenkins: "devops",
  deployment: "devops", infrastructure: "devops", pipeline: "devops",
  llm: "nlp", gpt: "nlp", embedding: "nlp",
  tokenizer: "nlp", transformer: "nlp", bert: "nlp",
  pytorch: "ml", tensorflow: "ml", keras: "ml", sklearn: "ml",
  neural: "ml", training: "ml",
  fastapi: "web", flask: "web", django: "web",
  express: "web", react: "web", vue: "web",
  graphql: "web", grpc: "web",
  authentication: "security", encryption: "security",
  vulnerability: "security", oauth: "security", firewall: "security",
  pytest: "testing", jest: "testing",
  selenium: "testing", playwright: "testing", coverage: "testing",
  trading: "finance", stock: "finance", crypto: "finance",
  accounting: "finance", invoice: "finance",
  calendar: "productivity", scheduler: "productivity",
  readme: "documentation", spec: "documentation", wiki: "documentation",
  // pcb
  pcb: "pcb", circuit: "pcb", schematic: "pcb", gerber: "pcb",
  kicad: "pcb", eagle: "pcb", altium: "pcb", netlist: "pcb", footprint: "pcb",
  // electronics / embedded
  microcontroller: "electronics", arduino: "electronics", raspberry: "electronics",
  fpga: "electronics", firmware: "electronics", uart: "electronics",
  spi: "electronics", i2c: "electronics", gpio: "electronics",
  embedded: "embedded", rtos: "embedded",
};

function extractDescKw(desc: string): { tags: string[]; domains: string[] } {
  const words = desc.toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) ?? [];
  const seenTags = new Set<string>(), seenDomains = new Set<string>();
  const tags: string[] = [], domains: string[] = [];
  for (const w of words) {
    const tag = PTERM_TAG[w];
    if (tag && !seenTags.has(tag)) { seenTags.add(tag); tags.push(tag); }
    const domain = PTERM_DOMAIN[w];
    if (domain && !seenDomains.has(domain)) { seenDomains.add(domain); domains.push(domain); }
  }
  return { tags, domains };
}

// ─── Tag Picker ───────────────────────────────────────────────────────────────

/** suggestions: freq-based (freq=true → from registry); inferred chips shown with distinct style */
function TagPicker({ current, suggestions, inferred, onChange }: {
  current: string[];
  suggestions: string[];
  inferred?: string[];
  onChange: (tags: string[]) => void;
}) {
  const toggle = (tag: string) =>
    onChange(current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag]);

  // Merge: inferred first (if not already in suggestions), then freq-based
  const seen = new Set<string>();
  const merged: { value: string; isInferred: boolean }[] = [];
  for (const t of (inferred ?? [])) {
    if (!seen.has(t)) { seen.add(t); merged.push({ value: t, isInferred: true }); }
  }
  for (const t of suggestions) {
    if (!seen.has(t)) { seen.add(t); merged.push({ value: t, isInferred: false }); }
  }

  return (
    <div>
      {merged.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
          {merged.map(({ value: tag, isInferred }) => {
            const active = current.includes(tag);
            return (
              <button key={tag} onClick={() => toggle(tag)} style={{
                background: active ? "#0d2a1c" : isInferred ? "#0d1a24" : "#12121e",
                border: `1px solid ${active ? "#4ec9b0" : isInferred ? "#2a3a4a" : "#252535"}`,
                borderRadius: 3, color: active ? "#4ec9b0" : isInferred ? "#6ab0c8" : "#555",
                fontSize: 9, padding: "2px 6px", cursor: "pointer", transition: "all 0.1s",
              }}>
                {tag}
              </button>
            );
          })}
        </div>
      )}
      <input
        value={current.join(", ")}
        onChange={e => onChange(e.target.value.split(",").map(t => t.trim()).filter(Boolean))}
        placeholder="or type tags, comma-separated"
        style={{
          width: "100%", background: "#0d0d1a", border: "1px solid #2a2a3a",
          borderRadius: 4, color: "#d4d4d4", padding: "4px 7px", fontSize: 11, outline: "none",
        }}
      />
    </div>
  );
}

// ─── Domain Picker ────────────────────────────────────────────────────────────

function DomainPicker({ current, topDomains, inferred, onChange }: {
  current: string;
  topDomains: string[];
  inferred: string[];
  onChange: (v: string) => void;
}) {
  // Merge: inferred first, then freq-based
  const seen = new Set<string>();
  const merged: { value: string; isInferred: boolean }[] = [];
  for (const v of inferred) {
    if (!seen.has(v)) { seen.add(v); merged.push({ value: v, isInferred: true }); }
  }
  for (const v of topDomains) {
    if (!seen.has(v)) { seen.add(v); merged.push({ value: v, isInferred: false }); }
  }
  if (merged.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 5 }}>
      {merged.map(({ value, isInferred }) => {
        const active = current === value;
        return (
          <button key={value} type="button" onClick={() => onChange(active ? "" : value)} style={{
            fontSize: 9, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
            border: `1px solid ${active ? "#4ec9b0" : isInferred ? "#2a3a4a" : "#1e1e2e"}`,
            background: active ? "#0a2a2a" : isInferred ? "#0d1a24" : "#111118",
            color: active ? "#4ec9b0" : isInferred ? "#6ab0c8" : "#444",
            transition: "all 0.1s",
          }}>
            {value}
          </button>
        );
      })}
    </div>
  );
}

// ─── Version Panel (used inside EditForm) ────────────────────────────────────

function VersionPanel({ ddId, highlightVersion, onChanged }: {
  ddId: string;
  highlightVersion: string;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<VerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    listVersions(ddId).then(d => setRows(d.versions)).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, [ddId]);

  const doAction = async (version: string, action: string) => {
    setBusy(version + action);
    try {
      if (action === "approve") await approvePackage(ddId, version, "approve", "reviewed");
      else if (action === "reject") await approvePackage(ddId, version, "reject");
      else await setStatus(ddId, version, action);
      load(); onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ borderLeft: "1px solid #1a1a2a", paddingLeft: 14, minWidth: 0 }}>
      <div style={{
        fontSize: 10, color: "#4ec9b0", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
      }}>
        Version History
      </div>

      {loading ? (
        <div style={{ fontSize: 10, color: "#444" }}><Spinner /></div>
      ) : err ? (
        <div style={{ fontSize: 10, color: "#e05555" }}>{err}</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 10, color: "#444" }}>No versions found</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {rows.map(v => {
            const isHighlighted = v.version === highlightVersion;
            return (
              <div key={v.version} style={{
                padding: "7px 9px",
                background: isHighlighted ? "#0a1e16" : "#0e0e1c",
                border: `1px solid ${isHighlighted ? "#4ec9b033" : "#1a1a2a"}`,
                borderRadius: 4,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: v.is_latest ? "#4ec9b0" : "#777" }}>
                    v{v.version}
                  </span>
                  {v.is_latest && (
                    <span style={{ fontSize: 8, color: "#4ec9b0", background: "#0a2a1a", padding: "1px 4px", borderRadius: 2 }}>
                      latest
                    </span>
                  )}
                  <StatusBadge status={v.status} />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: "#444" }}>{fmtDate(v.published_at)}</span>
                  <TrustBadge trust={v.trust} />
                  <span style={{ fontSize: 9, color: "#444" }}>{fmtBytes(v.zip_size_bytes)}</span>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {v.status === "pending" && (
                    <>
                      <Btn size="xs" variant="success" onClick={() => doAction(v.version, "approve")} disabled={!!busy}>Approve</Btn>
                      <Btn size="xs" variant="danger" onClick={() => doAction(v.version, "reject")} disabled={!!busy}>Reject</Btn>
                    </>
                  )}
                  {v.status === "published" && (
                    <Btn size="xs" variant="warn" onClick={() => doAction(v.version, "deprecated")} disabled={!!busy}>Deprecate</Btn>
                  )}
                  {v.status !== "yanked" && v.status !== "pending" && (
                    <Btn size="xs" variant="danger" onClick={() => doAction(v.version, "yanked")} disabled={!!busy}>Yank</Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Bulk Actions Bar ─────────────────────────────────────────────────────────

function BulkActionsBar({ selectedIds, items, onDone, onClear }: {
  selectedIds: Set<string>;
  items: Pkg[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [field, setField] = useState<"publisher" | "trust" | "visibility" | "">("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const selected = items.filter(p => selectedIds.has(p.id));

  const applyBulk = async () => {
    if (!field || !value) return;
    setBusy(true); setErr("");
    try {
      await Promise.all(selected.map(pkg =>
        publishMetadata({
          id: pkg.id,
          name: pkg.name,
          description: pkg.description ?? "",
          type: pkg.type,
          version: pkg.version,
          trust: field === "trust" ? value : pkg.trust,
          maturity: pkg.maturity,
          domain: pkg.domain ?? "",
          publisher: field === "publisher" ? value : pkg.publisher,
          visibility: field === "visibility" ? value : pkg.visibility,
          tags: parseTags(pkg.tags),
          modes: [],
        }, true)  // admin bulk edits always force-publish (skip pending queue)
      ));
      onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const selectStyle: React.CSSProperties = {
    background: "#0d0d1a", border: "1px solid #2a2a3a", borderRadius: 3,
    color: "#d4d4d4", padding: "3px 7px", fontSize: 11, outline: "none",
  };

  return (
    <div style={{
      padding: "8px 14px", background: "#0a1020",
      border: "1px solid #1a3050", borderRadius: 6, marginBottom: 12,
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 11, color: "#7dd3fc", fontWeight: 700 }}>
        {selectedIds.size} selected
      </span>
      <span style={{ fontSize: 10, color: "#444" }}>Bulk change:</span>

      <select value={field} onChange={e => { setField(e.target.value as any); setValue(""); }} style={selectStyle}>
        <option value="">— field —</option>
        <option value="publisher">Publisher</option>
        <option value="trust">Trust Level</option>
        <option value="visibility">Visibility</option>
      </select>

      {field === "trust" && (
        <select value={value} onChange={e => setValue(e.target.value)} style={selectStyle}>
          <option value="">—</option>
          <option value="untrusted">untrusted</option>
          <option value="reviewed">reviewed</option>
          <option value="org-approved">org-approved</option>
        </select>
      )}
      {field === "visibility" && (
        <select value={value} onChange={e => setValue(e.target.value)} style={selectStyle}>
          <option value="">—</option>
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="org">org</option>
        </select>
      )}
      {field === "publisher" && (
        <input value={value} onChange={e => setValue(e.target.value)}
          placeholder="New publisher name…"
          style={{ ...selectStyle, width: 150, padding: "3px 8px" }} />
      )}

      {field && value && (
        <Btn size="xs" variant="success" onClick={applyBulk} disabled={busy}>
          {busy ? "Applying…" : `Apply to ${selectedIds.size} packages`}
        </Btn>
      )}
      {err && <span style={{ fontSize: 10, color: "#e05555" }}>{err}</span>}

      <button onClick={onClear} style={{ marginLeft: "auto", background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 10 }}>
        Clear selection ×
      </button>
    </div>
  );
}

// ─── Edit Form ────────────────────────────────────────────────────────────────

function EditForm({ pkg, allItems, onSaved, onCancel, onVersionAction }: {
  pkg: Pkg;
  allItems: Pkg[];
  onSaved: () => void;
  onCancel: () => void;
  onVersionAction: () => void;
}) {
  // Top tags + domains across all packages (frequency-based)
  const tagFreq = new Map<string, number>();
  const domainFreq = new Map<string, number>();
  for (const item of allItems) {
    parseTags(item.tags).forEach(t => tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1));
    if (item.domain) domainFreq.set(item.domain, (domainFreq.get(item.domain) ?? 0) + 1);
  }
  const topTags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([tag]) => tag);
  const topDomains = [...domainFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([d]) => d);

  const [tags, setTags] = useState<string[]>(parseTags(pkg.tags));
  const [form, setForm] = useState({
    name: pkg.name,
    description: pkg.description ?? "",
    domain: pkg.domain ?? "",
    visibility: pkg.visibility,
    publisher: pkg.publisher,
    trust: pkg.trust,
    newVersion: pkg.version,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [manifestLoading, setManifestLoading] = useState(!pkg.description && !pkg.domain && !pkg.tags);

  // On mount: if identity columns are empty, fetch full manifest to pre-populate
  useEffect(() => {
    if (pkg.description && pkg.domain && pkg.tags) return; // already have data
    setManifestLoading(true);
    getItemManifest(pkg.id)
      .then(m => {
        if (!m) return;
        setForm(f => ({
          ...f,
          description: f.description || m.description,
          domain: f.domain || m.domain,
        }));
        if (!pkg.tags && m.tags) setTags(parseTags(m.tags));
      })
      .catch(() => { /* silent — just leave fields empty */ })
      .finally(() => setManifestLoading(false));
  }, [pkg.id]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Keyword inference: word-level from description + substring maps from all fields
  const kwCtx = `${form.name} ${pkg.id} ${form.description}`;
  const fromDesc = extractDescKw(form.description);
  const inferredDomains = [
    ...fromDesc.domains,
    ...inferKw(kwCtx, KW_DOMAIN_P).filter(d => !fromDesc.domains.includes(d)),
  ];
  const inferredTags = [
    ...fromDesc.tags,
    ...inferKw(kwCtx, KW_TAGS_P).filter(t => !fromDesc.tags.includes(t)),
  ];
  const bump = (part: "major" | "minor" | "patch") =>
    setForm(f => ({ ...f, newVersion: bumpVersion(f.newVersion, part) }));

  const handleSave = async () => {
    setSaving(true); setErr("");
    try {
      await publishMetadata({
        id: pkg.id,
        name: form.name || pkg.name,
        description: form.description,
        type: pkg.type,
        version: form.newVersion || pkg.version,
        trust: form.trust,
        maturity: pkg.maturity,
        domain: form.domain,
        publisher: form.publisher,
        visibility: form.visibility,
        tags,
        modes: [],
      }, pkg.pkg_status === "published");
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const inp: React.CSSProperties = {
    width: "100%", background: "#0d0d1a", border: "1px solid #2a2a3a",
    borderRadius: 4, color: "#d4d4d4", padding: "5px 8px", fontSize: 11, outline: "none",
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: "#555", display: "block", marginBottom: 3 };
  const bumpBtn: React.CSSProperties = {
    background: "#101020", border: "1px solid #2a2a3a", borderRadius: 3,
    color: "#7dd3fc", fontSize: 9, padding: "2px 7px", cursor: "pointer", fontFamily: "monospace",
  };

  return (
    <tr style={{ background: "#07071a" }}>
      <td colSpan={9} style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>

          {/* ── Left: metadata fields ── */}
          <div style={{ flex: "0 0 56%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={lbl}>Display Name</label>
              <input value={form.name} onChange={e => set("name", e.target.value)} style={inp} />
            </div>
            <div>
              <label style={lbl}>Publisher</label>
              <input value={form.publisher} onChange={e => set("publisher", e.target.value)} style={inp} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>
                Description
                {manifestLoading && <span style={{ color: "#555", marginLeft: 6, fontSize: 9 }}>loading…</span>}
              </label>
              <textarea value={form.description} onChange={e => set("description", e.target.value)}
                rows={3} placeholder="Describe what this skill/package does"
                style={{ ...inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
            </div>
            <div>
              <label style={lbl}>Domain</label>
              <input value={form.domain} onChange={e => set("domain", e.target.value)} style={inp} placeholder="e.g. robotics" />
              <DomainPicker
                current={form.domain}
                topDomains={topDomains}
                inferred={inferredDomains}
                onChange={v => set("domain", v)}
              />
            </div>
            <div>
              <label style={lbl}>Visibility</label>
              <select value={form.visibility} onChange={e => set("visibility", e.target.value)}
                style={{ ...inp, width: "auto" }}>
                <option value="public">public</option>
                <option value="private">private</option>
                <option value="org">org</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Trust Level</label>
              <select value={form.trust} onChange={e => set("trust", e.target.value)}
                style={{ ...inp, width: "auto" }}>
                <option value="untrusted">untrusted</option>
                <option value="reviewed">reviewed</option>
                <option value="org-approved">org-approved</option>
              </select>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>Tags</label>
              <TagPicker current={tags} suggestions={topTags} inferred={inferredTags} onChange={setTags} />
            </div>

            {/* Version bump row */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>Version</label>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <input value={form.newVersion} onChange={e => set("newVersion", e.target.value)}
                  style={{ ...inp, width: 82 }} />
                <button style={bumpBtn} onClick={() => bump("patch")}>+patch</button>
                <button style={bumpBtn} onClick={() => bump("minor")}>+minor</button>
                <button style={bumpBtn} onClick={() => bump("major")}>+major</button>
                {form.newVersion !== pkg.version ? (
                  <span style={{ fontSize: 9, color: "#4ec9b0" }}>→ creates new version</span>
                ) : (
                  <span style={{ fontSize: 9, color: "#444" }}>same version — updates in place</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: version history ── */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <VersionPanel
              ddId={pkg.id}
              highlightVersion={form.newVersion}
              onChanged={onVersionAction}
            />
          </div>
        </div>

        {err && <div style={{ color: "#e05555", fontSize: 10, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 12, alignItems: "center" }}>
          <Btn size="xs" variant="success" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Btn>
          <Btn size="xs" variant="ghost" onClick={onCancel}>Cancel</Btn>
          <span style={{ fontSize: 9, color: "#333", marginLeft: 4 }}>
            {pkg.id} · {pkg.type} · maturity {pkg.maturity}
          </span>
        </div>
      </td>
    </tr>
  );
}

// ─── Packages Page ────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const [items, setItems] = useState<Pkg[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = (status?: string) => {
    setLoading(true);
    listPackages(status || undefined)
      .then(d => setItems(d.items))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const handleTrustAll = async () => {
    if (!confirm("Mark ALL published-but-untrusted packages as 'reviewed'? This cannot be undone.")) return;
    try {
      const res = await trustAllPublished("reviewed");
      showToast(`Trusted ${res.updated} packages`);
      load(filter || undefined);
    } catch (e: any) { setErr(e.message); }
  };

  const handleSetStatus = async (pkg: Pkg, newStatus: string) => {
    try {
      await setStatus(pkg.id, pkg.version, newStatus);
      showToast(`${pkg.name} → ${newStatus}`);
      load(filter || undefined);
    } catch (e: any) { setErr(e.message); }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filtered = filter ? items.filter(i => i.pkg_status === filter) : items;
  const allVisibleSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    const ids = filtered.map(p => p.id);
    if (allVisibleSelected) {
      setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <SectionTitle>Packages</SectionTitle>
        <Select value={filter} onChange={setFilter} options={[
          { value: "", label: "All statuses" },
          { value: "pending", label: "Pending" },
          { value: "published", label: "Published" },
          { value: "deprecated", label: "Deprecated" },
          { value: "yanked", label: "Yanked" },
        ]} />
        <Btn variant="ghost" size="sm" onClick={handleTrustAll}>
          ✓ Trust All Published
        </Btn>
        <Btn onClick={() => load(filter || undefined)} variant="ghost">Refresh</Btn>
      </div>

      {err && <div style={{ color: "#e05555", marginBottom: 12, fontSize: 11 }}>Error: {err}</div>}
      {toast && (
        <div style={{ padding: "6px 12px", background: "#0a2a20", border: "1px solid #4ec9b044", borderRadius: 4, fontSize: 11, color: "#4ec9b0", marginBottom: 12 }}>
          ✓ {toast}
        </div>
      )}

      {selectedIds.size >= 2 && (
        <BulkActionsBar
          selectedIds={selectedIds}
          items={items}
          onDone={() => { setSelectedIds(new Set()); showToast(`Bulk update applied to ${selectedIds.size} packages`); load(filter || undefined); }}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {loading ? <Spinner /> : (
        <Card>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #2a2a2a" }}>
                <th style={{ padding: "6px 10px", width: 32 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
                    style={{ cursor: "pointer", accentColor: "#4ec9b0" }} />
                </th>
                {["Name / Description", "Type", "Published", "Trust", "Status", "Size", "Installs", "Actions"].map(h => (
                  <th key={h} style={{ padding: "6px 10px", fontSize: 10, color: "#555", textAlign: "left", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 20, color: "#555", textAlign: "center" }}>No packages</td></tr>
              ) : filtered.map(pkg => (
                <React.Fragment key={pkg.id}>
                  <tr style={{
                    borderBottom: editing === pkg.id ? "none" : "1px solid #1a1a1a",
                    background: selectedIds.has(pkg.id) ? "#0a0a1e" : "transparent",
                  }}>
                    <td style={{ padding: "7px 10px" }}>
                      <input type="checkbox" checked={selectedIds.has(pkg.id)} onChange={() => toggleSelect(pkg.id)}
                        style={{ cursor: "pointer", accentColor: "#4ec9b0" }} />
                    </td>
                    <td style={{ padding: "7px 10px", maxWidth: 240 }}>
                      <div style={{ color: "#ccc", fontSize: 11, fontWeight: 600 }}>{pkg.name}</div>
                      <div style={{ color: "#3a3a5a", fontSize: 9 }}>{pkg.id} · v{pkg.version}</div>
                      {pkg.description && (
                        <div style={{ color: "#555", fontSize: 9, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {pkg.description}
                        </div>
                      )}
                      {parseTags(pkg.tags).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 3 }}>
                          {parseTags(pkg.tags).slice(0, 4).map(t => (
                            <span key={t} style={{ fontSize: 8, padding: "1px 4px", background: "#12121e", border: "1px solid #1e1e2e", borderRadius: 2, color: "#4ec9b066" }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#888", fontSize: 10 }}>{pkg.type}</td>
                    <td style={{ padding: "7px 10px", color: "#666", fontSize: 10 }}>
                      {new Date(pkg.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </td>
                    <td style={{ padding: "7px 10px" }}><TrustBadge trust={pkg.trust} /></td>
                    <td style={{ padding: "7px 10px" }}><StatusBadge status={pkg.pkg_status} /></td>
                    <td style={{ padding: "7px 10px", color: "#666", fontSize: 10 }}>{fmtBytes(pkg.zip_size_bytes)}</td>
                    <td style={{ padding: "7px 10px", color: "#666", fontSize: 10, textAlign: "center" }}>{pkg.installed_count}</td>
                    <td style={{ padding: "7px 10px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <Btn size="xs" variant={editing === pkg.id ? "warn" : "ghost"}
                          onClick={() => setEditing(editing === pkg.id ? null : pkg.id)}>
                          {editing === pkg.id ? "Close" : "✏ Edit"}
                        </Btn>
                        {pkg.pkg_status === "pending" && (
                          <Btn size="xs" variant="success" onClick={() => handleSetStatus(pkg, "published")}>Publish</Btn>
                        )}
                        {pkg.pkg_status === "published" && (
                          <Btn size="xs" variant="warn" onClick={() => handleSetStatus(pkg, "deprecated")}>Deprecate</Btn>
                        )}
                        {pkg.pkg_status !== "yanked" && (
                          <Btn size="xs" variant="danger" onClick={() => handleSetStatus(pkg, "yanked")}>Yank</Btn>
                        )}
                      </div>
                    </td>
                  </tr>

                  {editing === pkg.id && (
                    <EditForm
                      pkg={pkg}
                      allItems={items}
                      onSaved={() => {
                        setEditing(null);
                        showToast(`${pkg.name} updated`);
                        load(filter || undefined);
                      }}
                      onCancel={() => setEditing(null)}
                      onVersionAction={() => load(filter || undefined)}
                    />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 10px", fontSize: 10, color: "#333", borderTop: "1px solid #111" }}>
            {filtered.length} package(s) · check rows to bulk-edit · ✏ Edit opens version history
          </div>
        </Card>
      )}
    </div>
  );
}
