/**
 * Retrieves relevant files from the Decision Vault for a given query.
 * Uses keyword overlap + graph adjacency to rank files.
 * No external embedding service required — fast, offline-first.
 */

import { existsSync, readFileSync } from "fs";
import { basename } from "path";
import { collectMdFiles, parseLinks } from "./build_index";

export interface VaultFile {
  name: string;
  path: string;
  source: "platform" | "private";
  content: string;
}

export interface RetrievedContext {
  files: VaultFile[];
  totalFiles: number;
}

/** Load all vault files into memory. */
export function loadVaultFiles(params: {
  vaultPath: string;
  platformDir: string;
}): VaultFile[] {
  const { vaultPath, platformDir } = params;
  const results: VaultFile[] = [];

  if (existsSync(platformDir)) {
    for (const path of collectMdFiles(platformDir)) {
      results.push({
        name: basename(path, ".md"),
        path,
        source: "platform",
        content: safeRead(path),
      });
    }
  }

  if (vaultPath && existsSync(vaultPath)) {
    for (const path of collectMdFiles(vaultPath)) {
      results.push({
        name: basename(path, ".md"),
        path,
        source: "private",
        content: safeRead(path),
      });
    }
  }

  return results;
}

/**
 * Retrieve the most relevant files for a query using keyword scoring
 * + one hop of graph expansion via parsed links.
 */
export function retrieveContext(params: {
  query: string;
  allFiles: VaultFile[];
  topK?: number;
}): RetrievedContext {
  const { query, allFiles, topK = 5 } = params;
  const queryTokens = tokenize(query);

  // Score each file by keyword overlap
  const scored = allFiles.map(f => ({
    file: f,
    score: scoreFile(f, queryTokens),
  }));

  scored.sort((a, b) => b.score - a.score);

  const topFiles = scored.slice(0, topK).filter(s => s.score > 0).map(s => s.file);

  // Expand one hop: include files linked from top results
  const nameToFile = new Map(allFiles.map(f => [f.name, f]));
  const expanded = new Set<string>(topFiles.map(f => f.name));

  for (const file of topFiles) {
    const links = parseLinks(file.content);
    for (const link of links) {
      if (!expanded.has(link) && nameToFile.has(link)) {
        expanded.add(link);
        topFiles.push(nameToFile.get(link)!);
        if (topFiles.length >= topK * 2) break;
      }
    }
  }

  return {
    files: topFiles.slice(0, topK * 2),
    totalFiles: allFiles.length,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeRead(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1)
  );
}

function scoreFile(file: VaultFile, queryTokens: Set<string>): number {
  const haystack = (file.name + " " + file.content).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    // Count occurrences, capped to avoid one keyword dominating
    const count = (haystack.match(new RegExp(token, "g")) || []).length;
    score += Math.min(count, 5);
  }
  // Boost platform files slightly (general knowledge is often more relevant)
  if (file.source === "platform") score *= 1.2;
  return score;
}
