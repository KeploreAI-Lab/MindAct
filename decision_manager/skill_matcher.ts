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

export function findBestSkill(task: string, skillsRoot: string): SkillMatch | null {
  const skills = loadSkills(skillsRoot);
  if (skills.length === 0) return null;

  const taskTokens = tokenize(task);
  const taskNgrams = charNgrams(task);
  let best: SkillMatch | null = null;

  for (const s of skills) {
    const score = skillScore(task, taskTokens, taskNgrams, s);
    if (!best || score > best.score) {
      best = { ...s, score };
    }
  }

  if (!best) return null;
  // Keep conservative, but allow multilingual skill-intent queries to trigger.
  if (best.score < 0.14) return null;
  return best;
}

export function buildSkillEnrichedPrompt(task: string, match: SkillMatch): string {
  const body = match.body.slice(0, 6000);
  return `你命中了可复用技能：${match.name}
技能路径：${match.path}
匹配分数：${Math.round(match.score * 100)}%

请优先按该技能执行，并在不满足前置条件时明确说明缺口。

=== SKILL ===
${body}

=== TASK ===
${task}`;
}

function loadSkills(skillsRoot: string): SkillMeta[] {
  if (!existsSync(skillsRoot)) return [];
  const out: SkillMeta[] = [];

  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Unpacked skill: skillsRoot/<name>/SKILL.md
      const skillPath = join(skillsRoot, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const raw = safeRead(skillPath);
      if (!raw.trim()) continue;
      const { name, description, body } = parseSkill(raw, entry.name);
      out.push({ id: entry.name, name, description, path: skillPath, body });
    } else if (entry.isFile() && entry.name.endsWith(".skill")) {
      // Packed skill: ZIP archive containing <skill-name>/SKILL.md
      const zipPath = join(skillsRoot, entry.name);
      const id = entry.name.replace(/\.skill$/, "");
      try {
        const zip = new AdmZip(zipPath);
        // Find SKILL.md anywhere inside the archive
        const skillEntry = zip.getEntries().find(e => e.entryName.endsWith("SKILL.md") && !e.isDirectory);
        if (!skillEntry) continue;
        const raw = skillEntry.getData().toString("utf-8");
        if (!raw.trim()) continue;
        const { name, description, body } = parseSkill(raw, id);
        out.push({ id, name, description, path: zipPath, body });
      } catch {
        // Corrupt or unreadable ZIP — skip silently
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
  const bodyTokens = tokenize(s.body.slice(0, 1600));
  const nameNgrams = charNgrams(s.name);
  const descNgrams = charNgrams(s.description);

  const nameOverlap = overlap(taskTokens, nameTokens);
  const descOverlap = overlap(taskTokens, descTokens);
  const bodyOverlap = overlap(taskTokens, bodyTokens);
  const cjkNameOverlap = overlap(taskNgrams, nameNgrams);
  const cjkDescOverlap = overlap(taskNgrams, descNgrams);
  const intentBoost = skillIntentBoost(task, s);
  return 0.4 * nameOverlap + 0.3 * descOverlap + 0.1 * bodyOverlap + 0.1 * cjkNameOverlap + 0.1 * cjkDescOverlap + intentBoost;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(a.size, 1);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1)
  );
}

function charNgrams(text: string, n = 2): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const out = new Set<string>();
  if (!normalized) return out;
  if (normalized.length < n) {
    out.add(normalized);
    return out;
  }
  for (let i = 0; i <= normalized.length - n; i++) {
    out.add(normalized.slice(i, i + n));
  }
  return out;
}

function skillIntentBoost(task: string, s: SkillMeta): number {
  const t = task.toLowerCase();
  const corpus = `${s.name} ${s.description}`.toLowerCase();
  const zhIntent = /(技能|skill|模板|评测|评估|benchmark|触发|沉淀|复用)/i.test(t);
  if (!zhIntent) return 0;
  // For explicit skill-building intent, boost skills related to creation/eval.
  if (/(creator|create|eval|benchmark|trigger|skill)/i.test(corpus)) return 0.18;
  return 0.06;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
