/**
 * Task: RAG-based question answering over the Decision Vault.
 * Retrieves relevant files → feeds to Claude → streams answer back.
 */

import { join } from "path";
import { homedir } from "os";
import { aiStream, aiCall, type ChatMessage } from "../ai_client";
import { loadVaultFiles, retrieveContext } from "../graph_retrieval";
import { SYSTEM_STRUCTURED_OUTPUT, buildRagUserMessage, RAG_NO_CONTEXT_MESSAGE } from "../prompts/index";

export interface RagQueryParams {
  question: string;
  vaultPath: string;
  platformDir?: string;
  conversationHistory?: ChatMessage[];
  onChunk?: (text: string) => void;
  onDone?: (fullText: string) => void;
}

export async function ragQuery(params: RagQueryParams): Promise<string> {
  const {
    question,
    vaultPath,
    platformDir = join(homedir(), ".physmind", "platform"),
    conversationHistory = [],
    onChunk,
    onDone,
  } = params;

  // 1. Retrieve relevant context
  const allFiles = loadVaultFiles({ vaultPath, platformDir });
  if (allFiles.length === 0) {
    onChunk?.(RAG_NO_CONTEXT_MESSAGE);
    onDone?.(RAG_NO_CONTEXT_MESSAGE);
    return RAG_NO_CONTEXT_MESSAGE;
  }

  const { files: contextFiles } = retrieveContext({ query: question, allFiles, topK: 5 });

  // 2. Build message
  const userMessage = buildRagUserMessage({
    question,
    contextFiles: contextFiles.map(f => ({
      name: f.name,
      source: f.source,
      content: f.content,
    })),
  });

  const messages: ChatMessage[] = [
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  // 3. Call AI (streaming if handler provided, else blocking)
  if (onChunk) {
    let result = "";
    await aiStream({
      system: SYSTEM_STRUCTURED_OUTPUT,
      messages,
      onChunk,
      onDone: (text) => { result = text; onDone?.(text); },
    });
    return result;
  } else {
    const result = await aiCall({ system: SYSTEM_STRUCTURED_OUTPUT, messages });
    onDone?.(result);
    return result;
  }
}
