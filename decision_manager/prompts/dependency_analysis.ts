/**
 * Prompts for the Dependency Analysis pipeline.
 *
 * Pipeline stages:
 *  1. detect    — is this task domain-specific?
 *  2. decompose — what knowledge dependencies does it need?
 *  3. match     — which available files cover each dependency?
 *  4. score     — estimate execution confidence
 */

// ── Stage 1: Domain detection ──────────────────────────────────────────────

export const DETECT_SYSTEM = `你是一个任务分类器。判断用户的任务是否属于领域专项任务。
领域专项任务包括但不限于：物理仿真、机械设计、机器人运动规划、工业制造、材料选型、控制系统、嵌入式开发、信号处理、结构分析等。
纯粹的软件开发、文案写作、数据分析等通用任务不属于领域专项。
只输出 JSON，不要其他内容。`;

export function buildDetectMessage(task: string): string {
  return `任务：${task}

判断此任务是否为领域专项任务，输出：
{"is_domain_specific": true/false, "domain": "领域名称或null", "reason": "一句话说明"}`;
}

// ── Stage 2: Dependency decomposition ─────────────────────────────────────

export const DECOMPOSE_SYSTEM = `你是一个领域知识依赖分析师。
给定一个领域专项任务，分析执行该任务需要哪些类型的专业知识依赖。
每个依赖项应该是具体的知识模块，例如"关节角度约束"而非"机器人知识"。
只输出 JSON，不要其他内容。`;

export function buildDecomposeMessage(task: string, domain: string): string {
  return `领域：${domain}
任务：${task}

列出执行该任务所需的知识依赖项（5-10个），区分必要（critical）和辅助（helpful）：
{
  "dependencies": [
    {"name": "依赖名称", "description": "具体说明需要什么知识", "level": "critical|helpful"},
    ...
  ]
}`;
}

// ── Stage 3: Matching ──────────────────────────────────────────────────────

export const MATCH_SYSTEM = `你是一个知识文件匹配专家。
给定一批需要的知识依赖项，以及可用的文件列表（含摘要），
判断哪些文件覆盖了哪些依赖。一个文件可以覆盖多个依赖，一个依赖也可能需要多个文件。
只输出 JSON，不要其他内容。`;

export function buildMatchMessage(params: {
  dependencies: { name: string; description: string; level: string }[];
  availableFiles: { name: string; source: "platform" | "private"; snippet: string }[];
}): string {
  const deps = params.dependencies.map((d, i) => `${i + 1}. [${d.level}] ${d.name}: ${d.description}`).join("\n");
  const files = params.availableFiles.map(f => `- [${f.source.toUpperCase()}] ${f.name}: ${f.snippet}`).join("\n");

  return `需要的依赖：
${deps}

可用文件：
${files}

输出匹配结果：
{
  "matches": [
    {
      "dependency": "依赖名称",
      "level": "critical|helpful",
      "covered_by": ["文件名1", "文件名2"],
      "coverage": "full|partial|none"
    },
    ...
  ]
}`;
}

// ── Stage 4: Confidence scoring ────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 75,    // ≥75% → High
  MEDIUM: 40,  // 40-74% → Medium
                // <40% → Low
} as const;

export function computeConfidence(matches: {
  dependency: string;
  level: string;
  coverage: "full" | "partial" | "none";
}[], options?: {
  evidenceQuality?: number; // 0..1
  noiseRatio?: number;      // 0..1 (higher = noisier)
}): number {
  if (!matches.length) return 0;

  // A) Coverage confidence (baseline)
  let weightedCoverage = 0;
  let totalWeight = 0;

  for (const m of matches) {
    const weight = m.level === "critical" ? 3 : 1;
    const c = m.coverage === "full" ? 1 : m.coverage === "partial" ? 0.5 : 0;
    weightedCoverage += c * weight;
    totalWeight += weight;
  }
  const coverageConfidence = totalWeight === 0 ? 0 : (weightedCoverage / totalWeight);

  // B) Evidence quality (inspired by retrieval evaluators / calibration methods)
  // Defaults are conservative when unavailable.
  const evidenceQuality = clamp01(options?.evidenceQuality ?? 0.5);
  const noisePenalty = clamp01(options?.noiseRatio ?? 0.3);

  // Blend:
  // - 70% coverage reliability
  // - 25% evidence quality
  // - 5% inverse noise
  const blended =
    0.70 * coverageConfidence +
    0.25 * evidenceQuality +
    0.05 * (1 - noisePenalty);

  return Math.round(clamp01(blended) * 100);
}

export function confidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return "high";
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return "medium";
  return "low";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ── Knowledge template generation ─────────────────────────────────────────

export const TEMPLATE_SYSTEM = `你是一个领域知识文档助手。
根据给定的知识依赖名称和任务背景，生成一个结构化的 Markdown 知识文档模板。
模板应该帮助用户知道需要填写哪些内容，使用 TODO 标记需要填写的地方。
只输出 Markdown 内容，不要 JSON，不要其他说明。`;

export function buildTemplateMessage(depName: string, task: string, domain: string): string {
  return `任务背景：${task}
领域：${domain}
需要创建的知识文档：${depName}

请生成一个 Markdown 模板，包含该知识文档应该记录的关键内容结构。
使用 \`<!-- TODO: ... -->\` 注释说明每个部分应该填写什么。
模板要具体、实用，字段要和"${depName}"强相关。`;
}

// ── Context injection ──────────────────────────────────────────────────────

export function buildEnrichedPrompt(params: {
  task: string;
  contextFiles: { name: string; source: string; content: string }[];
  confidence: number;
  missingDeps: string[];
}): string {
  const { task, contextFiles, confidence, missingDeps } = params;

  const contextBlock = contextFiles.map(f =>
    `=== [${f.source.toUpperCase()}] ${f.name} ===\n${f.content.slice(0, 2500)}`
  ).join("\n\n");

  const missingNote = missingDeps.length > 0
    ? `\n⚠️ 以下依赖知识未找到，请在推理中标注假设：\n${missingDeps.map(d => `- ${d}`).join("\n")}\n`
    : "";

  const level = confidence >= 75 ? "高" : confidence >= 40 ? "中" : "低";

  return `以下是与当前任务相关的领域专项知识（来自 Decision Dependency Vault，执行可信度等级 ${level}）：

${contextBlock}
${missingNote}
---

任务：${task}`;
}
