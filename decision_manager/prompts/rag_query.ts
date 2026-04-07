/**
 * Prompts for RAG-based question answering over the Decision Vault.
 * Task: given retrieved context files + user question → reasoned answer.
 */

export function buildRagUserMessage(params: {
  question: string;
  contextFiles: { name: string; source: "platform" | "private"; content: string }[];
}): string {
  const { question, contextFiles } = params;

  const contextBlock = contextFiles
    .map(f => {
      const tag = f.source === "platform" ? "[PLATFORM]" : "[PRIVATE]";
      return `--- ${tag} ${f.name} ---\n${f.content.slice(0, 3000)}`;
    })
    .join("\n\n");

  return `## 相关决策上下文

${contextBlock}

---

## 用户问题

${question}

请基于以上上下文回答，并标注引用来源。`;
}

export const RAG_NO_CONTEXT_MESSAGE =
  `当前 Vault 中没有找到与该问题相关的决策文件。
请先在 Brain Graph 中建立相关知识文件，或者更换提问方式。`;
