/**
 * skill_matcher.ts — Pure scoring functions. Zero disk I/O.
 *
 * Disk I/O (loading skills from the filesystem) is in:
 *   decision_manager/registry/local_registry.ts
 *
 * This module only computes similarity scores between a task string and
 * a pre-loaded list of DecisionDependency candidates.
 */

import type { DecisionDependency, ResolvedDependency } from "./types.ts";
import { loadLocalRegistry } from "./registry/local_registry.ts";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Score a DecisionDependency against a task string.
 * Pure function — no I/O.
 *
 * Returns a score in [0, 1].
 */
export function scoreDD(task: string, dd: DecisionDependency): number {
  const taskTokens = tokenize(task);
  const taskNgrams = charNgrams(task);

  const nameTokens = tokenize(dd.name);
  const descTokens = tokenize(dd.description);
  const nameNgrams = charNgrams(dd.name);
  const descNgrams = charNgrams(dd.description);

  const nameOverlap = f1Overlap(taskTokens, nameTokens);
  const descOverlap = f1Overlap(taskTokens, descTokens);
  const cjkName = f1Overlap(taskNgrams, nameNgrams);
  const cjkDesc = f1Overlap(taskNgrams, descNgrams);

  let base = 0.45 * nameOverlap + 0.35 * descOverlap + 0.1 * cjkName + 0.1 * cjkDesc;

  // Bonus from trigger.intents (up to +0.15)
  if (dd.trigger?.intents?.length) {
    const intentScore = dd.trigger.intents.reduce((best, intent) => {
      const s = f1Overlap(taskTokens, tokenize(intent));
      return Math.max(best, s);
    }, 0);
    base = Math.min(1, base + 0.15 * intentScore);
  }

  // Bonus from tags (up to +0.05)
  if (dd.tags?.length) {
    const tagScore = dd.tags.reduce((best, tag) => {
      const s = f1Overlap(taskTokens, tokenize(tag));
      return Math.max(best, s);
    }, 0);
    base = Math.min(1, base + 0.05 * tagScore);
  }

  return base;
}

/**
 * Find the best-matching DecisionDependency from a pre-loaded list.
 * Returns a ResolvedDependency if any candidate scores ≥ 0.18, else null.
 * No disk access.
 */
export function findBestMatch(
  task: string,
  candidates: DecisionDependency[],
): ResolvedDependency | null {
  if (candidates.length === 0) return null;

  const scored = candidates
    .map(dd => ({ dd, score: scoreDD(task, dd) }))
    .sort((a, b) => b.score - a.score);

  const top = scored.filter(s => s.score >= 0.18).slice(0, 1)[0];
  if (!top) return null;

  return {
    dd: top.dd,
    coverage: "full",
    coveredBy: [],
    score: top.score,
    matchReason: `Skill matched by name/description overlap (score: ${top.score.toFixed(3)})`,
  };
}

// ─── Build skill-enriched prompt (unchanged) ─────────────────────────────────

/**
 * Build a prompt that lists matching skills by id+description only.
 * The agent reads the list and calls `/skills <id>` itself to load full content.
 */
export function buildSkillEnrichedPrompt(task: string, dd: DecisionDependency, score: number): string {
  return `以下技能可能与当前任务相关，请根据描述选择最合适的一个，使用 \`/skills <id>\` 加载完整技能文档后再执行：

- **${dd.id}** (${dd.name})${dd.description ? `: ${dd.description}` : ""}

=== TASK ===
${task}`;
}

// ─── Deprecated wrappers (backward compat) ────────────────────────────────────

/**
 * @deprecated Use loadLocalRegistry() + findBestMatch() instead.
 * This wrapper exists for call sites not yet migrated to the registry pattern.
 */
export interface SkillMatch {
  id: string;
  name: string;
  description: string;
  path: string;
  score: number;
  body: string;
}

/**
 * @deprecated Use loadLocalRegistry() + findBestMatch() instead.
 */
export async function findBestSkill(task: string, skillsRoot: string): Promise<SkillMatch | null> {
  const candidates = await loadLocalRegistry(skillsRoot);
  if (candidates.length === 0) return null;

  const result = findBestMatch(task, candidates);
  if (!result) return null;

  const { dd } = result;
  const path = dd.source.type === "local" ? dd.source.path : "";

  // Build body in legacy format: "id|||name|||description\n..."
  const allScored = candidates
    .map(c => ({ c, score: scoreDD(task, c) }))
    .filter(x => x.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const body = allScored
    .map(x => `${x.c.id}|||${x.c.name}|||${x.c.description}`)
    .join("\n");

  return {
    id: dd.id,
    name: dd.name,
    description: dd.description,
    path,
    score: result.score,
    body,
  };
}

// ─── Internal helpers (unchanged scoring math) ───────────────────────────────

function f1Overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  if (inter === 0) return 0;
  const precision = inter / b.size;
  const recall = inter / a.size;
  return (2 * precision * recall) / (precision + recall);
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
