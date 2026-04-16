/**
 * local_registry.ts — All disk I/O for loading DecisionDependency packages.
 *
 * Responsibilities:
 *  - Read skill directories and .skill ZIP archives
 *  - Parse SKILL.md frontmatter + optional decision-dependency.yaml manifest
 *  - Normalize to DecisionDependency[]
 *  - content field is left undefined (lazy load via getContent)
 *
 * NO scoring logic here. Scoring is in skill_matcher.ts.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import yaml from "js-yaml";
import { ManifestSchema } from "../manifest_schema.ts";
import type {
  DecisionDependency,
  DDType,
  DDMode,
  TrustLevel,
  MaturityLevel,
  Visibility,
  LocalSource,
} from "../types.ts";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all DecisionDependencies from a local skills directory.
 * Reads each skill dir and .skill ZIP file.
 * Returns DecisionDependency[] with source.type === "local".
 * content is NOT populated — call registry.getContent(dd) to read it.
 */
export async function loadLocalRegistry(skillsDir: string): Promise<DecisionDependency[]> {
  if (!existsSync(skillsDir)) return [];
  const out: DecisionDependency[] = [];

  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const dd = await normalizeSkillDir(join(skillsDir, entry.name), entry.name);
      if (dd) out.push(dd);
    } else if (entry.isFile() && entry.name.endsWith(".skill")) {
      const id = entry.name.replace(/\.skill$/, "");
      const dd = await normalizeSkillZip(join(skillsDir, entry.name), id);
      if (dd) out.push(dd);
    }
  }
  return out;
}

/**
 * Get the SKILL.md body content for a locally-sourced DecisionDependency.
 * Only works for local sources — throws for remote sources.
 */
export async function getLocalContent(dd: DecisionDependency): Promise<string> {
  if (dd.source.type !== "local") {
    throw new Error(`getLocalContent: expected local source, got ${dd.source.type}`);
  }
  const skillPath = dd.source.path;

  // Directory-based skill
  if (!skillPath.endsWith(".skill")) {
    const skillMd = join(skillPath, "SKILL.md");
    if (!existsSync(skillMd)) return "";
    const raw = safeRead(skillMd);
    return extractBody(raw);
  }

  // ZIP-based skill
  try {
    const zip = new AdmZip(skillPath);
    const entry = zip.getEntries().find(e => e.entryName.endsWith("SKILL.md") && !e.isDirectory);
    if (!entry) return "";
    const raw = entry.getData().toString("utf-8");
    return extractBody(raw);
  } catch {
    return "";
  }
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

async function normalizeSkillDir(dirPath: string, id: string): Promise<DecisionDependency | null> {
  const skillMdPath = join(dirPath, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;

  const raw = safeRead(skillMdPath);
  if (!raw.trim()) return null;

  const fm = parseSkillMd(raw, id);
  const manifestPath = join(dirPath, "decision-dependency.yaml");
  const manifest = existsSync(manifestPath) ? loadManifest(manifestPath) : null;

  return buildDD(id, dirPath, fm, manifest);
}

async function normalizeSkillZip(zipPath: string, id: string): Promise<DecisionDependency | null> {
  try {
    const zip = new AdmZip(zipPath);
    const skillEntry = zip.getEntries().find(e => e.entryName.endsWith("SKILL.md") && !e.isDirectory);
    if (!skillEntry) return null;

    const raw = skillEntry.getData().toString("utf-8");
    if (!raw.trim()) return null;

    const fm = parseSkillMd(raw, id);

    // Try to find decision-dependency.yaml inside the ZIP
    const manifestEntry = zip.getEntries().find(
      e => e.entryName.endsWith("decision-dependency.yaml") && !e.isDirectory
    );
    let manifest: ReturnType<typeof loadManifestFromString> = null;
    if (manifestEntry) {
      manifest = loadManifestFromString(manifestEntry.getData().toString("utf-8"));
    }

    return buildDD(id, zipPath, fm, manifest);
  } catch {
    return null;
  }
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

type ParsedManifest = Partial<{
  id: string;
  name: string;
  description: string;
  version: string;
  type: string;
  modes: string[];
  tags: string[];
  domain: string;
  publisher: string;
  visibility: string;
  trust: string;
  maturity: string;
  trigger: unknown;
  executionPolicy: unknown;
  checkpoints: unknown;
  resourceIndex: unknown;
}>;

function loadManifest(manifestPath: string): ParsedManifest | null {
  return loadManifestFromString(safeRead(manifestPath));
}

function loadManifestFromString(content: string): ParsedManifest | null {
  if (!content.trim()) return null;
  try {
    const raw = yaml.load(content);
    if (!raw || typeof raw !== "object") return null;
    const result = ManifestSchema.safeParse(raw);
    if (result.success) return result.data as ParsedManifest;
    // Return raw parsed data even if validation fails — best effort
    return raw as ParsedManifest;
  } catch {
    return null;
  }
}

// ─── DecisionDependency Builder ───────────────────────────────────────────────

interface SkillFrontmatter {
  name: string;
  description: string;
  type?: string;
  domain?: string;
  tags?: string[];
  version?: string;
}

function buildDD(
  id: string,
  sourcePath: string,
  fm: SkillFrontmatter,
  manifest: ParsedManifest | null,
): DecisionDependency {
  const source: LocalSource = { type: "local", path: sourcePath };

  // Manifest fields take precedence; fall back to SKILL.md frontmatter
  const m = manifest ?? {};

  const type = normalizeType(String(m.type ?? "skill"));
  const modes = normalizeModes(m.modes ?? []);
  const tags = Array.isArray(m.tags) ? m.tags.map(String) : (fm.tags ?? []);
  const domain = String(m.domain ?? fm.domain ?? "");

  return {
    id: String(m.id ?? id),
    version: String(m.version ?? fm.version ?? "0.0.0"),
    type,
    modes,
    name: String(m.name ?? fm.name),
    description: String(m.description ?? fm.description),
    tags,
    domain,
    source,
    publisher: String(m.publisher ?? ""),
    visibility: normalizeVisibility(String(m.visibility ?? "private")),
    trust: normalizeTrust(String(m.trust ?? "untrusted")),
    maturity: normalizeMaturity(String(m.maturity ?? "L0")),
    trigger: m.trigger as DecisionDependency["trigger"],
    executionPolicy: m.executionPolicy as DecisionDependency["executionPolicy"],
    checkpoints: m.checkpoints as DecisionDependency["checkpoints"],
    resourceIndex: m.resourceIndex as DecisionDependency["resourceIndex"],
    installedAt: new Date().toISOString(),
    // content is intentionally undefined — lazy load via getLocalContent()
  };
}

// ─── SKILL.md Frontmatter Parser ──────────────────────────────────────────────

function parseSkillMd(raw: string, fallbackName: string): SkillFrontmatter {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return { name: fallbackName, description: "" };

  const frontmatter = fm[1];
  const name = extractField(frontmatter, "name") || fallbackName;
  const description = extractField(frontmatter, "description") || "";
  const domain = extractField(frontmatter, "domain") || "";
  const version = extractField(frontmatter, "version") || "";

  // Parse tags as YAML inline list or comma-separated
  const rawTags = extractField(frontmatter, "tags") || "";
  const tags = rawTags
    ? rawTags.replace(/^\[|\]$/g, "").split(",").map(t => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];

  return { name, description, domain, tags, version };
}

function extractField(frontmatter: string, key: string): string {
  const inlineRe = new RegExp(`^${key}:\\s*(.+)$`, "mi");
  const inlineM = frontmatter.match(inlineRe);
  if (!inlineM) return "";

  const firstVal = inlineM[1].trim();

  // YAML block scalar (> or |): value is on the following indented lines
  if (firstVal === ">" || firstVal === "|") {
    const keyLineIdx = frontmatter.indexOf(inlineM[0]);
    const afterKey = frontmatter.slice(keyLineIdx + inlineM[0].length + 1);
    const lines: string[] = [];
    for (const line of afterKey.split("\n")) {
      if (line.match(/^\s+/)) {
        lines.push(line.trim());
      } else {
        break;
      }
    }
    return lines.join(" ").trim();
  }

  return firstVal.replace(/^["']|["']$/g, "");
}

function extractBody(raw: string): string {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return raw;
  return raw.slice(fm[0].length);
}

// ─── Normalization Helpers ────────────────────────────────────────────────────

function normalizeType(v: string): DDType {
  const valid: DDType[] = ["skill", "knowledge", "connector", "memory"];
  return valid.includes(v as DDType) ? (v as DDType) : "skill";
}

function normalizeModes(v: unknown): DDMode[] {
  if (!Array.isArray(v)) return [];
  const valid: DDMode[] = ["tool_wrapper", "generator", "reviewer", "inversion", "pipeline"];
  return v.filter((m): m is DDMode => valid.includes(m as DDMode));
}

function normalizeTrust(v: string): TrustLevel {
  const valid: TrustLevel[] = ["untrusted", "reviewed", "org-approved"];
  return valid.includes(v as TrustLevel) ? (v as TrustLevel) : "untrusted";
}

function normalizeMaturity(v: string): MaturityLevel {
  const valid: MaturityLevel[] = ["L0", "L1", "L2", "L3"];
  return valid.includes(v as MaturityLevel) ? (v as MaturityLevel) : "L0";
}

function normalizeVisibility(v: string): Visibility {
  const valid: Visibility[] = ["public", "private", "org"];
  return valid.includes(v as Visibility) ? (v as Visibility) : "private";
}

function safeRead(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}
