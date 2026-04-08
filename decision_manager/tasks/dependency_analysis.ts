/**
 * Task: Full dependency analysis pipeline.
 * Streams progress events (SSE-compatible) to a callback,
 * then returns a structured AnalysisReport.
 */

import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { aiCall, FAST_MODEL } from "../ai_client";
import { loadVaultFiles, retrieveContext } from "../graph_retrieval";
import { parseLinks } from "../build_index";
import { buildSkillEnrichedPrompt, findBestSkill } from "../skill_matcher";
import {
  DETECT_SYSTEM, buildDetectMessage,
  DECOMPOSE_SYSTEM, buildDecomposeMessage,
  MATCH_SYSTEM, buildMatchMessage,
  TEMPLATE_SYSTEM, buildTemplateMessage,
  computeConfidence, confidenceLevel,
  buildEnrichedPrompt,
} from "../prompts/dependency_analysis";

let _calibration: { method: string; temperature: number } | null | undefined;
function loadCalibration() {
  if (_calibration !== undefined) return _calibration;
  try {
    const p = join(import.meta.dir, "..", "confidence_calibration.json");
    if (!existsSync(p)) {
      _calibration = null;
      return _calibration;
    }
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

// ── Public types ───────────────────────────────────────────────────────────

export type ProgressEventType = "log" | "highlight" | "ghost" | "report" | "error";

export interface ProgressEvent {
  type: ProgressEventType;
  data: unknown;
}

export interface HighlightData {
  nodes: { id: string; status: "found" | "missing" }[];
}

export interface AnalysisDependency {
  name: string;
  description: string;
  level: "critical" | "helpful";
  coverage: "full" | "partial" | "none";
  coveredBy: string[];  // file names
}

export interface AnalysisReport {
  task: string;
  domain: string;
  isDomainSpecific: boolean;
  dependencies: AnalysisDependency[];
  foundFiles: string[];        // vault file names used
  missingDeps: string[];       // dependency names with no coverage
  confidence: number;          // 0-100
  confidenceLevel: "high" | "medium" | "low";
  enrichedPrompt: string;      // ready-to-send prompt for Claude Code
  reasoning?: {
    multiHopScore: number;     // 0..1
    brokenCriticalChains: string[];
  };
  matchedSkill?: {
    id: string;
    name: string;
    path: string;
    score: number;
  } | null;
}

type AnalysisMemoryItem = {
  normalizedTask: string;
  domain: string;
  deps: { name: string; description: string; level: "critical" | "helpful" }[];
  ts: number;
};

const ANALYSIS_MEMORY_MAX = 60;
const ANALYSIS_MEMORY: AnalysisMemoryItem[] = [];

// ── Main function ──────────────────────────────────────────────────────────

export async function analyzeDependencies(params: {
  task: string;
  vaultPath: string;
  platformDir?: string;
  skillsDir?: string;
  onEvent: (event: ProgressEvent) => void;
}): Promise<AnalysisReport> {
  const {
    task,
    vaultPath,
    platformDir = join(homedir(), ".physmind", "platform"),
    skillsDir = join(process.cwd(), "skills-test"),
    onEvent,
  } = params;

  const log = (msg: string) => onEvent({ type: "log", data: msg });

  try {
    // ── Stage 0: Skill-first matching (before Knowledge analysis) ─────────
    log("🧩 优先匹配可复用 Skills...");
    const skillMatch = findBestSkill(task, skillsDir);
    if (skillMatch) {
      log(`✓ 命中 Skill：${skillMatch.name}`);
      const report: AnalysisReport = {
        task,
        domain: "skill",
        isDomainSpecific: true,
        dependencies: [],
        foundFiles: [],
        missingDeps: [],
        confidence: Math.max(75, Math.round(skillMatch.score * 100)),
        confidenceLevel: "high",
        enrichedPrompt: buildSkillEnrichedPrompt(task, skillMatch),
        matchedSkill: {
          id: skillMatch.id,
          name: skillMatch.name,
          path: skillMatch.path,
          score: skillMatch.score,
        },
      };
      onEvent({ type: "report", data: report });
      log("✅ 已走 Skill 快速路径");
      return report;
    }
    log("ℹ️ 未命中 Skill，回退到 Knowledge 依赖分析");

    // ── Stage 1: Domain detection ──────────────────────────────────────

    log("🔍 检测任务类型...");
    const detectRaw = await aiCall({
      system: DETECT_SYSTEM,
      messages: [{ role: "user", content: buildDetectMessage(task) }],
      model: FAST_MODEL,
      maxTokens: 256,
      temperature: 0,
    });
    const detect = parseJson(detectRaw) as {
      is_domain_specific: boolean; domain: string; reason: string;
    };

    if (!detect.is_domain_specific) {
      log("ℹ️ 普通任务，无需领域依赖分析");
      const report: AnalysisReport = {
        task, domain: "", isDomainSpecific: false,
        dependencies: [], foundFiles: [], missingDeps: [],
        confidence: 100, confidenceLevel: "high",
        enrichedPrompt: task,
      };
      onEvent({ type: "report", data: report });
      return report;
    }

    log(`✓ 领域识别：${detect.domain}（${detect.reason}）`);

    // Preload files once for both decomposition hints and matching.
    log("📂 加载 Decision Vault 文件列表...");
    const allFiles = loadVaultFiles({ vaultPath, platformDir });
    log(`✓ 共找到 ${allFiles.length} 个文件（Platform: ${allFiles.filter(f => f.source === "platform").length}，Private: ${allFiles.filter(f => f.source === "private").length}）`);

    // ── Stage 2: Decompose dependencies ───────────────────────────────

    log("📋 分析所需知识依赖...");
    const normalizedTask = normalizeTask(task);
    const memoryHit = findSimilarMemory(normalizedTask, detect.domain);
    let deps: { name: string; description: string; level: "critical" | "helpful" }[] = [];
    if (memoryHit) {
      deps = memoryHit.deps;
      log(`♻️ 复用相似任务依赖模板（相似度 ${Math.round(memoryHit.similarity * 100)}%）`);
    } else {
      const decomposeRaw = await aiCall({
        system: DECOMPOSE_SYSTEM,
        messages: [{ role: "user", content: buildDecomposeMessage(task, detect.domain) }],
        model: FAST_MODEL,
        maxTokens: 1024,
        temperature: 0,
      });
      console.log("[DM] decompose raw:", decomposeRaw.slice(0, 500));
      deps = normalizeDependencies((parseJson(decomposeRaw) as any)?.dependencies);
    }

    // If LLM returned empty deps, retry once with retrieval-guided hints
    // instead of immediately falling back to "all files".
    if (deps.length === 0 && allFiles.length > 0) {
      const hintFiles = retrieveContext({ query: task, allFiles, topK: 6 }).files;
      const hints = hintFiles
        .slice(0, 6)
        .map(f => `- ${f.name}: ${f.content.replace(/\n+/g, " ").slice(0, 100)}`)
        .join("\n");
      log("⚠️ 首轮未拆解出依赖，尝试基于高相关文件再次识别...");
      const retryRaw = await aiCall({
        system: DECOMPOSE_SYSTEM,
        messages: [{
          role: "user",
          content: `领域：${detect.domain}
任务：${task}

以下是与任务高相关的知识文件线索：
${hints}

请基于任务与线索，输出 5-10 个“可执行的知识依赖项”。
必须严格输出 JSON，格式如下：
{
  "dependencies": [
    {"name": "依赖名称", "description": "具体说明", "level": "critical|helpful"}
  ]
}
要求：
1) 至少 3 个 critical；
2) name 不能是空泛词（如“机器人知识”“医学知识”）；
3) 若仍无法判断，也必须给出你能确定的最小依赖集。`,
        }],
        model: FAST_MODEL,
        maxTokens: 1024,
        temperature: 0,
      });
      console.log("[DM] decompose retry raw:", retryRaw.slice(0, 500));
      deps = normalizeDependencies((parseJson(retryRaw) as any)?.dependencies);
    }

    if (deps.length === 0) {
      log("⚠️ 未能识别出具体知识依赖项，将直接对所有可用文件评估相关性");
    } else {
      log(`✓ 识别到 ${deps.length} 个知识依赖项`);
      deps.forEach(d => log(`  ${d.level === "critical" ? "🔴" : "🟡"} ${d.name}`));
    }

    // ── Stage 3: Match deps to files ──────────────────────────────────

    if (allFiles.length === 0) {
      log("⚠️ Vault 为空，无可用依赖");
      const report = buildEmptyReport(task, detect.domain, deps);
      onEvent({ type: "report", data: report });
      return report;
    }

    log("🔗 匹配依赖与文件...");
    const availableFiles = allFiles.map(f => ({
      name: f.name,
      source: f.source,
      snippet: f.content.replace(/\n+/g, " ").slice(0, 120),
    }));

    // If decomposition still failed, synthesize from available files as a last fallback.
    const effectiveDeps = deps.length > 0 ? deps : availableFiles.map(f => ({
      name: f.name,
      description: f.snippet,
      level: "helpful",
    }));

    const matchRaw = await aiCall({
      system: MATCH_SYSTEM,
      messages: [{ role: "user", content: buildMatchMessage({ dependencies: effectiveDeps as any, availableFiles }) }],
      model: FAST_MODEL,
      maxTokens: 1024,
      temperature: 0,
    });
    console.log("[DM] match raw:", matchRaw.slice(0, 500));
    const matchResult = parseJson(matchRaw) as {
      matches: { dependency: string; level: string; covered_by: string[]; coverage: string }[];
    };
    let matches = stabilizeMatches(matchResult.matches ?? [], effectiveDeps as any, allFiles);
    if (matches.length === 0 && effectiveDeps.length > 0) {
      log("⚠️ LLM 匹配结果为空，启用本地检索兜底...");
      matches = effectiveDeps.map((dep: any) => {
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
      matches = stabilizeMatches(matches, effectiveDeps as any, allFiles);
    }

    // ── Stage 5: Compute confidence & build report ─────────────────────

    const foundFileNames = new Set<string>();
    const missingDeps: string[] = [];
    const resultDeps: AnalysisDependency[] = [];

    for (const m of matches) {
      const coverage = (m.coverage ?? "none") as "full" | "partial" | "none";
      const coveredBy = m.covered_by ?? [];

      if (coverage !== "none") {
        coveredBy.forEach(f => foundFileNames.add(f));
        log(`  ✅ ${m.dependency} → ${coveredBy.join(", ")}`);
      } else {
        missingDeps.push(m.dependency);
        log(`  ❌ ${m.dependency} → 未找到匹配文件`);
      }

      resultDeps.push({
        name: m.dependency,
        description: deps.find(d => d.name === m.dependency)?.description ?? "",
        level: (m.level ?? "helpful") as "critical" | "helpful",
        coverage,
        coveredBy,
      });
    }

    const evidenceQuality = estimateEvidenceQuality(matches as any, availableFiles as any);
    const noiseRatio = estimateNoiseRatio(matches as any);
    const multiHop = estimateMultiHopReasoning(effectiveDeps as any, matches as any, allFiles as any);
    const boostedEvidenceQuality = clamp01(0.75 * evidenceQuality + 0.25 * multiHop.score);
    const rawConfidence = computeConfidence(matches as any, { evidenceQuality: boostedEvidenceQuality, noiseRatio });
    const confidence = applyCalibration(rawConfidence);
    const level = confidenceLevel(confidence);
    log(`🔀 多跳依赖链完整度：${Math.round(multiHop.score * 100)}%`);
    if (multiHop.brokenCriticalChains.length > 0) {
      log(`⚠️ 关键链路断点：${multiHop.brokenCriticalChains.join("；")}`);
    }
    log(`\n📊 执行可信度等级：${levelLabel(level)}`);

    // Emit highlight event for Brain Graph
    const highlightNodes: { id: string; status: "found" | "missing" }[] = [];
    for (const name of foundFileNames) {
      const file = allFiles.find(f => f.name === name);
      if (file) highlightNodes.push({ id: file.path, status: "found" });
    }
    for (const dep of missingDeps) {
      // Try to find any file that might be relevant (partial name match)
      const candidate = allFiles.find(f =>
        f.name.toLowerCase().includes(dep.toLowerCase().slice(0, 5))
      );
      if (candidate && !foundFileNames.has(candidate.name)) {
        highlightNodes.push({ id: candidate.path, status: "missing" });
      }
    }
    onEvent({ type: "highlight", data: { nodes: highlightNodes } as HighlightData });

    // Emit ghost nodes for missing deps — generate templates in parallel
    if (missingDeps.length > 0) {
      log(`📝 生成缺失知识模板...`);
      const templateEntries = await Promise.all(
        missingDeps.map(async (name) => {
          try {
            const tmpl = await aiCall({
              system: TEMPLATE_SYSTEM,
              messages: [{ role: "user", content: buildTemplateMessage(name, task, detect.domain) }],
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
      log(`📍 在 Brain Graph 中标记 ${missingDeps.length} 个缺失节点（点击可创建）`);
    }

    // Build context files for enriched prompt
    log("\n📖 读取匹配文件内容...");
    const contextFiles: { name: string; source: string; content: string }[] = [];
    for (const name of foundFileNames) {
      const file = allFiles.find(f => f.name === name);
      if (!file) continue;
      log(`  📄 读取：${name}.md`);
      contextFiles.push({ name: file.name, source: file.source, content: file.content });
    }

    const enrichedPrompt = buildEnrichedPrompt({ task, contextFiles, confidence, missingDeps });

    const report: AnalysisReport = {
      task,
      domain: detect.domain,
      isDomainSpecific: true,
      dependencies: resultDeps,
      foundFiles: [...foundFileNames],
      missingDeps,
      confidence,
      confidenceLevel: level,
      enrichedPrompt,
      reasoning: {
        multiHopScore: multiHop.score,
        brokenCriticalChains: multiHop.brokenCriticalChains,
      },
      matchedSkill: null,
    };

    onEvent({ type: "report", data: report });
    rememberAnalysis({
      normalizedTask,
      domain: detect.domain,
      deps: effectiveDeps as any,
      ts: Date.now(),
    });
    log("\n✅ 分析完成");
    return report;

  } catch (err: any) {
    const rawMsg: string = err?.message ?? String(err);
    const msg = rawMsg.includes("ANTHROPIC_API_KEY")
      ? "未配置 ANTHROPIC_API_KEY，请在项目根目录创建 .env 文件并填写 API Key"
      : `分析出错：${rawMsg}`;
    log(`❌ ${msg}`);
    onEvent({ type: "error", data: msg });
    throw err;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function normalizeDependencies(input: unknown): { name: string; description: string; level: "critical" | "helpful" }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((d: any) => ({
      name: String(d?.name ?? "").trim(),
      description: String(d?.description ?? "").trim(),
      level: String(d?.level ?? "").toLowerCase() === "critical" ? "critical" : "helpful",
    }))
    .filter(d => d.name.length > 0);
}

function levelLabel(level: "high" | "medium" | "low"): string {
  return { high: "高", medium: "中", low: "低" }[level];
}

function buildEmptyReport(
  task: string,
  domain: string,
  deps: { name: string; description: string; level: string }[]
): AnalysisReport {
  return {
    task, domain, isDomainSpecific: true,
    dependencies: deps.map(d => ({
      name: d.name, description: d.description,
      level: d.level as "critical" | "helpful",
      coverage: "none", coveredBy: [],
    })),
    foundFiles: [],
    missingDeps: deps.map(d => d.name),
    confidence: 0,
    confidenceLevel: "low",
    enrichedPrompt: task,
    matchedSkill: null,
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
  if (count === 0) return 0.4; // conservative default when no evidence linked
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
  allFiles: { name: string; content: string }[]
): { score: number; brokenCriticalChains: string[] } {
  const criticalDeps = deps.filter(d => d.level === "critical");
  if (criticalDeps.length <= 1) return { score: 1, brokenCriticalChains: [] };

  const adjacency = buildFileAdjacency(allFiles);
  const matchByDep = new Map(matches.map(m => [m.dependency, m]));

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
      broken.push(`${a.name} -> ${b.name}（缺少证据文件）`);
      continue;
    }
    if (withinHops(aFile, bFile, adjacency, 2)) {
      connectedPairs++;
    } else {
      broken.push(`${a.name} -> ${b.name}（链路断开）`);
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
  const byDep = new Map<string, { dependency: string; level: string; covered_by: string[]; coverage: string }>();
  for (const m of rawMatches) {
    const dep = String(m.dependency ?? "").trim();
    if (!dep) continue;
    byDep.set(dep, m);
  }
  const out = deps.map((d) => {
    const m = byDep.get(d.name);
    if (m) {
      const uniq = Array.from(new Set((m.covered_by ?? []).filter(Boolean))).sort();
      const cov = normalizeCoverage(m.coverage, uniq.length);
      return { dependency: d.name, level: d.level, covered_by: uniq, coverage: cov };
    }
    // Deterministic fallback for missing dep entries from LLM.
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
