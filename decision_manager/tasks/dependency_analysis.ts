/**
 * Task: Full dependency analysis pipeline.
 * Streams progress events (SSE-compatible) to a callback,
 * then returns a structured AnalysisReport.
 *
 * v2: Unified pipeline — skill matching and knowledge analysis both produce
 * ResolvedDependency entries in report.resolved[]. No early-return skill path.
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { aiCall, FAST_MODEL } from "../ai_client.ts";
import { loadVaultFiles, retrieveContext } from "../graph_retrieval.ts";
import { parseLinks } from "../build_index.ts";
import { findBestMatch, buildSkillEnrichedPrompt } from "../skill_matcher.ts";
import {
  getDetectSystem, buildDetectMessage,
  getDecomposeSystem, buildDecomposeMessage,
  getFileMatchSystem, buildFileMatchMessage,
  getTemplateSystem, buildTemplateMessage,
  computeConfidence, confidenceLevel,
  buildEnrichedPrompt,
  DECOMPOSE_SYSTEM,
} from "../prompts/dependency_analysis.ts";
import { dm, type Lang } from "../i18n.ts";
import {
  DomainDetectSchema,
  DependencyArraySchema,
  FileMatchSchema,
} from "../manifest_schema.ts";
import type {
  AnalysisReport,
  ResolvedDependency,
  DecisionDependency,
  ProgressEvent,
  ProgressEventType,
  FileProgressData,
  HighlightData,
} from "../types.ts";

// Re-export progress event types from types.ts for consumers
export type { ProgressEventType, ProgressEvent, FileProgressData, HighlightData };

// ─── Deprecated type re-exports (kept for backward compat) ────────────────────

/**
 * @deprecated Use ResolvedDependency from decision_manager/types.ts instead.
 */
export interface AnalysisDependency {
  name: string;
  description: string;
  level: "critical" | "helpful";
  coverage: "full" | "partial" | "none";
  coveredBy: string[];
}

// Re-export AnalysisReport for consumers that import it from this file
export type { AnalysisReport };

// ─── Analysis memory ─────────────────────────────────────────────────────────

type AnalysisMemoryItem = {
  normalizedTask: string;
  domain: string;
  deps: { name: string; description: string; level: "critical" | "helpful" }[];
  ts: number;
};

const ANALYSIS_MEMORY_MAX = 60;
const ANALYSIS_MEMORY: AnalysisMemoryItem[] = [];

// ─── Calibration ─────────────────────────────────────────────────────────────

let _calibration: { method: string; temperature: number } | null | undefined;
function loadCalibration() {
  if (_calibration !== undefined) return _calibration;
  try {
    const p = join(import.meta.dir, "..", "confidence_calibration.json");
    if (!existsSync(p)) { _calibration = null; return _calibration; }
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (raw?.method === "temperature_scaling" && Number.isFinite(raw?.temperature)) {
      _calibration = { method: raw.method, temperature: Number(raw.temperature) };
      return _calibration;
    }
  } catch {}
  _calibration = null;
  return _calibration;
}

function applyCalibration(score: number): number {
  const c = loadCalibration();
  if (!c) return score;
  const p = Math.min(1 - 1e-6, Math.max(1e-6, score / 100));
  const logit = Math.log(p / (1 - p));
  const scaled = 1 / (1 + Math.exp(-(logit / c.temperature)));
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100);
}

// ─── Skill creatability gate ──────────────────────────────────────────────────
//
// Determines whether a missing dependency is a good candidate for skill creation
// (i.e. a reusable process/procedure) vs. static reference material that should
// be added to the vault instead.  Used to show the "Create with Skill Creator"
// button only where it makes sense, preventing registry pollution.

const ACTION_VERBS = /\b(calibrat|control|generat|analyz|process|extract|detect|deploy|optimiz|execut|build|train|tuning|classif|convert|transform|compil|synthesi|orchestrat|integrat|automat|evaluat)\w*/i;
const REF_MATERIAL = /\b(datasheet|spec|manual|document|reference|catalog|table|list|guideline|overview|introduction|survey|report|notes?)\b/i;

function isSkillCreatable(dd: DecisionDependency): boolean {
  // Already typed as a skill in the registry → always offer creation
  if (dd.type === "skill") return true;
  const text = `${dd.name} ${dd.description}`;
  return ACTION_VERBS.test(text) && !REF_MATERIAL.test(dd.name);
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function analyzeDependencies(params: {
  task: string;
  vaultPath: string;
  platformDir?: string;
  /** Pre-loaded DecisionDependency candidates (replaces skillsDir param). */
  candidates?: DecisionDependency[];
  /** @deprecated Use candidates instead. Kept for backward compat. */
  skillsDir?: string;
  lang?: Lang;
  onEvent: (event: ProgressEvent) => void;
}): Promise<AnalysisReport> {
  const {
    task,
    vaultPath,
    platformDir = join(homedir(), ".physmind", "platform"),
    candidates = [],
    lang = "en",
    onEvent,
  } = params;

  const log = (msg: string) => onEvent({ type: "log", data: msg });
  const m = (key: string, vars?: Record<string, string | number>) => dm(lang, key, vars);

  try {
    // ── Stage 0: Skill scoring (no early return — adds to resolved[]) ─────
    log(m("skill_matching"));
    const skillResult = findBestMatch(task, candidates.filter(c => c.type === "skill"));

    if (skillResult) {
      log(m("skill_matched", { name: skillResult.dd.name }));
    } else {
      log(m("skill_miss"));
    }

    // ── Stage 1: Domain detection ─────────────────────────────────────────
    log(m("detecting_task"));
    const detectRaw = await aiCall({
      system: getDetectSystem(lang),
      messages: [{ role: "user", content: buildDetectMessage(task, lang) }],
      model: FAST_MODEL,
      maxTokens: 256,
      temperature: 0,
    });
    const detectResult = parseJsonWithSchema(detectRaw, DomainDetectSchema, "detect");
    const detect = {
      is_domain_specific: detectResult?.is_domain_specific ?? false,
      domain: detectResult?.domain ?? "",
      reason: detectResult?.reason ?? "",
    };

    if (!detect.is_domain_specific && !skillResult) {
      log(m("general_task"));
      const report: AnalysisReport = {
        task, domain: "", isDomainSpecific: false,
        resolved: [], foundFiles: [], missingDeps: [],
        confidence: 100, confidenceLevel: "high",
        enrichedPrompt: task,
      };
      onEvent({ type: "report", data: report });
      return report;
    }

    // If task is not domain-specific but we have a skill match, use "skill" domain
    const domain = detect.is_domain_specific ? detect.domain : "skill";
    if (detect.is_domain_specific) {
      log(m("domain_detected", { domain: detect.domain, reason: detect.reason }));
    }

    // Preload vault files once for both decomposition and matching
    log(m("loading_vault"));
    const allFiles = loadVaultFiles({ vaultPath, platformDir });
    log(m("vault_loaded", {
      total: allFiles.length,
      platform: allFiles.filter(f => f.source === "platform").length,
      private: allFiles.filter(f => f.source === "private").length,
    }));

    // ── Stage 2: Decompose knowledge dependencies ─────────────────────────
    // Always run even when skill matched — knowledge deps show up in resolved[]
    let rawDeps: { name: string; description: string; level: "critical" | "helpful" }[] = [];

    if (detect.is_domain_specific) {
      log(m("decomposing"));
      const normalizedTask = normalizeTask(task);
      const memoryHit = findSimilarMemory(normalizedTask, detect.domain);

      if (memoryHit) {
        rawDeps = memoryHit.deps;
        log(m("reusing_memory", { pct: Math.round(memoryHit.similarity * 100) }));
      } else {
        const decomposeRaw = await aiCall({
          system: getDecomposeSystem(lang),
          messages: [{ role: "user", content: buildDecomposeMessage(task, detect.domain, lang) }],
          model: FAST_MODEL,
          maxTokens: 1024,
          temperature: 0,
        });
        console.log("[DM] decompose raw:", decomposeRaw.slice(0, 500));
        const decomposeResult = parseJsonWithSchema(decomposeRaw, DependencyArraySchema, "decompose");
        rawDeps = decomposeResult?.dependencies ?? [];
      }

      // Retry once if LLM returned empty deps
      if (rawDeps.length === 0 && allFiles.length > 0) {
        const hintFiles = retrieveContext({ query: task, allFiles, topK: 6 }).files;
        const hints = hintFiles
          .slice(0, 6)
          .map(f => `- ${f.name}: ${f.content.replace(/\n+/g, " ").slice(0, 100)}`)
          .join("\n");
        log(m("decompose_retry"));
        const retryRaw = await aiCall({
          system: DECOMPOSE_SYSTEM,
          messages: [{
            role: "user",
            content: `领域：${detect.domain}
任务：${task}

以下是与任务高相关的知识文件线索：
${hints}

请基于任务与线索，输出 5-10 个"可执行的知识依赖项"。
必须严格输出 JSON，格式如下：
{
  "dependencies": [
    {"name": "依赖名称", "description": "具体说明", "level": "critical|helpful"}
  ]
}
要求：
1) 至少 3 个 critical；
2) name 不能是空泛词（如"机器人知识""医学知识"）；
3) 若仍无法判断，也必须给出你能确定的最小依赖集。`,
          }],
          model: FAST_MODEL,
          maxTokens: 1024,
          temperature: 0,
        });
        console.log("[DM] decompose retry raw:", retryRaw.slice(0, 500));
        const retryResult = parseJsonWithSchema(retryRaw, DependencyArraySchema, "decompose-retry");
        rawDeps = retryResult?.dependencies ?? [];
      }

      if (rawDeps.length === 0) {
        log(m("decompose_empty"));
      } else {
        log(m("deps_found", { count: rawDeps.length }));
        rawDeps.forEach(d => log(`  ${d.level === "critical" ? "🔴" : "🟡"} ${d.name}`));
      }
    }

    // ── Stage 3: Match deps to files ──────────────────────────────────────
    const resolved: ResolvedDependency[] = [];

    // Insert skill match first (if any)
    if (skillResult) {
      resolved.push(skillResult);
    }

    // If no vault and no skill, build minimal report
    if (allFiles.length === 0) {
      log(m("vault_empty"));
      const report = buildMinimalReport(task, domain, rawDeps, resolved);
      onEvent({ type: "report", data: report });
      return report;
    }

    // Build effective dep list for file matching
    const availableFiles = allFiles.map(f => ({
      name: f.name,
      source: f.source,
      snippet: f.content.replace(/\n+/g, " ").slice(0, 120),
    }));

    const effectiveDeps = rawDeps.length > 0
      ? rawDeps
      : availableFiles.map(f => ({
          name: f.name,
          description: f.snippet,
          level: "helpful" as const,
        }));

    // Pre-select up to 20 candidate files using retrieveContext
    const depQuery = effectiveDeps.map(d => d.name).join(" ");
    const candidateFiles = retrieveContext({ query: depQuery || task, allFiles, topK: 20 }).files;

    // Concurrent per-file matching with immediate progress events
    const depCoverage = new Map<string, { covered_by: string[]; coverage: string }>();
    const N = candidateFiles.length;
    const CONCURRENCY = 5;

    log(m("matching_files"));

    const runFile = async (cf: typeof candidateFiles[0], idx: number) => {
      onEvent({
        type: "file_progress",
        data: { current: idx + 1, total: N, fileName: cf.name } as FileProgressData,
      });

      const fileSnippet = cf.content.replace(/\n+/g, " ").slice(0, 300);
      const fileSource = (allFiles.find(f => f.name === cf.name)?.source ?? "private") as string;
      let covered: { dependency: string; coverage: string }[] = [];

      try {
        const raw = await aiCall({
          system: getFileMatchSystem(lang),
          messages: [{
            role: "user",
            content: buildFileMatchMessage(
              { file: { name: cf.name, source: fileSource, snippet: fileSnippet }, dependencies: effectiveDeps },
              lang
            ),
          }],
          model: FAST_MODEL,
          maxTokens: 256,
          temperature: 0,
        });
        const result = parseJsonWithSchema(raw, FileMatchSchema, `file-match:${cf.name}`);
        covered = result?.covered ?? [];
      } catch { /* skip on error */ }

      for (const item of covered) {
        const depName = String(item.dependency ?? "").trim();
        if (!depName || item.coverage === "none") continue;
        const existing = depCoverage.get(depName);
        if (!existing) {
          depCoverage.set(depName, { covered_by: [cf.name], coverage: item.coverage });
        } else {
          if (!existing.covered_by.includes(cf.name)) existing.covered_by.push(cf.name);
          if (item.coverage === "full") existing.coverage = "full";
          else if (item.coverage === "partial" && existing.coverage === "none") existing.coverage = "partial";
        }
      }
    };

    await new Promise<void>((resolve) => {
      let inFlight = 0;
      let nextIdx = 0;
      const launch = () => {
        while (inFlight < CONCURRENCY && nextIdx < N) {
          const idx = nextIdx++;
          inFlight++;
          runFile(candidateFiles[idx], idx).finally(() => {
            inFlight--;
            if (nextIdx < N) launch();
            else if (inFlight === 0) resolve();
          });
        }
        if (N === 0) resolve();
      };
      launch();
    });

    // Build raw matches from coverage map
    let rawMatches = effectiveDeps.map(dep => ({
      dependency: dep.name,
      level: dep.level ?? "helpful",
      covered_by: depCoverage.get(dep.name)?.covered_by ?? [],
      coverage: depCoverage.get(dep.name)?.coverage ?? "none",
    }));

    let matches = stabilizeMatches(rawMatches, effectiveDeps, allFiles);

    if (matches.length === 0 && effectiveDeps.length > 0) {
      log(m("match_fallback"));
      matches = effectiveDeps.map(dep => {
        const query = `${dep.name} ${dep.description ?? ""}`.trim();
        const ctx = retrieveContext({ query, allFiles, topK: 2 });
        const covered_by = ctx.files.slice(0, 2).map(f => f.name);
        return {
          dependency: dep.name,
          level: dep.level ?? "helpful",
          covered_by,
          coverage: covered_by.length > 0 ? "partial" : "none",
        };
      });
      matches = stabilizeMatches(matches, effectiveDeps, allFiles);
    }

    // ── Stage 4: Confidence scoring & report building ─────────────────────

    const foundFileNames = new Set<string>();
    const missingDeps: string[] = [];

    for (const mt of matches) {
      const coverage = (mt.coverage ?? "none") as "full" | "partial" | "none";
      const coveredBy = mt.covered_by ?? [];

      if (coverage !== "none") {
        coveredBy.forEach(f => foundFileNames.add(f));
        log(m("dep_covered", { dep: mt.dependency, files: coveredBy.join(", ") }));
      } else {
        missingDeps.push(mt.dependency);
        log(m("dep_missing", { dep: mt.dependency }));
      }

      // Convert each match to a ResolvedDependency
      // Look for existing DecisionDependency in candidates, or build a knowledge DD
      const existingDD = candidates.find(c => c.id === mt.dependency || c.name === mt.dependency);
      const baseDD: DecisionDependency = existingDD ?? {
        id: mt.dependency.toLowerCase().replace(/\s+/g, "-"),
        version: "0.0.0",
        type: "knowledge",
        modes: [],
        name: mt.dependency,
        description: rawDeps.find(d => d.name === mt.dependency)?.description ?? "",
        tags: [],
        domain,
        source: { type: "local", path: "" },
        publisher: "",
        visibility: "private",
        trust: "untrusted",
        maturity: "L0",
      };
      // Tag with creatability hint so UI can gate skill-creator button correctly.
      // Applied here on the resolved[] DD so DependencyReport has access to it via report.resolved.
      const knowledgeDD: DecisionDependency = (coverage === "none")
        ? { ...baseDD, _isSkillCreatable: isSkillCreatable(baseDD) }
        : baseDD;

      resolved.push({
        dd: knowledgeDD,
        coverage: (mt.coverage ?? "none") as "full" | "partial" | "none",
        coveredBy,
        score: coverage === "full" ? 1 : coverage === "partial" ? 0.5 : 0,
        matchReason: coverage === "none" ? "Missing — no vault files found" : undefined,
      });
    }

    const evidenceQuality = estimateEvidenceQuality(matches, availableFiles);
    const noiseRatio = estimateNoiseRatio(matches);
    const multiHop = estimateMultiHopReasoning(effectiveDeps, matches, allFiles, lang);
    const boostedEvidenceQuality = clamp01(0.75 * evidenceQuality + 0.25 * multiHop.score);
    const rawConfidence = computeConfidence(matches, { evidenceQuality: boostedEvidenceQuality, noiseRatio });
    const confidence = applyCalibration(rawConfidence);
    const level = confidenceLevel(confidence);

    log(m("multihop_score", { pct: Math.round(multiHop.score * 100) }));
    if (multiHop.brokenCriticalChains.length > 0) {
      log(m("broken_chains", { chains: multiHop.brokenCriticalChains.join(lang === "zh" ? "；" : "; ") }));
    }
    log(m("confidence_label", { level: levelLabel(level, lang) }));

    // Highlight event for Brain Graph
    const highlightNodes: { id: string; status: "found" | "missing" }[] = [];
    for (const name of foundFileNames) {
      const file = allFiles.find(f => f.name === name);
      if (file) highlightNodes.push({ id: file.path, status: "found" });
    }
    for (const dep of missingDeps) {
      const candidate = allFiles.find(f =>
        f.name.toLowerCase().includes(dep.toLowerCase().slice(0, 5))
      );
      if (candidate && !foundFileNames.has(candidate.name)) {
        highlightNodes.push({ id: candidate.path, status: "missing" });
      }
    }
    onEvent({ type: "highlight", data: { nodes: highlightNodes } as HighlightData });

    // Ghost nodes for missing deps — generate templates in parallel
    if (missingDeps.length > 0) {
      log(m("generating_templates"));
      const templateEntries = await Promise.all(
        missingDeps.map(async (name) => {
          try {
            const tmpl = await aiCall({
              system: getTemplateSystem(lang),
              messages: [{ role: "user", content: buildTemplateMessage(name, task, domain, lang) }],
              model: FAST_MODEL,
              maxTokens: 800,
              temperature: 0.1,
            });
            return { name, template: tmpl };
          } catch {
            return { name, template: `# ${name}\n\n<!-- TODO: 填写此知识模块的核心内容 -->\n` };
          }
        })
      );
      onEvent({ type: "ghost", data: { nodes: templateEntries } });
      log(m("ghost_marked", { count: missingDeps.length }));
    }

    // Emit skill_request so the UI can prompt the user to contribute missing skills.
    // Carries the full DecisionDependency for each missing dep (already built in resolved[])
    // so the contribution panel has rich metadata without extra lookups.
    if (missingDeps.length > 0) {
      const missingDDs: DecisionDependency[] = missingDeps.map(name => {
        const entry = resolved.find(
          r => r.dd.name === name || r.dd.id === name.toLowerCase().replace(/\s+/g, "-"),
        );
        const dd: DecisionDependency = entry?.dd ?? {
          id: name.toLowerCase().replace(/\s+/g, "-"),
          version: "0.0.0",
          type: "knowledge" as const,
          modes: [],
          name,
          description: rawDeps.find(d => d.name === name)?.description ?? "",
          tags: [],
          domain,
          source: { type: "local" as const, path: "" },
          publisher: "",
          visibility: "private" as const,
          trust: "untrusted" as const,
          maturity: "L0" as const,
        };
        // Tag with creatability hint for UI gating (runtime-only, never stored)
        return { ...dd, _isSkillCreatable: isSkillCreatable(dd) };
      });
      onEvent({ type: "skill_request", data: { missing: missingDDs, domain, task } });
    }

    // Build context files for enriched prompt
    log(m("reading_files"));
    const contextFiles: { name: string; source: string; content: string }[] = [];
    for (const name of foundFileNames) {
      const file = allFiles.find(f => f.name === name);
      if (!file) continue;
      log(m("reading_file", { name }));
      contextFiles.push({ name: file.name, source: file.source, content: file.content });
    }

    // Choose enriched prompt: skill prompt takes precedence when skill matched
    let enrichedPrompt: string;
    if (skillResult) {
      enrichedPrompt = buildSkillEnrichedPrompt(task, skillResult.dd, skillResult.score);
    } else {
      enrichedPrompt = buildEnrichedPrompt({ task, contextFiles, confidence, missingDeps, lang });
    }

    const report: AnalysisReport = {
      task,
      domain,
      isDomainSpecific: detect.is_domain_specific,
      resolved,
      foundFiles: [...foundFileNames],
      missingDeps,
      confidence: skillResult ? Math.max(confidence, Math.round(skillResult.score * 100)) : confidence,
      confidenceLevel: skillResult ? "high" : level,
      enrichedPrompt,
      reasoning: {
        multiHopScore: multiHop.score,
        brokenCriticalChains: multiHop.brokenCriticalChains,
      },
    };

    onEvent({ type: "report", data: report });

    if (detect.is_domain_specific) {
      rememberAnalysis({
        normalizedTask: normalizeTask(task),
        domain: detect.domain,
        deps: rawDeps,
        ts: Date.now(),
      });
    }

    log(m("analysis_complete"));
    return report;

  } catch (err: any) {
    const rawMsg: string = err?.message ?? String(err);
    const msg = rawMsg.includes("ANTHROPIC_API_KEY")
      ? m("error_no_api_key")
      : m("error_analysis", { msg: rawMsg });
    log(`❌ ${msg}`);
    onEvent({ type: "error", data: msg });
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned);
  } catch {
    return {};
  }
}

function parseJsonWithSchema<T>(raw: string, schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: unknown } }, stage: string): T | null {
  const parsed = parseJson(raw);
  const result = schema.safeParse(parsed);
  if (result.success) return result.data!;
  console.warn(`[DM] Zod validation failed for stage '${stage}':`, result.error);
  return null;
}

function levelLabel(level: "high" | "medium" | "low", lang: Lang = "en"): string {
  return dm(lang, `level_${level}`);
}

function buildMinimalReport(
  task: string,
  domain: string,
  deps: { name: string; description: string; level: string }[],
  resolved: ResolvedDependency[],
): AnalysisReport {
  const missingDeps = deps.map(d => d.name);
  const missingResolved: ResolvedDependency[] = deps.map(d => ({
    dd: {
      id: d.name.toLowerCase().replace(/\s+/g, "-"),
      version: "0.0.0",
      type: "knowledge" as const,
      modes: [],
      name: d.name,
      description: d.description,
      tags: [],
      domain,
      source: { type: "local" as const, path: "" },
      publisher: "",
      visibility: "private" as const,
      trust: "untrusted" as const,
      maturity: "L0" as const,
    },
    coverage: "none" as const,
    coveredBy: [],
    score: 0,
  }));

  return {
    task,
    domain,
    isDomainSpecific: true,
    resolved: [...resolved, ...missingResolved],
    foundFiles: [],
    missingDeps,
    confidence: resolved.length > 0 ? Math.round(resolved[0].score * 100) : 0,
    confidenceLevel: resolved.length > 0 ? "high" : "low",
    enrichedPrompt: task,
  };
}

function estimateEvidenceQuality(
  matches: { dependency: string; covered_by?: string[]; coverage?: string }[],
  availableFiles: { name: string; snippet: string }[]
): number {
  const byName = new Map(availableFiles.map(f => [f.name, f.snippet.toLowerCase()]));
  let sum = 0;
  let count = 0;
  for (const m of matches) {
    if (!m.covered_by || m.covered_by.length === 0) continue;
    const depTokens = tokenizeLite(m.dependency);
    for (const f of m.covered_by) {
      const snip = byName.get(f) ?? "";
      if (!snip) continue;
      const fileTokens = tokenizeLite(snip);
      let inter = 0;
      for (const t of depTokens) {
        if (fileTokens.has(t)) inter++;
      }
      const rel = depTokens.size > 0 ? inter / depTokens.size : 0;
      sum += rel;
      count++;
    }
  }
  if (count === 0) return 0.4;
  return Math.max(0, Math.min(1, sum / count));
}

function estimateNoiseRatio(matches: { level: string; coverage: string }[]): number {
  if (matches.length === 0) return 1;
  let noisy = 0;
  let total = 0;
  for (const m of matches) {
    const w = m.level === "critical" ? 2 : 1;
    total += w;
    if (m.coverage === "none") noisy += w;
    if (m.coverage === "partial") noisy += 0.5 * w;
  }
  return total > 0 ? noisy / total : 1;
}

function tokenizeLite(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1)
  );
}

function estimateMultiHopReasoning(
  deps: { name: string; level: "critical" | "helpful" }[],
  matches: { dependency: string; level: string; covered_by?: string[]; coverage?: string }[],
  allFiles: { name: string; content: string }[],
  lang: Lang = "en"
): { score: number; brokenCriticalChains: string[] } {
  const criticalDeps = deps.filter(d => d.level === "critical");
  if (criticalDeps.length <= 1) return { score: 1, brokenCriticalChains: [] };

  const adjacency = buildFileAdjacency(allFiles);
  const matchByDep = new Map(matches.map(mt => [mt.dependency, mt]));

  let connectedPairs = 0;
  let totalPairs = 0;
  const broken: string[] = [];

  for (let i = 0; i < criticalDeps.length - 1; i++) {
    const a = criticalDeps[i];
    const b = criticalDeps[i + 1];
    totalPairs++;
    const aFile = matchByDep.get(a.name)?.covered_by?.[0];
    const bFile = matchByDep.get(b.name)?.covered_by?.[0];
    if (!aFile || !bFile) {
      broken.push(dm(lang, "chain_no_evidence", { a: a.name, b: b.name }));
      continue;
    }
    if (withinHops(aFile, bFile, adjacency, 2)) {
      connectedPairs++;
    } else {
      broken.push(dm(lang, "chain_disconnected", { a: a.name, b: b.name }));
    }
  }

  return {
    score: totalPairs > 0 ? connectedPairs / totalPairs : 1,
    brokenCriticalChains: broken,
  };
}

function buildFileAdjacency(allFiles: { name: string; content: string }[]): Map<string, Set<string>> {
  const names = new Set(allFiles.map(f => f.name));
  const adj = new Map<string, Set<string>>();
  for (const f of allFiles) {
    const neighbors = new Set<string>();
    for (const link of parseLinks(f.content)) {
      if (names.has(link)) neighbors.add(link);
    }
    adj.set(f.name, neighbors);
  }
  return adj;
}

function withinHops(
  from: string,
  to: string,
  adjacency: Map<string, Set<string>>,
  maxHops: number
): boolean {
  if (from === to) return true;
  const visited = new Set<string>([from]);
  const queue: Array<{ node: string; hops: number }> = [{ node: from, hops: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.hops >= maxHops) continue;
    for (const nb of adjacency.get(cur.node) ?? []) {
      if (nb === to) return true;
      if (visited.has(nb)) continue;
      visited.add(nb);
      queue.push({ node: nb, hops: cur.hops + 1 });
    }
  }
  return false;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function normalizeTask(task: string): string {
  const tokens = Array.from(tokenizeLite(task)).sort();
  return tokens.join(" ");
}

function findSimilarMemory(normalizedTask: string, domain: string): { deps: AnalysisMemoryItem["deps"]; similarity: number } | null {
  let best: { item: AnalysisMemoryItem; similarity: number } | null = null;
  for (const item of ANALYSIS_MEMORY) {
    if (item.domain !== domain) continue;
    const sim = jaccardString(item.normalizedTask, normalizedTask);
    if (!best || sim > best.similarity) best = { item, similarity: sim };
  }
  if (!best || best.similarity < 0.68) return null;
  return { deps: best.item.deps, similarity: best.similarity };
}

function rememberAnalysis(item: AnalysisMemoryItem) {
  ANALYSIS_MEMORY.unshift(item);
  if (ANALYSIS_MEMORY.length > ANALYSIS_MEMORY_MAX) ANALYSIS_MEMORY.pop();
}

function jaccardString(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/).filter(Boolean));
  const sb = new Set(b.split(/\s+/).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union > 0 ? inter / union : 0;
}

function stabilizeMatches(
  rawMatches: { dependency: string; level: string; covered_by: string[]; coverage: string }[],
  deps: { name: string; level: string; description?: string }[],
  allFiles: { name: string; content: string; source: "platform" | "private"; path: string }[]
): { dependency: string; level: string; covered_by: string[]; coverage: "full" | "partial" | "none" }[] {
  const byDep = new Map<string, typeof rawMatches[0]>();
  for (const m of rawMatches) {
    const dep = String(m.dependency ?? "").trim();
    if (!dep) continue;
    byDep.set(dep, m);
  }
  const out = deps.map(d => {
    const m = byDep.get(d.name);
    if (m) {
      const uniq = Array.from(new Set((m.covered_by ?? []).filter(Boolean))).sort();
      const cov = normalizeCoverage(m.coverage, uniq.length);
      return { dependency: d.name, level: d.level, covered_by: uniq, coverage: cov };
    }
    const ctx = retrieveContext({ query: `${d.name} ${d.description ?? ""}`.trim(), allFiles, topK: 2 });
    const covered_by = Array.from(new Set(ctx.files.map(f => f.name))).sort();
    return {
      dependency: d.name,
      level: d.level,
      covered_by,
      coverage: covered_by.length > 0 ? "partial" : "none",
    };
  });
  return out.sort((a, b) => a.dependency.localeCompare(b.dependency, "zh-Hans-CN"));
}

function normalizeCoverage(v: string, coveredCount: number): "full" | "partial" | "none" {
  const s = String(v ?? "").toLowerCase();
  if (s === "full") return "full";
  if (s === "partial") return coveredCount > 0 ? "partial" : "none";
  return coveredCount > 0 ? "partial" : "none";
}
