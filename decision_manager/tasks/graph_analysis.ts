/**
 * Task: Graph-level analysis — link suggestions, file summaries, missing deps.
 */

import { join } from "path";
import { homedir } from "os";
import { aiCall } from "../ai_client";
import { loadVaultFiles } from "../graph_retrieval";
import { parseLinks } from "../build_index";
import {
  SYSTEM_BASE,
  buildLinkSuggestionMessage,
  buildFileSummaryMessage,
  buildMissingDepsMessage,
} from "../prompts/index";

const defaultPlatformDir = () => join(homedir(), ".physmind", "platform");

/** Suggest new links for a given file based on Vault contents. */
export async function suggestLinks(params: {
  fileName: string;
  vaultPath: string;
  platformDir?: string;
}): Promise<string> {
  const { fileName, vaultPath, platformDir = defaultPlatformDir() } = params;
  const allFiles = loadVaultFiles({ vaultPath, platformDir });
  const target = allFiles.find(f => f.name === fileName);
  if (!target) return `文件 ${fileName} 未找到`;

  const existing = new Set(parseLinks(target.content));
  const candidates = allFiles
    .filter(f => f.name !== fileName && !existing.has(f.name))
    .map(f => ({ name: f.name, snippet: f.content.slice(0, 100).replace(/\n/g, " ") }));

  return aiCall({
    system: SYSTEM_BASE,
    messages: [{
      role: "user",
      content: buildLinkSuggestionMessage({
        targetFile: fileName,
        targetContent: target.content,
        candidateFiles: candidates,
      }),
    }],
  });
}

/** Summarize a file's role in the knowledge graph. */
export async function summarizeFile(params: {
  fileName: string;
  vaultPath: string;
  platformDir?: string;
}): Promise<string> {
  const { fileName, vaultPath, platformDir = defaultPlatformDir() } = params;
  const allFiles = loadVaultFiles({ vaultPath, platformDir });
  const target = allFiles.find(f => f.name === fileName);
  if (!target) return `文件 ${fileName} 未找到`;

  const linkedFiles = parseLinks(target.content);

  return aiCall({
    system: SYSTEM_BASE,
    messages: [{
      role: "user",
      content: buildFileSummaryMessage({
        fileName,
        content: target.content,
        linkedFiles,
      }),
    }],
  });
}

/** Identify potentially missing dependencies for a file. */
export async function findMissingDeps(params: {
  fileName: string;
  vaultPath: string;
  platformDir?: string;
}): Promise<string> {
  const { fileName, vaultPath, platformDir = defaultPlatformDir() } = params;
  const allFiles = loadVaultFiles({ vaultPath, platformDir });
  const target = allFiles.find(f => f.name === fileName);
  if (!target) return `文件 ${fileName} 未找到`;

  return aiCall({
    system: SYSTEM_BASE,
    messages: [{
      role: "user",
      content: buildMissingDepsMessage({
        fileName,
        content: target.content,
        existingLinks: parseLinks(target.content),
        allKnownFiles: allFiles.map(f => f.name),
      }),
    }],
  });
}
