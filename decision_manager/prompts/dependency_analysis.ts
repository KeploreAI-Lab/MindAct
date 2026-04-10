/**
 * Prompts for the Dependency Analysis pipeline.
 * All prompt builders accept a `lang` parameter ("en" | "zh").
 *
 * Pipeline stages:
 *  1. detect    — is this task domain-specific?
 *  2. decompose — what knowledge dependencies does it need?
 *  3. match     — which available files cover each dependency?
 *  4. score     — estimate execution confidence
 */

import type { Lang } from "../i18n";

// ── Stage 1: Domain detection ──────────────────────────────────────────────

const DETECT_SYSTEM_EN = `You are a task classifier. Determine whether a user's task is domain-specific.
Domain-specific tasks include (but are not limited to): physics simulation, mechanical design, robot motion planning, industrial manufacturing, material selection, control systems, embedded development, signal processing, structural analysis, computer vision, etc.
Generic software development, copywriting, and data analysis are NOT domain-specific.
Output JSON only, no other content.`;

const DETECT_SYSTEM_ZH = `你是一个任务分类器。判断用户的任务是否属于领域专项任务。
领域专项任务包括但不限于：物理仿真、机械设计、机器人运动规划、工业制造、材料选型、控制系统、嵌入式开发、信号处理、结构分析、计算机视觉等。
纯粹的软件开发、文案写作、数据分析等通用任务不属于领域专项。
只输出 JSON，不要其他内容。`;

export function getDetectSystem(lang: Lang): string {
  return lang === "zh" ? DETECT_SYSTEM_ZH : DETECT_SYSTEM_EN;
}

export function buildDetectMessage(task: string, lang: Lang): string {
  if (lang === "zh") {
    return `任务：${task}

判断此任务是否为领域专项任务，输出：
{"is_domain_specific": true/false, "domain": "领域名称或null", "reason": "一句话说明"}`;
  }
  return `Task: ${task}

Determine whether this is a domain-specific task and output:
{"is_domain_specific": true/false, "domain": "domain name or null", "reason": "one-sentence explanation"}`;
}

// ── Stage 2: Dependency decomposition ─────────────────────────────────────

const DECOMPOSE_SYSTEM_EN = `You are a domain knowledge dependency analyst.
Given a domain-specific task, identify which types of specialized knowledge are required.
Each dependency should be a concrete knowledge module (e.g. "joint angle constraints", not "robotics knowledge").
Output JSON only, no other content.`;

const DECOMPOSE_SYSTEM_ZH = `你是一个领域知识依赖分析师。
给定一个领域专项任务，分析执行该任务需要哪些类型的专业知识依赖。
每个依赖项应该是具体的知识模块，例如"关节角度约束"而非"机器人知识"。
只输出 JSON，不要其他内容。`;

export function getDecomposeSystem(lang: Lang): string {
  return lang === "zh" ? DECOMPOSE_SYSTEM_ZH : DECOMPOSE_SYSTEM_EN;
}

export function buildDecomposeMessage(task: string, domain: string, lang: Lang): string {
  if (lang === "zh") {
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
  return `Domain: ${domain}
Task: ${task}

List the knowledge dependencies required to execute this task (5-10 items), distinguishing critical from helpful:
{
  "dependencies": [
    {"name": "dependency name", "description": "specific knowledge required", "level": "critical|helpful"},
    ...
  ]
}`;
}

// ── Stage 3: Matching ──────────────────────────────────────────────────────

const MATCH_SYSTEM_EN = `You are a knowledge file matching expert.
Given a set of required knowledge dependencies and a list of available files (with snippets),
determine which files cover which dependencies. One file can cover multiple dependencies, and one dependency may need multiple files.
Output JSON only, no other content.`;

const MATCH_SYSTEM_ZH = `你是一个知识文件匹配专家。
给定一批需要的知识依赖项，以及可用的文件列表（含摘要），
判断哪些文件覆盖了哪些依赖。一个文件可以覆盖多个依赖，一个依赖也可能需要多个文件。
只输出 JSON，不要其他内容。`;

export function getMatchSystem(lang: Lang): string {
  return lang === "zh" ? MATCH_SYSTEM_ZH : MATCH_SYSTEM_EN;
}

export function buildMatchMessage(params: {
  dependencies: { name: string; description: string; level: string }[];
  availableFiles: { name: string; source: "platform" | "private"; snippet: string }[];
}, lang: Lang): string {
  const deps = params.dependencies.map((d, i) => `${i + 1}. [${d.level}] ${d.name}: ${d.description}`).join("\n");
  const files = params.availableFiles.map(f => `- [${f.source.toUpperCase()}] ${f.name}: ${f.snippet}`).join("\n");

  if (lang === "zh") {
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
  return `Required dependencies:
${deps}

Available files:
${files}

Output matching results:
{
  "matches": [
    {
      "dependency": "dependency name",
      "level": "critical|helpful",
      "covered_by": ["filename1", "filename2"],
      "coverage": "full|partial|none"
    },
    ...
  ]
}`;
}

// ── Stage 4: Confidence scoring ────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 75,
  MEDIUM: 40,
} as const;

export function computeConfidence(matches: {
  dependency: string;
  level: string;
  coverage: "full" | "partial" | "none";
}[], options?: {
  evidenceQuality?: number;
  noiseRatio?: number;
}): number {
  if (!matches.length) return 0;

  let weightedCoverage = 0;
  let totalWeight = 0;
  for (const m of matches) {
    const weight = m.level === "critical" ? 3 : 1;
    const c = m.coverage === "full" ? 1 : m.coverage === "partial" ? 0.5 : 0;
    weightedCoverage += c * weight;
    totalWeight += weight;
  }
  const coverageConfidence = totalWeight === 0 ? 0 : (weightedCoverage / totalWeight);
  const evidenceQuality = clamp01(options?.evidenceQuality ?? 0.5);
  const noisePenalty = clamp01(options?.noiseRatio ?? 0.3);
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

const TEMPLATE_SYSTEM_EN = `You are a domain knowledge document assistant.
Given a knowledge dependency name and task context, generate a structured Markdown knowledge document template.
The template should guide users on what content to fill in, using TODO markers for each section.
Output Markdown only — no JSON, no extra explanation.`;

const TEMPLATE_SYSTEM_ZH = `你是一个领域知识文档助手。
根据给定的知识依赖名称和任务背景，生成一个结构化的 Markdown 知识文档模板。
模板应该帮助用户知道需要填写哪些内容，使用 TODO 标记需要填写的地方。
只输出 Markdown 内容，不要 JSON，不要其他说明。`;

export function getTemplateSystem(lang: Lang): string {
  return lang === "zh" ? TEMPLATE_SYSTEM_ZH : TEMPLATE_SYSTEM_EN;
}

export function buildTemplateMessage(depName: string, task: string, domain: string, lang: Lang): string {
  if (lang === "zh") {
    return `任务背景：${task}
领域：${domain}
需要创建的知识文档：${depName}

请生成一个 Markdown 模板，包含该知识文档应该记录的关键内容结构。
使用 \`<!-- TODO: ... -->\` 注释说明每个部分应该填写什么。
模板要具体、实用，字段要和"${depName}"强相关。`;
  }
  return `Task context: ${task}
Domain: ${domain}
Knowledge document to create: ${depName}

Generate a Markdown template with the key content structure this knowledge document should contain.
Use \`<!-- TODO: ... -->\` comments to indicate what each section should include.
Make the template concrete and practical, with fields strongly related to "${depName}".`;
}

// ── Context injection ──────────────────────────────────────────────────────

export function buildEnrichedPrompt(params: {
  task: string;
  contextFiles: { name: string; source: string; content: string }[];
  confidence: number;
  missingDeps: string[];
  lang?: Lang;
}): string {
  const { task, contextFiles, confidence, missingDeps, lang = "en" } = params;

  const contextBlock = contextFiles.map(f =>
    `=== [${f.source.toUpperCase()}] ${f.name} ===\n${f.content.slice(0, 2500)}`
  ).join("\n\n");

  if (lang === "zh") {
    const level = confidence >= 75 ? "高" : confidence >= 40 ? "中" : "低";
    const missingNote = missingDeps.length > 0
      ? `\n⚠️ 以下依赖知识未找到，请在推理中标注假设：\n${missingDeps.map(d => `- ${d}`).join("\n")}\n`
      : "";
    return `以下是与当前任务相关的领域专项知识（来自 Decision Dependency Vault，执行可信度等级 ${level}）：

${contextBlock}
${missingNote}---

任务：${task}`;
  }

  const level = confidence >= 75 ? "High" : confidence >= 40 ? "Medium" : "Low";
  const missingNote = missingDeps.length > 0
    ? `\n⚠️ The following dependencies were not found — please flag assumptions in your reasoning:\n${missingDeps.map(d => `- ${d}`).join("\n")}\n`
    : "";
  return `The following domain-specific knowledge is relevant to this task (from Decision Dependency Vault, execution confidence: ${level}):

${contextBlock}
${missingNote}---

Task: ${task}`;
}

// ── Stage 3 (per-file): File-by-file matching ─────────────────────────────

const FILE_MATCH_SYSTEM_EN = `You are a knowledge file matching expert.
Given a single file (with a content snippet) and a list of required knowledge dependencies,
determine which dependencies this file covers. Only list dependencies that are actually covered.
Output JSON only, no other content.`;

const FILE_MATCH_SYSTEM_ZH = `你是一个知识文件匹配专家。
给定一个文件（含内容摘要）和一批需要的知识依赖项，
判断该文件覆盖了哪些依赖项。只列出实际覆盖的依赖项。
只输出 JSON，不要其他内容。`;

export function getFileMatchSystem(lang: Lang): string {
  return lang === "zh" ? FILE_MATCH_SYSTEM_ZH : FILE_MATCH_SYSTEM_EN;
}

export function buildFileMatchMessage(params: {
  file: { name: string; source: string; snippet: string };
  dependencies: { name: string; description: string; level: string }[];
}, lang: Lang): string {
  const deps = params.dependencies.map((d, i) => `${i + 1}. [${d.level}] ${d.name}: ${d.description}`).join("\n");

  if (lang === "zh") {
    return `文件：[${params.file.source.toUpperCase()}] ${params.file.name}
内容摘要：${params.file.snippet}

需要匹配的依赖项：
${deps}

该文件覆盖了上述哪些依赖？只列出有覆盖的项，若无覆盖返回空数组。
{"covered": [{"dependency": "依赖名称", "coverage": "full|partial|none"}]}`;
  }
  return `File: [${params.file.source.toUpperCase()}] ${params.file.name}
Content snippet: ${params.file.snippet}

Dependencies to check:
${deps}

Which of these dependencies does this file cover? Only list covered ones; if none, return empty array.
{"covered": [{"dependency": "dep name", "coverage": "full|partial|none"}]}`;
}

// Keep old exports for backward compatibility
export const DETECT_SYSTEM = DETECT_SYSTEM_ZH;
export const DECOMPOSE_SYSTEM = DECOMPOSE_SYSTEM_ZH;
export const MATCH_SYSTEM = MATCH_SYSTEM_ZH;
export const TEMPLATE_SYSTEM = TEMPLATE_SYSTEM_ZH;
