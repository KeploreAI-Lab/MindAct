/**
 * Prompts for graph-level analysis tasks:
 * - Suggesting new links between files
 * - Identifying missing dependencies
 * - Summarizing a file's role in the graph
 */

export function buildLinkSuggestionMessage(params: {
  targetFile: string;
  targetContent: string;
  candidateFiles: { name: string; snippet: string }[];
}): string {
  const { targetFile, targetContent, candidateFiles } = params;

  const candidates = candidateFiles
    .map(f => `- ${f.name}：${f.snippet}`)
    .join("\n");

  return `## 目标文件：${targetFile}

${targetContent.slice(0, 2000)}

---

## 候选文件列表

${candidates}

---

请分析目标文件的内容，从候选列表中推荐应当建立链接的文件，并说明理由。
输出格式：
1. 推荐链接：[文件名] — 理由
2. 不推荐：[文件名] — 理由（若有明显不相关的）`;
}

export function buildFileSummaryMessage(params: {
  fileName: string;
  content: string;
  linkedFiles: string[];
}): string {
  const { fileName, content, linkedFiles } = params;
  return `请对以下决策文件进行简要总结（3-5句话），说明：
1. 该文件的核心决策内容
2. 在知识图谱中的作用（与哪些文件有依赖关系）
3. 适用的典型场景

文件名：${fileName}
链接到：${linkedFiles.join(", ") || "（无）"}

文件内容：
${content.slice(0, 3000)}`;
}

export function buildMissingDepsMessage(params: {
  fileName: string;
  content: string;
  existingLinks: string[];
  allKnownFiles: string[];
}): string {
  const { fileName, content, existingLinks, allKnownFiles } = params;
  return `分析以下决策文件，识别可能缺失的依赖关系。

文件名：${fileName}
当前已链接：${existingLinks.join(", ") || "（无）"}
Vault 中所有文件：${allKnownFiles.join(", ")}

文件内容：
${content.slice(0, 2000)}

---

请列出该文件可能遗漏的依赖，并说明原因。`;
}
