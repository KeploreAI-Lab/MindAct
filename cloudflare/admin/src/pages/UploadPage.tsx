import React, { useRef, useState, useCallback } from "react";
import { unzipSync, zipSync } from "fflate";
import { load as yamlLoad } from "js-yaml";
import { publishMetadata, uploadPackage } from "../api";
import { Card, SectionTitle, Btn } from "../ui";

const DEFAULT_PUBLISHER = "kplr-skills-builder";

const EMPTY_MANIFEST: Record<string, unknown> = {
  id: "", name: "", description: "", type: "skill",
  version: "1.0.0", modes: [], tags: [], domain: "",
  publisher: DEFAULT_PUBLISHER, visibility: "public", trust: "reviewed", maturity: "L2",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractFrontmatter(markdown: string): Record<string, unknown> | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try { return yamlLoad(match[1]) as Record<string, unknown>; } catch { return null; }
}

/** Strip frontmatter, return body text */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---[\s\S]*?---\r?\n*/m, "").trim();
}

/** Extract a meaningful description from a markdown body.
 *  Searches all paragraphs for the first one that's ≥ 20 chars.
 *  Handles blockquotes (strips `> `), skips code fences and HTML comments. */
function extractBodyDescription(body: string): string {
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, "")                               // HTML comments
    .replace(/^\s*\[?\s*!\[.*?\]\(.*?\)\s*\]?\(.*?\)\s*$/gm, "") // linked badges
    .replace(/^\s*!\[.*?\]\(.*?\)\s*$/gm, "")                     // plain badges
    .trim();

  const lines = cleaned.split(/\r?\n/);
  const paragraphs: string[] = [];
  let currentPara: string[] = [];
  let inCode = false;

  for (const line of lines) {
    const t = line.trim();

    // Toggle fenced code blocks
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inCode = !inCode;
      if (currentPara.length) { paragraphs.push(currentPara.join(" ")); currentPara = []; }
      continue;
    }
    if (inCode) continue;

    if (!t) {
      if (currentPara.length) { paragraphs.push(currentPara.join(" ")); currentPara = []; }
      continue;
    }
    // Skip headings and horizontal rules; strip blockquote marker instead of skipping
    if (t.startsWith("#") || t.startsWith("---") || t.startsWith("===")) {
      if (currentPara.length) { paragraphs.push(currentPara.join(" ")); currentPara = []; }
      continue;
    }
    const text = t.startsWith(">") ? t.replace(/^>+\s*/, "") : t;
    if (!text) continue;
    currentPara.push(text);
    if (currentPara.join(" ").length > 300) { paragraphs.push(currentPara.join(" ")); currentPara = []; }
  }
  if (currentPara.length) paragraphs.push(currentPara.join(" "));

  // Return first paragraph with at least 20 meaningful characters
  for (const para of paragraphs) {
    const desc = para.replace(/\s+/g, " ").trim();
    if (desc.length >= 20) return desc.slice(0, 300);
  }
  return "";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Preview types & helpers ──────────────────────────────────────────────────

interface PreviewEntry { path: string; content?: string }

/** Strip the longest common directory prefix shared by all entries. */
function normalizePreviewPaths(entries: PreviewEntry[]): PreviewEntry[] {
  if (entries.length < 2) return entries;
  const paths = entries.map(e => e.path);
  const parts0 = paths[0].split("/").slice(0, -1);
  let common = "";
  for (let i = parts0.length; i >= 1; i--) {
    const cand = parts0.slice(0, i).join("/") + "/";
    if (paths.every(p => p.startsWith(cand))) { common = cand; break; }
  }
  if (!common) return entries;
  return entries
    .map(e => ({ ...e, path: e.path.startsWith(common) ? e.path.slice(common.length) : e.path }))
    .filter(e => e.path.length > 0);
}

const LANG_COLOR: Record<string, string> = {
  py: "#4ec9b0", ts: "#9cdcfe", tsx: "#9cdcfe", js: "#dcdcaa", jsx: "#dcdcaa",
  sh: "#89e051", bash: "#89e051", rb: "#e06c75", go: "#4fc1ff", rs: "#ce9178",
  yaml: "#d7ba7d", yml: "#d7ba7d", json: "#9cdcfe", toml: "#d7ba7d",
  md: "#d4d4d4", txt: "#d4d4d4", rst: "#d4d4d4",
};

const TEXT_PREVIEW_EXTS = new Set([
  "md", "txt", "rst", "py", "ts", "tsx", "js", "jsx",
  "sh", "bash", "rb", "go", "rs", "yaml", "yml", "json", "toml", "css", "html",
]);

function PreviewPanel({ entries }: { entries: PreviewEntry[] }) {
  const normalized = React.useMemo(() => normalizePreviewPaths(entries), [entries]);
  const sorted = React.useMemo(() => [...normalized].sort((a, b) => {
    const aS = a.path.toLowerCase().endsWith("skill.md");
    const bS = b.path.toLowerCase().endsWith("skill.md");
    if (aS !== bS) return aS ? -1 : 1;
    return a.path.localeCompare(b.path);
  }), [normalized]);

  const [selected, setSelected] = React.useState(sorted[0]?.path ?? "");
  const entriesKey = sorted.map(e => e.path).join("|");
  React.useEffect(() => {
    const s = sorted.find(e => e.path.toLowerCase().endsWith("skill.md")) ?? sorted[0];
    setSelected(s?.path ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey]);

  const entry = sorted.find(e => e.path === selected);
  const ext = selected.split(".").pop()?.toLowerCase() ?? "";
  const contentColor = LANG_COLOR[ext] ?? "#d4d4d4";

  // Group by top-level dir; root files (no slash) go to ""
  const groups = React.useMemo(() => {
    const g = new Map<string, PreviewEntry[]>();
    for (const e of sorted) {
      const key = e.path.includes("/") ? e.path.split("/")[0] : "";
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    }
    return [...g.entries()].sort(([a], [b]) => a === "" ? -1 : b === "" ? 1 : a.localeCompare(b));
  }, [sorted]);

  const lbl: React.CSSProperties = {
    fontSize: 9, color: "#2a3a4a", letterSpacing: 0.5,
    textTransform: "uppercase", userSelect: "none" as const,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid #1a1a2a", borderRadius: 6, overflow: "hidden", background: "#0d0d18" }}>
      {/* Header */}
      <div style={{ padding: "6px 12px", borderBottom: "1px solid #1a1a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ ...lbl, color: "#3a3a5a" }}>Package Preview</span>
        <span style={{ fontSize: 9, color: "#2a2a4a" }}>{sorted.length} file{sorted.length !== 1 ? "s" : ""}</span>
      </div>

      <div style={{ display: "flex", overflow: "hidden" }}>
        {/* File tree */}
        <div style={{ width: 160, flexShrink: 0, borderRight: "1px solid #1a1a2a", overflowY: "auto", maxHeight: 560, fontSize: 10 }}>
          {groups.map(([group, files]) => (
            <div key={group || "__root"}>
              {group && (
                <div style={{ ...lbl, padding: "5px 8px 2px" }}>{group}/</div>
              )}
              {files.map(e => {
                const name = e.path.split("/").pop() ?? e.path;
                const active = selected === e.path;
                return (
                  <div key={e.path} onClick={() => setSelected(e.path)} title={e.path} style={{
                    padding: `3px 8px 3px ${group ? 18 : 8}px`,
                    cursor: "pointer",
                    background: active ? "#141428" : "transparent",
                    color: active ? "#4ec9b0" : e.content != null ? "#888" : "#333",
                    borderLeft: `2px solid ${active ? "#4ec9b0" : "transparent"}`,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    fontSize: 10,
                  }}>
                    {name}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Content viewer */}
        <div style={{ flex: 1, overflowY: "auto", maxHeight: 560, padding: "8px 12px", minWidth: 0 }}>
          <div style={{ fontSize: 9, color: "#2a2a4a", marginBottom: 6, letterSpacing: 0.3 }}>{selected}</div>
          {entry?.content != null ? (
            <pre style={{
              margin: 0, fontSize: 11, lineHeight: 1.65, color: contentColor,
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            }}>
              {entry.content}
            </pre>
          ) : (
            <div style={{ color: "#333", fontSize: 11, fontStyle: "italic" }}>
              {entry ? "Binary file — not previewable" : "Select a file to preview"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Generate a SKILL.md document from a manifest. */
function generateSkillMd(manifest: Record<string, unknown>): string {
  const tags = Array.isArray(manifest.tags) ? manifest.tags as string[] : [];
  const modes = Array.isArray(manifest.modes) ? manifest.modes as string[] : [];
  const fm = [
    "---",
    `id: ${manifest.id || ""}`,
    `name: ${manifest.name || ""}`,
    `description: ${manifest.description || ""}`,
    `version: ${manifest.version || "1.0.0"}`,
    `type: ${manifest.type || "skill"}`,
    `publisher: ${manifest.publisher || DEFAULT_PUBLISHER}`,
    manifest.domain ? `domain: ${manifest.domain}` : null,
    tags.length ? `tags: [${tags.join(", ")}]` : "tags: []",
    modes.length ? `modes: [${modes.join(", ")}]` : "modes: [interactive]",
    `trust: ${manifest.trust || "untrusted"}`,
    `maturity: ${manifest.maturity || "L1"}`,
    `visibility: ${manifest.visibility || "public"}`,
    "---",
  ].filter(l => l !== null).join("\n");

  const name = String(manifest.name || manifest.id || "Skill");
  const description = String(manifest.description || "");

  return `${fm}

# ${name}

${description || "<!-- Add a description of what this skill does -->"}

## Usage

<!-- Describe how to use this skill -->

## Parameters

<!-- List parameters and their types, e.g.:
- \`param_name\` (string): Description of the parameter
-->

## Examples

<!-- Add usage examples -->
`;
}

/** Classify a file path and return its role */
type FileRole = "entry_doc" | "knowledge_doc" | "executable" | "test" | "config" | "other";

function classifyFile(path: string): FileRole {
  const parts = path.split("/");
  const name = parts[parts.length - 1].toLowerCase();
  const ext = name.split(".").pop() ?? "";
  const inTests = parts.some(p => ["tests", "test", "evals", "__tests__", "eval"].includes(p.toLowerCase()));
  const inExamples = parts.some(p => ["examples", "example"].includes(p.toLowerCase()));

  if (name === "skill.md" || name === "readme.md") return "entry_doc";
  if (["manifest.json", "decision-dependency.yaml", "decision-dependency.yml", "package.json"].includes(name)) return "config";
  if (inTests) return "test";
  if (inExamples) return "knowledge_doc";
  if (["py", "ts", "js", "sh", "bash", "rb", "go", "rs"].includes(ext)) return "executable";
  if (["md", "txt", "rst", "pdf"].includes(ext)) return "knowledge_doc";
  return "other";
}

/** Compute L1–L4 maturity from file roles */
function computeMaturity(roles: FileRole[], hasManifest: boolean): { level: string; reason: string } {
  const exe = roles.filter(r => r === "executable").length;
  const tests = roles.filter(r => r === "test").length;
  const knowledge = roles.filter(r => r === "knowledge_doc").length;
  const hasEntry = roles.includes("entry_doc");

  if (hasManifest && tests > 0) return { level: "L4", reason: `manifest + ${tests} test file(s)` };
  if (hasEntry && exe > 0 && knowledge > 0) return { level: "L3", reason: `SKILL.md + ${exe} script(s) + ${knowledge} doc(s)` };
  if (hasEntry || knowledge > 0) return { level: "L2", reason: hasEntry ? "has SKILL.md" : `${knowledge} knowledge doc(s)` };
  return { level: "L1", reason: "no structure indicators" };
}

function normalizeManifest(
  raw: Record<string, unknown>,
  fallbackName: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const rawId = String(raw.id ?? raw.name ?? fallbackName);
  const id = slugify(rawId) || slugify(fallbackName);
  const meta = (raw.metadata ?? {}) as Record<string, unknown>;
  // Treat null/whitespace-only as absent so body extraction can fill it
  const rawDesc = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const description = String(
    overrides.description ?? rawDesc(raw.description) ?? rawDesc(meta.description) ?? ""
  );
  const version = String(raw.version ?? meta.version ?? "1.0.0");

  return {
    id,
    name:       String(raw.name ?? rawId),
    description,
    version,
    type:       String(overrides.type ?? raw.type ?? "skill"),
    trust:      String(raw.trust ?? "reviewed"),
    maturity:   String(overrides.maturity ?? raw.maturity ?? "L2"),
    domain:     String(raw.domain ?? ""),
    publisher:  String(overrides.publisher ?? raw.publisher ?? DEFAULT_PUBLISHER),
    visibility: String(raw.visibility ?? "public"),
    tags:       Array.isArray(raw.tags) ? raw.tags : [],
    modes:      Array.isArray(raw.modes) ? raw.modes : ["interactive"],
  };
}

// ─── SKILL.md-only analysis ───────────────────────────────────────────────────

interface ZipAnalysis {
  manifest: Record<string, unknown>;
  hints: string[];
  previewEntries: PreviewEntry[];
}

/** Parse a bare SKILL.md file — fills manifest from frontmatter + body description. */
async function analyzeSkillMdFile(file: File): Promise<ZipAnalysis> {
  const text = await file.text();
  const hints: string[] = ["Source: SKILL.md"];

  const fm = extractFrontmatter(text);
  const body = stripFrontmatter(text);
  const bodyDesc = extractBodyDescription(body);

  // Base raw manifest: frontmatter fields (may be empty if no ---  block)
  const raw: Record<string, unknown> = fm ?? {};

  // Fallback name from filename if no name/id in frontmatter
  const fallbackName = file.name.replace(/\.(md|markdown)$/i, "");

  if (fm) {
    hints.push("read frontmatter");
  } else {
    hints.push("no frontmatter — using filename");
  }
  if (bodyDesc && !raw.description) {
    hints.push("description from SKILL.md body");
  }

  // SKILL.md-only packages are always at least L2
  const maturity = String(raw.maturity ?? "L2");
  hints.push(`Maturity ${maturity}: has SKILL.md`);

  const manifest = normalizeManifest(raw, fallbackName, {
    maturity,
    description: bodyDesc || undefined,
  });

  return { manifest, hints, previewEntries: [{ path: "SKILL.md", content: text }] };
}

/** Wrap a single SKILL.md into a minimal zip so the upload API stays unchanged. */
async function wrapSkillMdAsZip(file: File): Promise<File> {
  const text = await file.text();
  const inner: Record<string, Uint8Array> = {
    "SKILL.md": new TextEncoder().encode(text),
  };
  const zipped = zipSync(inner);
  const zipName = file.name.replace(/\.(md|markdown)$/i, "") + ".zip";
  return new File([zipped.buffer as ArrayBuffer], zipName, { type: "application/zip" });
}

// ─── Zip deep analysis ────────────────────────────────────────────────────────

async function analyzeZipContents(file: File): Promise<ZipAnalysis | null> {
  const buf = await file.arrayBuffer();
  let zipFiles: Record<string, Uint8Array>;
  try { zipFiles = unzipSync(new Uint8Array(buf)); }
  catch { return null; }

  const hints: string[] = [];

  // Collect text of key files (case-insensitive lookup) + preview entries
  const text: Record<string, string> = {};
  const allRoles: FileRole[] = [];
  let hasManifest = false;
  const previewEntries: PreviewEntry[] = [];

  for (const [path, data] of Object.entries(zipFiles)) {
    if (path.startsWith("__MACOSX") || path.endsWith("/") || data.length === 0) continue;
    if (LICENSE_FILES_LC.has((path.split("/").pop() ?? "").toLowerCase())) continue;

    const role = classifyFile(path);
    allRoles.push(role);
    if (role === "config" && path.toLowerCase().endsWith("manifest.json")) hasManifest = true;
    if (role === "config" && (path.toLowerCase().endsWith(".yaml") || path.toLowerCase().endsWith(".yml"))) hasManifest = true;

    const name = path.split("/").pop()?.toLowerCase() ?? "";
    if (["manifest.json", "decision-dependency.yaml", "decision-dependency.yml",
         "skill.md", "readme.md", "marketplace.json"].includes(name)) {
      try { text[name] = new TextDecoder().decode(data); } catch {}
    }

    // Preview: collect readable text files (≤ 100 KB)
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    if (TEXT_PREVIEW_EXTS.has(ext) && data.length <= 100_000) {
      try { previewEntries.push({ path, content: new TextDecoder().decode(data) }); }
      catch { previewEntries.push({ path }); }
    } else {
      previewEntries.push({ path }); // binary or too large — listed but no content
    }
  }

  const { level: maturity, reason: maturityReason } = computeMaturity(allRoles, hasManifest);
  hints.push(`Maturity ${maturity}: ${maturityReason}`);

  // Build raw manifest in priority order
  let raw: Record<string, unknown> | null = null;
  let sourceHint = "";

  if (text["manifest.json"]) {
    try { raw = JSON.parse(text["manifest.json"]); sourceHint = "manifest.json"; } catch {}
  }
  if (!raw && (text["decision-dependency.yaml"] || text["decision-dependency.yml"])) {
    try {
      raw = yamlLoad(text["decision-dependency.yaml"] ?? text["decision-dependency.yml"]!) as Record<string, unknown>;
      sourceHint = "decision-dependency.yaml";
    } catch {}
  }
  if (!raw && text["marketplace.json"]) {
    try { raw = JSON.parse(text["marketplace.json"]); sourceHint = "marketplace.json"; } catch {}
  }
  if (!raw && text["skill.md"]) {
    const fm = extractFrontmatter(text["skill.md"]);
    if (fm) {
      raw = fm; sourceHint = "SKILL.md frontmatter";
      // If frontmatter lacks name/id, try the first # heading in the body
      if (!raw.name && !raw.id) {
        const heading = stripFrontmatter(text["skill.md"]).match(/^#\s+(.+)/m)?.[1]?.trim();
        if (heading) raw = { ...raw, name: heading };
      }
    }
  }
  if (!raw && text["readme.md"]) {
    const titleMatch = text["readme.md"].match(/^#\s+(.+)/m);
    const title = titleMatch?.[1]?.trim();
    if (title) { raw = { name: title }; sourceHint = "README.md title"; }
  }

  if (!raw) {
    const zipName = file.name.replace(/\.zip$/i, "");
    raw = { name: zipName };
    sourceHint = "zip filename";
  }

  hints.push(`Metadata from: ${sourceHint}`);

  // Attempt to fill description if missing
  let descHint = "";
  let extractedDesc = "";

  if (!raw.description || raw.description === "") {
    // 1. SKILL.md body (first paragraph after frontmatter)
    if (text["skill.md"]) {
      const body = stripFrontmatter(text["skill.md"]);
      extractedDesc = extractBodyDescription(body);
      if (extractedDesc) descHint = "description from SKILL.md body";
    }
    // 2. README.md first paragraph
    if (!extractedDesc && text["readme.md"]) {
      const body = stripFrontmatter(text["readme.md"]);
      extractedDesc = extractBodyDescription(body);
      if (extractedDesc) descHint = "description from README.md";
    }
    if (descHint) hints.push(descHint);
  }

  const fallbackName = file.name.replace(/\.zip$/i, "");
  const manifest = normalizeManifest(raw, fallbackName, {
    maturity,
    description: extractedDesc || undefined,
  });

  return { manifest, hints, previewEntries };
}

/** License-related file basenames to always exclude from zips and previews. */
const LICENSE_FILES_LC = new Set([
  "license", "license.txt", "license.md",
  "licence", "licence.txt", "licence.md",
  "copying", "copying.txt", "copying.md",
  "notice", "notice.txt",
]);

/** Safely decode binary Uint8Array as UTF-8 text. Returns undefined on error. */
function decodeText(data: Uint8Array): string | undefined {
  try { return new TextDecoder().decode(data); } catch { return undefined; }
}

// ─── GitHub deep analysis ─────────────────────────────────────────────────────

interface GitHubFile { path: string; type: string; download_url: string | null }

/** A fully-downloaded file entry from GitHub (binary-safe). */
interface FullFileEntry {
  path: string;       // relative path (subpath prefix stripped)
  data: Uint8Array;
  isText: boolean;
}

const KEY_FILES_LC = [
  "manifest.json", "decision-dependency.yaml", "decision-dependency.yml",
  "skill.md", "readme.md", "marketplace.json",
];

/** Maximum files to download from GitHub in one import. */
const MAX_GITHUB_FILES = 200;

async function analyzeGitHubRepo(rawUrl: string): Promise<{
  manifest: Record<string, unknown>;
  files: Record<string, string>;
  allFiles: FullFileEntry[];
  hints: string[];
  tree: GitHubFile[];
}> {
  const urlMatch = rawUrl.replace(/^https?:\/\//, "").match(
    /^github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/
  );
  if (!urlMatch) throw new Error("Invalid GitHub URL — expected github.com/owner/repo[/tree/branch/path]");
  const [, owner, repo, branch = "main", subpath = ""] = urlMatch;

  let treeData: { tree: GitHubFile[] } | null = null;
  for (const br of [branch, branch === "main" ? "master" : null].filter(Boolean)) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${br}?recursive=1`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (res.ok) { treeData = await res.json() as { tree: GitHubFile[] }; break; }
  }
  if (!treeData) throw new Error(`GitHub API error — repo not found or branch '${branch}' doesn't exist`);

  const prefix = subpath ? subpath.replace(/\/$/, "") + "/" : "";
  const relevant = treeData.tree.filter(f => f.type === "blob" && f.path.startsWith(prefix));

  // Download ALL files in scope (capped), collecting binary data + text for key files.
  // Note: GitHub Trees API does NOT include download_url — we construct the raw URL ourselves.
  const exceeded = relevant.length > MAX_GITHUB_FILES;
  const toDownload = relevant.slice(0, MAX_GITHUB_FILES);

  const downloaded: Record<string, string> = {};  // lowercase key → text (key files only)
  const allFilesResult: FullFileEntry[] = [];
  let totalBytes = 0;

  await Promise.all(
    toDownload.map(async f => {
      try {
        const rawFileUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`;
        const res = await fetch(rawFileUrl);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const data = new Uint8Array(buf);
        totalBytes += data.length;
        const relPath = prefix ? f.path.slice(prefix.length) : f.path;
        const baseName = (f.path.split("/").pop() ?? "").toLowerCase();
        if (LICENSE_FILES_LC.has(baseName)) return;  // skip license files
        const ext = (baseName.split(".").pop() ?? "").toLowerCase();
        const isText = TEXT_PREVIEW_EXTS.has(ext);
        allFilesResult.push({ path: relPath, data, isText });
        if (KEY_FILES_LC.includes(baseName)) {
          try { downloaded[baseName] = new TextDecoder().decode(data); } catch {}
        }
      } catch {}
    })
  );

  // Classify all repo files for maturity
  const allRoles = relevant.map(f => classifyFile(f.path));
  const hasManifest = relevant.some(f => {
    const n = f.path.split("/").pop()?.toLowerCase() ?? "";
    return n === "manifest.json" || n === "decision-dependency.yaml" || n === "decision-dependency.yml";
  });
  const { level: maturity, reason: maturityReason } = computeMaturity(allRoles, hasManifest);

  const hints: string[] = [
    `Maturity ${maturity}: ${maturityReason}`,
    `${allFilesResult.length} file${allFilesResult.length !== 1 ? "s" : ""} downloaded (${(totalBytes / 1024).toFixed(1)} KB)`,
  ];
  if (subpath) hints.push(`Folder: ${subpath}`);
  if (exceeded) hints.push(`Capped at ${MAX_GITHUB_FILES} of ${relevant.length} files`);

  // Build raw manifest
  let raw: Record<string, unknown> | null = null;
  let sourceHint = "";

  for (const [name, t] of Object.entries(downloaded)) {
    if (name.toLowerCase() === "manifest.json") {
      try { raw = JSON.parse(t); sourceHint = "manifest.json"; break; } catch {}
    }
  }
  if (!raw) {
    for (const [name, t] of Object.entries(downloaded)) {
      const lc = name.toLowerCase();
      if (lc === "decision-dependency.yaml" || lc === "decision-dependency.yml") {
        try { raw = yamlLoad(t) as Record<string, unknown>; sourceHint = "decision-dependency.yaml"; break; } catch {}
      }
    }
  }
  if (!raw) {
    for (const [name, t] of Object.entries(downloaded)) {
      if (name.toLowerCase() === "marketplace.json") {
        try { raw = JSON.parse(t); sourceHint = "marketplace.json"; break; } catch {}
      }
    }
  }
  if (!raw) {
    for (const [name, t] of Object.entries(downloaded)) {
      if (name.toLowerCase() === "skill.md") {
        const fm = extractFrontmatter(t);
        if (fm) {
          raw = fm; sourceHint = "SKILL.md frontmatter";
          // If frontmatter lacks name/id, try the first # heading in the body
          if (!raw.name && !raw.id) {
            const heading = stripFrontmatter(t).match(/^#\s+(.+)/m)?.[1]?.trim();
            if (heading) raw = { ...raw, name: heading };
          }
          break;
        }
      }
    }
  }
  if (!raw) {
    for (const [name, t] of Object.entries(downloaded)) {
      if (name.toLowerCase() === "readme.md") {
        const titleMatch = t.match(/^#\s+(.+)/m);
        const title = titleMatch?.[1]?.trim();
        if (title) { raw = { name: title }; sourceHint = "README.md title"; break; }
      }
    }
  }
  // Fallback: use the subfolder name (last segment of subpath) rather than the bare repo name
  const folderName = subpath ? (subpath.split("/").pop() ?? repo) : repo;
  if (!raw) { raw = { name: folderName }; sourceHint = subpath ? "folder name" : "repo name"; }

  hints.push(`Metadata from: ${sourceHint}`);

  // Fill description if empty
  let extractedDesc = "";
  let descHint = "";
  if (!raw.description || raw.description === "") {
    // SKILL.md body
    for (const [name, t] of Object.entries(downloaded)) {
      if (name.toLowerCase() === "skill.md") {
        const body = stripFrontmatter(t);
        extractedDesc = extractBodyDescription(body);
        if (extractedDesc) { descHint = "description from SKILL.md body"; break; }
      }
    }
    // README.md first paragraph
    if (!extractedDesc) {
      for (const [name, t] of Object.entries(downloaded)) {
        if (name.toLowerCase() === "readme.md") {
          const body = stripFrontmatter(t);
          extractedDesc = extractBodyDescription(body);
          if (extractedDesc) { descHint = "description from README.md"; break; }
        }
      }
    }
    if (descHint) hints.push(descHint);
  }

  // Infer type from structure
  const inferredType = (() => {
    const hasExe = allRoles.includes("executable");
    const hasKnowledge = allRoles.includes("knowledge_doc");
    if (hasExe && !hasKnowledge) return "connector";
    if (!hasExe && hasKnowledge) return "knowledge";
    return "skill";
  })();

  const manifest = normalizeManifest(raw, folderName, {
    maturity,
    description: extractedDesc || undefined,
    type: raw.type ? undefined : inferredType,
    publisher: raw.publisher ? undefined : owner,
  });

  return { manifest, files: downloaded, allFiles: allFilesResult, hints, tree: relevant };
}

async function buildZipFromFiles(files: Record<string, string>, prefix = ""): Promise<File> {
  const zipData: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    zipData[`${prefix}${name}`] = new TextEncoder().encode(content);
  }
  const zipped = zipSync(zipData);
  return new File([zipped.buffer as ArrayBuffer], "package.zip", { type: "application/zip" });
}

/** Build a zip from fully-downloaded GitHub files (binary-safe, license files excluded). */
function buildZipFromAllFiles(allFiles: FullFileEntry[], prefix = ""): File {
  const zipData: Record<string, Uint8Array> = {};
  for (const f of allFiles) {
    if (!f.path) continue;
    if (LICENSE_FILES_LC.has((f.path.split("/").pop() ?? "").toLowerCase())) continue;
    zipData[`${prefix}${f.path}`] = f.data;
  }
  const zipped = zipSync(zipData);
  return new File([zipped.buffer as ArrayBuffer], "package.zip", { type: "application/zip" });
}

// ─── Domain / tag suggestion data ────────────────────────────────────────────

const HIGH_FREQ_DOMAINS = [
  "robotics", "coding", "data-science", "devops", "nlp", "web",
  "ml", "security", "testing", "documentation", "productivity", "finance",
  "pcb", "electronics", "hardware", "embedded",
];

const HIGH_FREQ_TAGS = [
  "python", "typescript", "javascript", "ros2", "automation", "analysis",
  "debugging", "refactor", "documentation", "api", "cli", "testing",
  "llm", "workflow", "search", "github", "docker", "database",
];

// Maps keyword fragments → suggested domain
const KW_DOMAIN: [string[], string][] = [
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

// Maps keyword fragments → suggested tags
const KW_TAGS: [string[], string][] = [
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

function inferFromKeywords<T extends string>(
  text: string,
  map: [string[], T][],
): T[] {
  const lower = ` ${text.toLowerCase()} `;
  return map
    .filter(([kws]) => kws.some(k => lower.includes(k)))
    .map(([, v]) => v);
}

// ─── Word-level description extraction ───────────────────────────────────────

/** Exact word → tag (parsed directly from description tokens) */
const TERM_TAG: Record<string, string> = {
  // languages
  python: "python", py: "python",
  typescript: "typescript", ts: "typescript",
  javascript: "javascript", js: "javascript",
  rust: "rust", golang: "golang", java: "java",
  kotlin: "kotlin", ruby: "ruby", bash: "bash", shell: "bash",
  swift: "swift", cpp: "c++", "c#": "csharp",
  // robotics
  ros: "ros2", ros2: "ros2", gazebo: "ros2", rviz: "ros2",
  // ML/AI
  pytorch: "pytorch", tensorflow: "tensorflow", keras: "keras",
  sklearn: "sklearn", openai: "llm", langchain: "llm",
  llamaindex: "llm", embedding: "llm", transformer: "llm",
  // data
  pandas: "pandas", numpy: "numpy", polars: "polars",
  sql: "database", postgres: "database", mysql: "database",
  sqlite: "database", mongodb: "database", redis: "database",
  // devops
  docker: "docker", kubernetes: "kubernetes", k8s: "kubernetes",
  terraform: "terraform", ansible: "ansible",
  jenkins: "jenkins", gitlab: "github",
  // web
  fastapi: "api", flask: "api", django: "api",
  express: "api", graphql: "api", grpc: "api",
  react: "react", vue: "vue", angular: "angular",
  // tools/concepts
  pytest: "testing", jest: "testing",
  selenium: "testing", playwright: "testing",
  automation: "automation", workflow: "workflow",
  analytics: "analysis", visualization: "analysis",
  refactoring: "refactor", linting: "refactor",
  documentation: "documentation", cli: "cli",
  search: "search", retrieval: "search",
};

/** Exact word → domain */
const TERM_DOMAIN: Record<string, string> = {
  // robotics
  ros: "robotics", ros2: "robotics", gazebo: "robotics", rviz: "robotics",
  slam: "robotics", lidar: "robotics", sensor: "robotics",
  drone: "robotics", robot: "robotics", navigation: "robotics",
  // coding
  linter: "coding", debugger: "coding", compiler: "coding",
  refactor: "coding", ide: "coding",
  // data science
  pandas: "data-science", numpy: "data-science", polars: "data-science",
  analytics: "data-science", dataset: "data-science", csv: "data-science",
  dataframe: "data-science", statistics: "data-science",
  // devops
  docker: "devops", kubernetes: "devops", k8s: "devops",
  terraform: "devops", ansible: "devops", jenkins: "devops",
  deployment: "devops", infrastructure: "devops", pipeline: "devops",
  // nlp / ml
  llm: "nlp", gpt: "nlp", embedding: "nlp",
  tokenizer: "nlp", transformer: "nlp", bert: "nlp",
  pytorch: "ml", tensorflow: "ml", keras: "ml", sklearn: "ml",
  neural: "ml", training: "ml",
  // web
  fastapi: "web", flask: "web", django: "web",
  express: "web", react: "web", vue: "web",
  graphql: "web", grpc: "web",
  // security
  authentication: "security", encryption: "security",
  vulnerability: "security", oauth: "security", firewall: "security",
  // testing
  pytest: "testing", jest: "testing",
  selenium: "testing", playwright: "testing", coverage: "testing",
  // finance
  trading: "finance", stock: "finance", crypto: "finance",
  accounting: "finance", invoice: "finance",
  // productivity
  calendar: "productivity", scheduler: "productivity", reminder: "productivity",
  // documentation
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

/** Word-level extraction from description text */
function extractFromDesc(desc: string): { tags: string[]; domains: string[] } {
  const words = desc.toLowerCase().match(/[a-z][a-z0-9+#.-]*/g) ?? [];
  const seenTags = new Set<string>();
  const seenDomains = new Set<string>();
  const tags: string[] = [];
  const domains: string[] = [];
  for (const w of words) {
    const tag = TERM_TAG[w];
    if (tag && !seenTags.has(tag)) { seenTags.add(tag); tags.push(tag); }
    const domain = TERM_DOMAIN[w];
    if (domain && !seenDomains.has(domain)) { seenDomains.add(domain); domains.push(domain); }
  }
  return { tags, domains };
}

/** Deduplicated ordered list: inferred first (highlighted), then remaining high-freq */
function buildSuggestions(
  highFreq: string[],
  inferred: string[],
): { value: string; inferred: boolean }[] {
  const seen = new Set<string>();
  const result: { value: string; inferred: boolean }[] = [];
  for (const v of inferred) {
    if (!seen.has(v)) { seen.add(v); result.push({ value: v, inferred: true }); }
  }
  for (const v of highFreq) {
    if (!seen.has(v)) { seen.add(v); result.push({ value: v, inferred: false }); }
  }
  return result;
}

// ─── Suggestion chips component ───────────────────────────────────────────────

function SuggestionChips({
  suggestions, selected, onToggle,
}: {
  suggestions: { value: string; inferred: boolean }[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
      {suggestions.map(({ value, inferred }) => {
        const active = selected.includes(value);
        return (
          <button
            key={value}
            type="button"
            onClick={() => onToggle(value)}
            style={{
              fontSize: 9, padding: "2px 7px", borderRadius: 3, cursor: "pointer",
              border: `1px solid ${active ? "#4ec9b0" : inferred ? "#2a3a4a" : "#1e1e2e"}`,
              background: active ? "#0a2a2a" : inferred ? "#0d1a24" : "#111118",
              color: active ? "#4ec9b0" : inferred ? "#6ab0c8" : "#444",
              transition: "all 0.1s",
            }}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

// ─── Shared manifest form ─────────────────────────────────────────────────────

function ManifestForm({ manifest, onChange }: {
  manifest: Record<string, unknown>;
  onChange: (m: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...manifest, [k]: v });
  const setTagsFromRaw = (v: string) => onChange({ ...manifest, tags: v.split(",").map(t => t.trim()).filter(Boolean) });

  // Local state for raw tag input so Enter key can add a trailing comma
  const currentTagsArr = (manifest.tags as string[] ?? []);
  const [tagsRaw, setTagsRaw] = React.useState(() => currentTagsArr.join(", "));

  // Sync tagsRaw when tags change from outside (chip clicks, zip analysis)
  const tagsKey = JSON.stringify(currentTagsArr);
  React.useEffect(() => {
    const parsedFromRaw = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
    if (JSON.stringify(parsedFromRaw) !== tagsKey) {
      setTagsRaw(currentTagsArr.join(", "));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagsKey]);

  const inp: React.CSSProperties = {
    width: "100%", background: "#1a1a24", border: "1px solid #2a2a3a",
    borderRadius: 4, color: "#d4d4d4", padding: "6px 8px", fontSize: 11, outline: "none",
  };
  const lbl: React.CSSProperties = { fontSize: 10, color: "#555", display: "block", marginBottom: 3 };

  // Build keyword context from name + id + description
  const desc = String(manifest.description ?? "");
  const kwContext = [String(manifest.name ?? ""), String(manifest.id ?? ""), desc].join(" ");
  const fromDesc = extractFromDesc(desc);

  // Domain suggestions: desc word-level first, then substring map fallback, deduped
  const inferredDomains = [
    ...fromDesc.domains,
    ...inferFromKeywords(kwContext, KW_DOMAIN).filter(d => !fromDesc.domains.includes(d)),
  ];
  const domainSuggestions = buildSuggestions(HIGH_FREQ_DOMAINS, inferredDomains);
  const currentDomain = String(manifest.domain ?? "");
  const toggleDomain = (v: string) => set("domain", currentDomain === v ? "" : v);

  // Tag suggestions: desc word-level first, then substring map fallback, deduped
  const inferredTags = [
    ...fromDesc.tags,
    ...inferFromKeywords(kwContext, KW_TAGS).filter(t => !fromDesc.tags.includes(t)),
  ];
  const tagSuggestions = buildSuggestions(HIGH_FREQ_TAGS, inferredTags);
  const toggleTag = (v: string) => {
    const next = currentTagsArr.includes(v)
      ? currentTagsArr.filter(t => t !== v)
      : [...currentTagsArr, v];
    onChange({ ...manifest, tags: next });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div>
        <label style={lbl}>DD ID (stable slug)</label>
        <input value={String(manifest.id ?? "")} onChange={e => set("id", e.target.value)} style={inp} />
      </div>
      <div>
        <label style={lbl}>Display Name</label>
        <input value={String(manifest.name ?? "")} onChange={e => set("name", e.target.value)} style={inp} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={lbl}>Description</label>
        <textarea value={String(manifest.description ?? "")} onChange={e => set("description", e.target.value)}
          rows={3} placeholder="What does this skill/package do? Auto-extracted if blank."
          style={{ ...inp, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
      </div>
      <div>
        <label style={lbl}>Version</label>
        <input value={String(manifest.version ?? "1.0.0")} onChange={e => set("version", e.target.value)} style={inp} />
      </div>
      <div>
        <label style={lbl}>Publisher</label>
        <input value={String(manifest.publisher ?? "")} onChange={e => set("publisher", e.target.value)} style={inp} />
      </div>
      <div>
        <label style={lbl}>Type</label>
        <select value={String(manifest.type ?? "skill")} onChange={e => set("type", e.target.value)} style={inp}>
          {["skill", "knowledge", "connector", "memory"].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Maturity</label>
        <select value={String(manifest.maturity ?? "L2")} onChange={e => set("maturity", e.target.value)} style={inp}>
          {[
            ["L1", "L1 — no structure"],
            ["L2", "L2 — SKILL.md or knowledge docs"],
            ["L3", "L3 — SKILL.md + scripts + docs"],
            ["L4", "L4 — manifest + tests"],
          ].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Trust Level</label>
        <select value={String(manifest.trust ?? "untrusted")} onChange={e => set("trust", e.target.value)} style={inp}>
          {["untrusted", "reviewed", "org-approved"].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Visibility</label>
        <select value={String(manifest.visibility ?? "public")} onChange={e => set("visibility", e.target.value)} style={inp}>
          {["public", "private", "org"].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Domain (optional)</label>
        <input value={currentDomain} onChange={e => set("domain", e.target.value)}
          placeholder="e.g. robotics" style={inp} />
        <SuggestionChips
          suggestions={domainSuggestions}
          selected={currentDomain ? [currentDomain] : []}
          onToggle={toggleDomain}
        />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={lbl}>Tags (comma-separated, Enter to confirm)</label>
        <input
          value={tagsRaw}
          onChange={e => {
            setTagsRaw(e.target.value);
            setTagsFromRaw(e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = tagsRaw.trimEnd();
              if (v && !v.endsWith(",")) {
                const newRaw = v + ", ";
                setTagsRaw(newRaw);
                setTagsFromRaw(newRaw);
              }
            }
          }}
          placeholder="e.g. python, automation"
          style={inp}
        />
        <SuggestionChips
          suggestions={tagSuggestions}
          selected={currentTagsArr}
          onToggle={toggleTag}
        />
      </div>
    </div>
  );
}

// ─── Upload Tab ───────────────────────────────────────────────────────────────

function UploadTab({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [manifest, setManifest] = useState<Record<string, unknown>>({ ...EMPTY_MANIFEST });
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [skillmdFile, setSkillmdFile] = useState<File | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [forcePublish, setForcePublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<PreviewEntry[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const skillmdRef = useRef<HTMLInputElement>(null);

  const handleZipFile = useCallback(async (file: File) => {
    setZipFile(file); setSourceLabel(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    setHints([]); setAnalyzing(true);
    try {
      const result = await analyzeZipContents(file);
      if (result) {
        setManifest(m => ({
          ...m, ...result.manifest,
          id:          String(result.manifest.id || m.id || ""),
          name:        String(result.manifest.name || m.name || ""),
          description: String(result.manifest.description || m.description || ""),
        }));
        setHints(result.hints);
        setPreviewEntries(result.previewEntries);
      }
    } catch {}
    setAnalyzing(false);
  }, []);

  const handleSkillMdDrop = useCallback(async (file: File) => {
    setAnalyzing(true); setHints([]);
    try {
      const result = await analyzeSkillMdFile(file);
      setManifest(m => ({
        ...m, ...result.manifest,
        id:          String(result.manifest.id || m.id || ""),
        name:        String(result.manifest.name || m.name || ""),
        description: String(result.manifest.description || m.description || ""),
      }));
      setHints(result.hints);
      setPreviewEntries(result.previewEntries);
      const wrapped = await wrapSkillMdAsZip(file);
      setZipFile(wrapped);
      setSkillmdFile(file);
      setSourceLabel(`${file.name} → auto-packaged`);
    } catch {}
    setAnalyzing(false);
  }, []);

  const handleFileInput = useCallback((file: File) => {
    const lc = file.name.toLowerCase();
    if (lc.endsWith(".zip")) handleZipFile(file);
    else if (lc.endsWith(".md") || lc.endsWith(".markdown")) handleSkillMdDrop(file);
  }, [handleZipFile, handleSkillMdDrop]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileInput(file);
  }, [handleFileInput]);

  const handlePasteSkillMd = useCallback(async () => {
    setPasting(true); setErr("");
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setErr("Clipboard is empty"); setPasting(false); return; }
      const file = new File([text], "SKILL.md", { type: "text/markdown" });
      await handleSkillMdDrop(file);
    } catch {
      setErr("Cannot read clipboard — please allow clipboard access and try again");
    }
    setPasting(false);
  }, [handleSkillMdDrop]);

  const handleSubmit = async () => {
    setErr("");
    if (!manifest.id || !manifest.name || !manifest.version) { setErr("id, name, and version are required"); return; }
    if (!zipFile) { setErr("Drop a package.zip or SKILL.md to continue"); return; }
    setLoading(true);
    try {
      await publishMetadata(manifest, forcePublish);
      const up = await uploadPackage(String(manifest.id), String(manifest.version), zipFile, skillmdFile ?? undefined);
      onSuccess(
        `Published ${manifest.id}@${manifest.version} — ${(up.zip_size_bytes / 1024).toFixed(1)} KB` +
        (forcePublish ? "" : " (pending review)")
      );
      setManifest({ ...EMPTY_MANIFEST }); setZipFile(null); setSkillmdFile(null);
      setHints([]); setSourceLabel(null); setPreviewEntries([]);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };

  // ── form column (always visible) ──────────────────────────────────────────
  const formCol = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "0 0 560px", minWidth: 0 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#4ec9b0" : sourceLabel ? "#2a3a2a" : "#2a2a3a"}`,
          borderRadius: 6, padding: "18px 16px", textAlign: "center",
          cursor: "pointer", background: dragOver ? "#0a2a2022" : "transparent",
          transition: "all 0.15s",
        }}
      >
        {analyzing ? (
          <div style={{ color: "#4ec9b0", fontSize: 11 }}>Analyzing…</div>
        ) : sourceLabel ? (
          <div style={{ color: "#4ec9b0", fontSize: 12 }}>
            {sourceLabel}
            <span style={{ color: "#3a3a5a", fontSize: 10, marginLeft: 8 }}>click to replace</span>
          </div>
        ) : (
          <div style={{ color: "#444", fontSize: 11 }}>
            Drop <strong style={{ color: "#666" }}>package.zip</strong> or <strong style={{ color: "#666" }}>SKILL.md</strong> here
            <div style={{ fontSize: 10, color: "#333", marginTop: 4 }}>
              zip: reads manifest.json · decision-dependency.yaml · SKILL.md · README.md<br />
              SKILL.md: reads frontmatter + body description, auto-packages
            </div>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".zip,.md,.markdown" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileInput(f); e.target.value = ""; }} />

      {hints.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {hints.map((h, i) => (
            <span key={i} style={{
              fontSize: 9, padding: "2px 7px", borderRadius: 3,
              background: "#0a1a0a", border: "1px solid #1a2a1a", color: "#4ec9b088",
            }}>{h}</span>
          ))}
        </div>
      )}

      <Card>
        <ManifestForm manifest={manifest} onChange={setManifest} />
      </Card>

      {zipFile && !sourceLabel?.includes("auto-packaged") && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={() => skillmdRef.current?.click()}>
            {skillmdFile ? `SKILL.md override: ${skillmdFile.name}` : "Override SKILL.md separately (optional)"}
          </Btn>
          {skillmdFile && (
            <button onClick={() => setSkillmdFile(null)}
              style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 14 }}>×</button>
          )}
          <span style={{ fontSize: 10, color: "#333" }}>overrides the SKILL.md inside the zip</span>
        </div>
      )}
      <input ref={skillmdRef} type="file" accept=".md" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) setSkillmdFile(f); }} />

      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={forcePublish} onChange={e => setForcePublish(e.target.checked)}
          style={{ accentColor: "#4ec9b0" }} />
        <span style={{ fontSize: 11, color: "#ccc" }}>Force publish (skip pending review)</span>
      </label>

      {err && (
        <div style={{ padding: "7px 10px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555" }}>
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn variant="ghost" size="sm" onClick={handlePasteSkillMd} disabled={pasting || analyzing}>
          {pasting ? "Parsing…" : "⎘ Paste SKILL.md"}
        </Btn>
        <Btn onClick={handleSubmit} disabled={loading || !zipFile}>
          {loading ? "Uploading…" : "Publish Package"}
        </Btn>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      {formCol}
      {previewEntries.length > 0 && (
        <div style={{ flex: "1 1 380px", minWidth: 300, position: "sticky", top: 24 }}>
          <PreviewPanel entries={previewEntries} />
        </div>
      )}
    </div>
  );
}

// ─── GitHub Tab ───────────────────────────────────────────────────────────────

function GitHubTab({ onSuccess }: { onSuccess: (msg: string) => void }) {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [editManifest, setEditManifest] = useState<Record<string, unknown> | null>(null);
  const [detectedFiles, setDetectedFiles] = useState<Record<string, string>>({});
  const [allFiles, setAllFiles] = useState<FullFileEntry[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [forcePublish, setForcePublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<PreviewEntry[]>([]);

  const handleAnalyze = async () => {
    setErr(""); setEditManifest(null); setHints([]); setPreviewEntries([]); setAllFiles([]);

    // If input is empty, auto-paste from clipboard
    let targetUrl = url.trim();
    if (!targetUrl) {
      try {
        const clip = (await navigator.clipboard.readText()).trim();
        if (clip) { targetUrl = clip; setUrl(clip); }
      } catch {}
    }
    if (!targetUrl) { setErr("Enter a GitHub URL (or copy one to clipboard and click Analyze)"); return; }

    setAnalyzing(true);
    try {
      const { manifest, files, allFiles: af, hints: h } = await analyzeGitHubRepo(targetUrl);
      setEditManifest(manifest);
      setDetectedFiles(files);
      setAllFiles(af);
      setHints(h);

      // Build preview entries — text files get decoded content, binary files get path-only
      const entries: PreviewEntry[] = af.map(f => ({
        path: f.path,
        content: (f.isText && f.data.length <= 100_000) ? decodeText(f.data) : undefined,
      }));
      setPreviewEntries(entries);
    } catch (e: any) { setErr(e.message); }
    finally { setAnalyzing(false); }
  };

  const handlePublish = async () => {
    if (!editManifest) return;
    setErr(""); setPublishing(true);
    try {
      const m = editManifest;
      if (!m.id || !m.version) throw new Error("Manifest is missing id or version");
      // Use full file set when available (includes binaries + all subfolders)
      const zipFile = allFiles.length > 0
        ? buildZipFromAllFiles(allFiles, `${m.id}_v${m.version}/`)
        : await buildZipFromFiles(detectedFiles, `${m.id}_v${m.version}/`);
      await publishMetadata(m, forcePublish);
      // SKILL.md: find from full files first, then fallback to key-file map
      const skillMdEntry = allFiles.find(f => f.path.toLowerCase() === "skill.md");
      const skillmdContent = skillMdEntry
        ? (() => { try { return new TextDecoder().decode(skillMdEntry.data); } catch { return null; } })()
        : (detectedFiles["skill.md"] ?? null);
      const skillmdFile = skillmdContent
        ? new File([skillmdContent], "SKILL.md", { type: "text/markdown" })
        : undefined;
      const up = await uploadPackage(String(m.id), String(m.version), zipFile, skillmdFile);
      onSuccess(
        `Published ${m.id}@${m.version} from GitHub — ${(up.zip_size_bytes / 1024).toFixed(1)} KB` +
        (forcePublish ? "" : " (pending review)")
      );
      setUrl(""); setEditManifest(null); setDetectedFiles({}); setAllFiles([]); setHints([]); setPreviewEntries([]);
    } catch (e: any) { setErr(e.message); }
    finally { setPublishing(false); }
  };

  // ── form column ────────────────────────────────────────────────────────────
  const formCol = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "0 0 560px", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAnalyze()}
          placeholder="https://github.com/owner/repo  or  .../tree/branch/subpath"
          style={{ flex: 1, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 4, color: "#d4d4d4", padding: "8px 10px", fontSize: 12, outline: "none" }}
        />
        <Btn onClick={handleAnalyze} disabled={analyzing}>{analyzing ? "Analyzing…" : "Analyze"}</Btn>
      </div>
      <div style={{ fontSize: 10, color: "#333" }}>
        Downloads <strong style={{ color: "#555" }}>all files</strong> under the given path (up to {MAX_GITHUB_FILES}).
        Subfolder URLs like <code style={{ color: "#444" }}>.../tree/main/skills/docx</code> scope the import to that folder.
        Infers metadata from <code style={{ color: "#444" }}>manifest.json</code> · <code style={{ color: "#444" }}>SKILL.md</code> · <code style={{ color: "#444" }}>README.md</code>. Public repos only.
      </div>

      {err && (
        <div style={{ padding: "7px 10px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555" }}>
          {err}
        </div>
      )}

      {editManifest && (
        <Card>
          {hints.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: "#4ec9b0", marginRight: 4, alignSelf: "center" }}>Auto-detected:</span>
              {hints.map((h, i) => (
                <span key={i} style={{
                  fontSize: 9, padding: "2px 7px", borderRadius: 3,
                  background: "#0a1a0a", border: "1px solid #1a2a1a", color: "#4ec9b088",
                }}>{h}</span>
              ))}
            </div>
          )}
          <ManifestForm manifest={editManifest} onChange={setEditManifest} />
          <div style={{ borderTop: "1px solid #1a1a2a", marginTop: 14, paddingTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, color: "#ccc" }}>
              <input type="checkbox" checked={forcePublish} onChange={e => setForcePublish(e.target.checked)}
                style={{ accentColor: "#4ec9b0" }} />
              Force publish (skip review)
            </label>
            <Btn onClick={handlePublish} disabled={publishing}>
              {publishing ? "Publishing…" : "Publish to Registry"}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => {
              navigator.clipboard.writeText(generateSkillMd(editManifest!)).then(() => {
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              });
            }}>
              {copied ? "Copied!" : "Copy SKILL.md"}
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      {formCol}
      {previewEntries.length > 0 && (
        <div style={{ flex: "1 1 380px", minWidth: 300, position: "sticky", top: 24 }}>
          <PreviewPanel entries={previewEntries} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const [tab, setTab] = useState<"zip" | "github">("zip");
  const [success, setSuccess] = useState("");

  return (
    <div style={{ padding: 24 }}>
      <SectionTitle>Publish Package</SectionTitle>

      {success && (
        <div style={{ padding: "8px 12px", background: "#0a2a20", border: "1px solid #4ec9b044", borderRadius: 4, fontSize: 11, color: "#4ec9b0", marginBottom: 14 }}>
          ✓ {success}
        </div>
      )}

      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1a1a2a", marginBottom: 18 }}>
        {(["zip", "github"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "8px 18px", fontSize: 11,
            color: tab === t ? "#4ec9b0" : "#444",
            borderBottom: tab === t ? "2px solid #4ec9b0" : "2px solid transparent",
            fontWeight: tab === t ? 700 : 400,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>
            {t === "zip" ? "⬆ Upload Zip" : "⬡ From GitHub"}
          </button>
        ))}
      </div>

      {tab === "zip" ? (
        <UploadTab onSuccess={msg => setSuccess(msg)} />
      ) : (
        <GitHubTab onSuccess={msg => setSuccess(msg)} />
      )}
    </div>
  );
}
