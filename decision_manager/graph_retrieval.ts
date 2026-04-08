/**
 * Retrieves relevant files from the Decision Vault for a given query.
 * Uses keyword overlap + graph adjacency to rank files.
 * No external embedding service required — fast, offline-first.
 */

import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
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

type DomainDictionary = Record<string, string[]>;

const DOMAIN_DICTIONARY_ZH = loadDomainDictionary("zh");
const DOMAIN_DICTIONARY_EN = loadDomainDictionary("en");

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
  if (allFiles.length === 0) {
    return { files: [], totalFiles: 0 };
  }

  const queryTokens = expandQueryTokens(tokenize(query), query);
  const adjacency = buildAdjacency(allFiles);
  const queryNgrams = charNgrams(query, 2);

  // Phase 1: lexical + lightweight semantic score
  const scored = allFiles.map(f => ({
    file: f,
    lexicalScore: scoreFile(f, queryTokens),
    semanticScore: semanticScoreFile(f, queryNgrams),
  }));
  scored.sort((a, b) => (b.lexicalScore + b.semanticScore) - (a.lexicalScore + a.semanticScore));

  // No lexical+semantic hit means no reliable retrieval signal.
  if ((scored[0]?.lexicalScore ?? 0) <= 0 && (scored[0]?.semanticScore ?? 0) <= 0) {
    return {
      files: [],
      totalFiles: allFiles.length,
    };
  }

  // Phase 2: graph + source-aware reranking
  const seedNames = scored
    .slice(0, Math.max(2, topK))
    .filter(s => s.lexicalScore > 0 || s.semanticScore > 0)
    .map(s => s.file.name);

  const anchor = Math.max((scored[0]?.lexicalScore ?? 0) + (scored[0]?.semanticScore ?? 0), 1);
  const reranked = scored
    .map(({ file, lexicalScore, semanticScore }) => {
      const graphBoost = graphProximityBoost(file.name, seedNames, adjacency);
      const sourceBoost = file.source === "platform" ? 0.08 : 0;
      const exactNameBoost = queryTokens.has(file.name.toLowerCase()) ? 0.2 : 0;
      // Keep graph-near files competitive even with weak lexical overlap.
      const baseScore = lexicalScore + semanticScore * 6;
      const finalScore =
        baseScore * (1 + graphBoost + sourceBoost + exactNameBoost) +
        anchor * graphBoost * 0.45;
      return { file, finalScore };
    })
    .filter(s => s.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore);

  const topFiles = reranked.slice(0, topK).map(s => s.file);

  // Expand one hop: include files linked from top results (bounded)
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

function expandQueryTokens(tokens: Set<string>, query: string): Set<string> {
  const expanded = new Set(tokens);
  const dictionary = selectDictionaryByQuery(query);
  for (const t of tokens) {
    const terms = dictionary[t];
    if (!terms) continue;
    for (const x of terms) expanded.add(x.toLowerCase());
  }
  return expanded;
}

function loadDomainDictionary(lang: "zh" | "en"): DomainDictionary {
  const dictionaryPath = join(process.cwd(), "decision_manager", "dictionaries", `domain_dictionary.${lang}.json`);
  try {
    const raw = readFileSync(dictionaryPath, "utf-8");
    const parsed = JSON.parse(raw) as DomainDictionary;
    return sanitizeDictionary(parsed);
  } catch {
    return {};
  }
}

function selectDictionaryByQuery(query: string): DomainDictionary {
  if (hasCjk(query)) return DOMAIN_DICTIONARY_ZH;
  return DOMAIN_DICTIONARY_EN;
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function sanitizeDictionary(input: DomainDictionary): DomainDictionary {
  const cleaned: DomainDictionary = {};
  for (const [key, values] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase().trim();
    if (!normalizedKey || !Array.isArray(values)) continue;
    const cleanedValues = values
      .map(v => String(v).toLowerCase().trim())
      .filter(Boolean);
    if (cleanedValues.length > 0) cleaned[normalizedKey] = cleanedValues;
  }
  return cleaned;
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

function charNgrams(text: string, n = 2): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const grams = new Set<string>();
  if (normalized.length < n) {
    if (normalized) grams.add(normalized);
    return grams;
  }
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}

function semanticScoreFile(file: VaultFile, queryNgrams: Set<string>): number {
  if (queryNgrams.size === 0) return 0;
  const corpus = (file.name + " " + file.content.slice(0, 2000)).toLowerCase();
  const fileNgrams = charNgrams(corpus, 2);
  let inter = 0;
  for (const g of queryNgrams) {
    if (fileNgrams.has(g)) inter++;
  }
  return inter / Math.max(queryNgrams.size, 1);
}

function buildAdjacency(allFiles: VaultFile[]): Map<string, Set<string>> {
  const nameSet = new Set(allFiles.map(f => f.name));
  const adjacency = new Map<string, Set<string>>();
  for (const file of allFiles) {
    const links = parseLinks(file.content);
    const neighbors = new Set<string>();
    for (const link of links) {
      if (nameSet.has(link)) neighbors.add(link);
    }
    adjacency.set(file.name, neighbors);
  }
  return adjacency;
}

function graphProximityBoost(
  candidate: string,
  seeds: string[],
  adjacency: Map<string, Set<string>>
): number {
  if (seeds.includes(candidate)) return 0.35;
  let best = 0;
  for (const seed of seeds) {
    const seedNeighbors = adjacency.get(seed) ?? new Set<string>();
    if (seedNeighbors.has(candidate)) {
      best = Math.max(best, 0.2);
      continue;
    }
    for (const nb of seedNeighbors) {
      const hop2 = adjacency.get(nb) ?? new Set<string>();
      if (hop2.has(candidate)) {
        best = Math.max(best, 0.1);
      }
    }
  }
  return best;
}
