/**
 * github_import.ts — GitHub repository inspection + N-candidate normalization.
 *
 * Fetches a repo's file tree via the GitHub API, classifies files by role,
 * identifies candidate DecisionDependency boundaries, and returns a preview
 * without downloading or executing any code.
 *
 * POST /api/registry/import/github  → GitHubImportPreview (N candidates)
 * POST /api/registry/import/github/confirm → saves selected + overridden candidates
 */

import { createHash } from "crypto";
import type {
  DecisionDependency,
  GitHubSource,
  MaturityLevel,
  ProvenanceRecord,
} from "../types.ts";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface GitHubImportRequest {
  repoUrl: string;
  ref?: string;         // default: "main"
  token?: string;       // for private repos (unauthenticated = 60 req/hr)
}

export interface FileClassification {
  path: string;
  role: FileRole;
}

export type FileRole =
  | "entry_doc"         // SKILL.md or README.md
  | "knowledge_doc"     // other .md files
  | "executable_script" // .py, .ts, .sh
  | "reference"         // in references/ dir
  | "asset"             // in assets/ or templates/
  | "test"              // in tests/ or evals/
  | "config_file"       // .yaml, .toml, package.json
  | "other";

export interface GitHubImportCandidate {
  draft: DecisionDependency;              // stable object, trust always "untrusted"
  classification: FileClassification[];   // files belonging to this candidate
  maturity: MaturityLevel;
  confidence: number;                     // 0–1
  explanation: string;
  recommendations: string[];
  missingFields: string[];
}

export interface GitHubImportPreview {
  candidates: GitHubImportCandidate[];
  repoMeta: {
    url: string;
    ref: string;
    commitSha?: string;
    importHash: string;
  };
}

export interface GitHubConfirmRequest {
  importHash: string;
  selectedCandidates: number[];                        // indices into candidates[]
  overrides: Partial<DecisionDependency>[];            // per-candidate overrides (same indices)
}

// ─── GitHub API Types ─────────────────────────────────────────────────────────

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
}

// ─── Main Entry: Preview ─────────────────────────────────────────────────────

export async function previewGitHubImport(req: GitHubImportRequest): Promise<GitHubImportPreview> {
  const { repoUrl, ref = "main", token } = req;

  const { owner, repo } = parseGitHubUrl(repoUrl);
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "MindAct-Registry/1.0",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  // Fetch commit SHA for the ref
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${ref}`,
    { headers }
  );
  let commitSha: string | undefined;
  if (refRes.ok) {
    const refData = await refRes.json() as { object?: { sha?: string } };
    commitSha = refData.object?.sha;
  }

  // Fetch recursive tree
  const treeRef = commitSha ?? ref;
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeRef}?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) {
    throw new Error(`GitHub tree fetch failed: ${treeRes.status} ${await treeRes.text()}`);
  }
  const treeData = await treeRes.json() as GitHubTreeResponse;

  const importHash = createHash("sha256")
    .update(`${repoUrl}:${ref}:${commitSha ?? ""}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);

  const files = treeData.tree.filter(t => t.type === "blob");
  const candidates = buildCandidates(owner, repo, ref, commitSha, importHash, files, repoUrl);

  return {
    candidates,
    repoMeta: { url: repoUrl, ref, commitSha, importHash },
  };
}

// ─── Candidate Boundary Detection ─────────────────────────────────────────────

function buildCandidates(
  owner: string,
  repo: string,
  ref: string,
  commitSha: string | undefined,
  importHash: string,
  files: GitHubTreeItem[],
  repoUrl: string,
): GitHubImportCandidate[] {
  const allClassified = files.map(f => ({ path: f.path, role: classifyFile(f.path) }));

  // Find candidate boundaries:
  // 1. Each directory containing a SKILL.md → dedicated candidate
  // 2. Top-level SKILL.md → root candidate
  // 3. If no SKILL.md anywhere → entire repo as one candidate
  const skillMdPaths = allClassified.filter(f => f.role === "entry_doc" && f.path.endsWith("SKILL.md"));

  const boundaries: string[] = skillMdPaths.length > 0
    ? skillMdPaths.map(f => f.path.includes("/") ? f.path.substring(0, f.path.lastIndexOf("/")) : "")
    : [""]; // root

  const candidates: GitHubImportCandidate[] = [];

  for (const boundary of boundaries) {
    const prefix = boundary ? boundary + "/" : "";
    const relevant = allClassified.filter(f =>
      boundary === "" ? !f.path.includes("/") || true : f.path.startsWith(prefix)
    );

    // For the root boundary with multiple boundaries, only take root-level files
    const scopedFiles = boundary === "" && boundaries.length > 1
      ? allClassified.filter(f => !f.path.includes("/"))
      : relevant;

    if (scopedFiles.length === 0) continue;

    const maturity = computeMaturity(scopedFiles);
    const candidateId = boundary
      ? `${owner}-${repo}-${boundary.replace(/\//g, "-")}`.toLowerCase()
      : `${owner}-${repo}`.toLowerCase();

    const inferredName = boundary
      ? boundary.split("/").pop() ?? repo
      : repo;

    const source: GitHubSource = {
      type: "github",
      repoUrl,
      ref,
      commitSha,
      importedAt: new Date().toISOString(),
    };

    const provenance: ProvenanceRecord = {
      importedFrom: source,
      importHash,
      originalFiles: scopedFiles.map(f => f.path),
      normalizedAt: new Date().toISOString(),
    };

    const draft: DecisionDependency = {
      id: candidateId,
      version: "0.0.0",
      type: inferType(scopedFiles),
      modes: [],
      name: toTitleCase(inferredName),
      description: `Imported from ${repoUrl}${boundary ? ` (${boundary})` : ""}`,
      tags: [],
      domain: "",
      source,
      publisher: owner,
      visibility: "private",
      trust: "untrusted",
      maturity,
      provenance,
    };

    const recommendations = buildRecommendations(scopedFiles, draft);
    const missingFields = findMissingFields(draft);

    candidates.push({
      draft,
      classification: scopedFiles,
      maturity,
      confidence: computeConfidence(scopedFiles),
      explanation: buildExplanation(scopedFiles, maturity),
      recommendations,
      missingFields,
    });
  }

  return candidates;
}

// ─── File Classification ──────────────────────────────────────────────────────

function classifyFile(path: string): FileRole {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  const dir = path.includes("/") ? path.split("/").slice(-2)[0]?.toLowerCase() : "";

  if (name === "skill.md" || name === "readme.md") return "entry_doc";
  if (name.endsWith(".md")) {
    if (dir === "references") return "reference";
    return "knowledge_doc";
  }
  if (name.endsWith(".py") || name.endsWith(".ts") || name.endsWith(".sh")) return "executable_script";
  if (dir === "references") return "reference";
  if (dir === "assets" || dir === "templates") return "asset";
  if (dir === "tests" || dir === "evals" || name.startsWith("test_") || name.includes(".test.")) return "test";
  if (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".toml") || name === "package.json") return "config_file";
  return "other";
}

// ─── Maturity Scoring ────────────────────────────────────────────────────────

function computeMaturity(files: FileClassification[]): MaturityLevel {
  const roles = new Set(files.map(f => f.role));
  const hasSkillMd = files.some(f => f.role === "entry_doc" && f.path.endsWith("SKILL.md"));
  const hasManifest = files.some(f => f.role === "config_file" && f.path.endsWith("decision-dependency.yaml"));
  const hasScripts = roles.has("executable_script");
  const hasKnowledge = roles.has("knowledge_doc");
  const hasTests = roles.has("test");

  if (hasManifest && hasTests) return "L3";
  if (hasSkillMd && hasScripts && hasKnowledge) return "L2";
  if (hasSkillMd || hasKnowledge) return "L1";
  return "L0";
}

function computeConfidence(files: FileClassification[]): number {
  let score = 0;
  const roles = new Set(files.map(f => f.role));
  if (files.some(f => f.role === "entry_doc" && f.path.endsWith("SKILL.md"))) score += 0.4;
  if (roles.has("knowledge_doc")) score += 0.2;
  if (roles.has("executable_script")) score += 0.2;
  if (roles.has("test")) score += 0.1;
  if (files.some(f => f.path.endsWith("decision-dependency.yaml"))) score += 0.1;
  return Math.min(1, score);
}

function inferType(files: FileClassification[]): DecisionDependency["type"] {
  const roles = new Set(files.map(f => f.role));
  const hasSkillMd = files.some(f => f.role === "entry_doc" && f.path.endsWith("SKILL.md"));
  if (hasSkillMd) return "skill";
  if (roles.has("executable_script") && !roles.has("knowledge_doc")) return "connector";
  return "knowledge";
}

// ─── Recommendation & Explanation Builders ────────────────────────────────────

function buildExplanation(files: FileClassification[], maturity: MaturityLevel): string {
  const counts: Partial<Record<FileRole, number>> = {};
  for (const f of files) counts[f.role] = (counts[f.role] ?? 0) + 1;

  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([role, n]) => `${n} ${role.replace(/_/g, " ")}${n > 1 ? "s" : ""}`)
    .join(", ");

  return `Detected ${files.length} file(s) (${parts}). Estimated maturity: ${maturity}.`;
}

function buildRecommendations(files: FileClassification[], draft: DecisionDependency): string[] {
  const recs: string[] = [];
  const hasSkillMd = files.some(f => f.role === "entry_doc" && f.path.endsWith("SKILL.md"));
  const hasManifest = files.some(f => f.path.endsWith("decision-dependency.yaml"));

  if (!hasSkillMd) recs.push("Add a SKILL.md with name, description frontmatter to improve matching.");
  if (!hasManifest) recs.push("Add decision-dependency.yaml to formalize the manifest.");
  if (!draft.domain) recs.push("Set a domain (e.g. 'robotics', 'computer-vision') for better discovery.");
  if (!draft.tags?.length) recs.push("Add relevant tags to improve searchability.");
  if (files.some(f => f.role === "executable_script")) {
    recs.push("Review executionPolicy — scripts are present and trust starts at 'untrusted'.");
  }
  return recs;
}

function findMissingFields(draft: DecisionDependency): string[] {
  const missing: string[] = [];
  if (!draft.domain) missing.push("domain");
  if (!draft.tags?.length) missing.push("tags");
  if (draft.version === "0.0.0") missing.push("version");
  if (!draft.description || draft.description.startsWith("Imported from")) missing.push("description");
  return missing;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${url}`);
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function toTitleCase(s: string): string {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
