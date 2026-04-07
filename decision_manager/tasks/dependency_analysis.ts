/**
 * Task: Full dependency analysis pipeline.
 * Streams progress events (SSE-compatible) to a callback,
 * then returns a structured AnalysisReport.
 */

import { join } from "path";
import { homedir } from "os";
import { readFileSync } from "fs";
import { aiCall, FAST_MODEL } from "../ai_client";
import { loadVaultFiles } from "../graph_retrieval";
import {
  DETECT_SYSTEM, buildDetectMessage,
  DECOMPOSE_SYSTEM, buildDecomposeMessage,
  MATCH_SYSTEM, buildMatchMessage,
  TEMPLATE_SYSTEM, buildTemplateMessage,
  computeConfidence, confidenceLevel,
  buildEnrichedPrompt,
} from "../prompts/dependency_analysis";

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
}

// ── Main function ──────────────────────────────────────────────────────────

export async function analyzeDependencies(params: {
  task: string;
  vaultPath: string;
  platformDir?: string;
  onEvent: (event: ProgressEvent) => void;
}): Promise<AnalysisReport> {
  const {
    task,
    vaultPath,
    platformDir = join(homedir(), ".physmind", "platform"),
    onEvent,
  } = params;

  const log = (msg: string) => onEvent({ type: "log", data: msg });

  try {
    // ── Stage 1: Domain detection ──────────────────────────────────────

    log("🔍 检测任务类型...");
    const detectRaw = await aiCall({
      system: DETECT_SYSTEM,
      messages: [{ role: "user", content: buildDetectMessage(task) }],
      model: FAST_MODEL,
      maxTokens: 256,
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

    // ── Stage 2: Decompose dependencies ───────────────────────────────

    log("📋 分析所需知识依赖...");
    const decomposeRaw = await aiCall({
      system: DECOMPOSE_SYSTEM,
      messages: [{ role: "user", content: buildDecomposeMessage(task, detect.domain) }],
      model: FAST_MODEL,
      maxTokens: 1024,
    });
    console.log("[DM] decompose raw:", decomposeRaw.slice(0, 500));
    const decompose = parseJson(decomposeRaw) as {
      dependencies: { name: string; description: string; level: string }[];
    };
    const deps = decompose.dependencies ?? [];
    if (deps.length === 0) {
      log("⚠️ 未能识别出具体知识依赖项，将直接对所有可用文件评估相关性");
    } else {
      log(`✓ 识别到 ${deps.length} 个知识依赖项`);
      deps.forEach(d => log(`  ${d.level === "critical" ? "🔴" : "🟡"} ${d.name}`));
    }

    // ── Stage 3: Load vault files ─────────────────────────────────────

    log("📂 加载 Decision Vault 文件列表...");
    const allFiles = loadVaultFiles({ vaultPath, platformDir });
    log(`✓ 共找到 ${allFiles.length} 个文件（Platform: ${allFiles.filter(f => f.source === "platform").length}，Private: ${allFiles.filter(f => f.source === "private").length}）`);

    if (allFiles.length === 0) {
      log("⚠️ Vault 为空，无可用依赖");
      const report = buildEmptyReport(task, detect.domain, deps);
      onEvent({ type: "report", data: report });
      return report;
    }

    // ── Stage 4: Match deps to files ──────────────────────────────────

    log("🔗 匹配依赖与文件...");
    const availableFiles = allFiles.map(f => ({
      name: f.name,
      source: f.source,
      snippet: f.content.replace(/\n+/g, " ").slice(0, 120),
    }));

    // If decompose returned no deps, synthesize them from the task description
    // so the match step still has something to work with
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
    });
    console.log("[DM] match raw:", matchRaw.slice(0, 500));
    const matchResult = parseJson(matchRaw) as {
      matches: { dependency: string; level: string; covered_by: string[]; coverage: string }[];
    };
    const matches = matchResult.matches ?? [];

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

    const confidence = computeConfidence(matches as any);
    const level = confidenceLevel(confidence);
    log(`\n📊 执行可信度：${confidence}% (${levelLabel(level)})`);

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
    };

    onEvent({ type: "report", data: report });
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
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return {};
  }
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
  };
}
