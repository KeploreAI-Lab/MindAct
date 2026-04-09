import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";

export interface SkillMatch {
  id: string;
  name: string;
  description: string;
  path: string;
  score: number;
  body: string;
}

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  path: string;
  body: string;
}

// Find top-N relevant skills by name+description scoring.
// Returns null if no skills exist or none score above threshold.
export function findBestSkill(task: string, skillsRoot: string): SkillMatch | null {
  const skills = loadSkills(skillsRoot);
  if (skills.length === 0) return null;

  const taskTokens = tokenize(task);
  const taskNgrams = charNgrams(task);

  const scored = skills
    .map(s => ({ ...s, score: skillScore(task, taskTokens, taskNgrams, s) }))
    .sort((a, b) => b.score - a.score);

  const topN = scored.filter(s => s.score >= 0.10).slice(0, 3);
  if (topN.length === 0) return null;

  // Return the top match as the primary, but carry all top-N in body for prompt building
  const top = topN[0];
  return { ...top, body: topN.map(s => `${s.id}|||${s.name}|||${s.description}`).join("\n") };
}

// Build a prompt that lists matching skills by id+description only.
// The agent reads the list and calls `/skills <id>` itself to load the full content.
export function buildSkillEnrichedPrompt(task: string, match: SkillMatch): string {
  const lines = match.body.split("\n").filter(Boolean).map(line => {
    const [id, name, desc] = line.split("|||");
    return `- **${id}** (${name})${desc ? `: ${desc}` : ""}`;
  });

  return `以下技能可能与当前任务相关，请根据描述选择最合适的一个，使用 \`/skills <id>\` 加载完整技能文档后再执行：

${lines.join("\n")}

=== TASK ===
${task}`;
}

function loadSkills(skillsRoot: string): SkillMeta[] {
  if (!existsSync(skillsRoot)) return [];
  const out: SkillMeta[] = [];

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skillPath = join(skillsRoot, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const raw = safeRead(skillPath);
      if (!raw.trim()) continue;
      const { name, description, body } = parseSkill(raw, entry.name);
      out.push({ id: entry.name, name, description, path: skillPath, body });
    } else if (entry.isFile() && entry.name.endsWith(".skill")) {
      const zipPath = join(skillsRoot, entry.name);
      const id = entry.name.replace(/\.skill$/, "");
      try {
        const zip = new AdmZip(zipPath);
        const skillEntry = zip.getEntries().find(e => e.entryName.endsWith("SKILL.md") && !e.isDirectory);
        if (!skillEntry) continue;
        const raw = skillEntry.getData().toString("utf-8");
        if (!raw.trim()) continue;
        const { name, description, body } = parseSkill(raw, id);
        out.push({ id, name, description, path: zipPath, body });
      } catch {
        // Corrupt or unreadable ZIP — skip
      }
    }
  }
  return out;
}

function parseSkill(raw: string, fallbackName: string): { name: string; description: string; body: string } {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) return { name: fallbackName, description: "", body: raw };
  const frontmatter = fm[1];
  const body = raw.slice(fm[0].length);
  const name = extractField(frontmatter, "name") || fallbackName;
  const description = extractField(frontmatter, "description") || "";
  return { name, description, body };
}

function extractField(frontmatter: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.+)$`, "mi");
  const m = frontmatter.match(re);
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function skillScore(task: string, taskTokens: Set<string>, taskNgrams: Set<string>, s: SkillMeta): number {
  const nameTokens = tokenize(s.name);
  const descTokens = tokenize(s.description);
  const nameNgrams = charNgrams(s.name);
  const descNgrams = charNgrams(s.description);

  const nameOverlap = overlap(taskTokens, nameTokens);
  const descOverlap = overlap(taskTokens, descTokens);
  const cjkName = overlap(taskNgrams, nameNgrams);
  const cjkDesc = overlap(taskNgrams, descNgrams);
  return 0.45 * nameOverlap + 0.35 * descOverlap + 0.1 * cjkName + 0.1 * cjkDesc;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(a.size, 1);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ").split(/\s+/).filter(t => t.length > 1)
  );
}

function charNgrams(text: string, n = 2): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const out = new Set<string>();
  if (!normalized || normalized.length < n) { if (normalized) out.add(normalized); return out; }
  for (let i = 0; i <= normalized.length - n; i++) out.add(normalized.slice(i, i + n));
  return out;
}

function safeRead(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}
