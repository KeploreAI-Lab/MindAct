/** Shared frontend types for the dependency analysis pipeline. */

// ─── New unified types (v2) ───────────────────────────────────────────────────

export type DDType = "skill" | "knowledge" | "connector" | "memory";
export type TrustLevel = "untrusted" | "reviewed" | "org-approved";
export type MaturityLevel = "L0" | "L1" | "L2" | "L3";
export type CoverageLevel = "full" | "partial" | "none";
export type Visibility = "public" | "private" | "org";

export interface DecisionDependency {
  id: string;
  version: string;
  type: DDType;
  modes: string[];
  name: string;
  description: string;
  tags: string[];
  domain: string;
  source: { type: string; path?: string; repoUrl?: string };
  publisher: string;
  visibility: Visibility;
  trust: TrustLevel;
  maturity: MaturityLevel;
  trigger?: { intents: string[] };
  executionPolicy?: { requiresApproval: boolean; allowNetwork: boolean; allowSideEffects: boolean; allowFileWrite: boolean };
  installedAt?: string;
  content?: string;
}

export interface ResolvedDependency {
  dd: DecisionDependency;
  coverage: CoverageLevel;
  coveredBy: string[];
  score: number;
  matchReason?: string;
}

/** v2 unified report — matchedSkill removed; use getMatchedSkill(report) helper instead */
export interface AnalysisReport {
  task: string;
  domain: string;
  isDomainSpecific: boolean;
  /** v2: unified list of all resolved dependencies (skills, knowledge, connectors, memory) */
  resolved: ResolvedDependency[];
  foundFiles: string[];
  missingDeps: string[];
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  enrichedPrompt: string;
  reasoning?: {
    multiHopScore: number;
    brokenCriticalChains: string[];
  };
  /**
   * @deprecated Use resolved[] and getMatchedSkill(report) instead.
   * Kept for backward compat with old SSE events during migration.
   */
  matchedSkill?: {
    id: string;
    name: string;
    path: string;
    score: number;
  } | null;
  /**
   * @deprecated Use resolved[] instead.
   */
  dependencies?: AnalysisDependency[];
}

// ─── Compat helpers (client-side equivalents of server compat.ts) ─────────────

export function getMatchedSkill(report: AnalysisReport): { id: string; name: string; path: string; score: number } | null {
  // v2: look in resolved[]
  if (report.resolved) {
    const skillDep = report.resolved.find(r => r.dd.type === "skill");
    if (skillDep) {
      return {
        id: skillDep.dd.id,
        name: skillDep.dd.name,
        path: skillDep.dd.source.type === "local" ? (skillDep.dd.source.path ?? "") : "",
        score: skillDep.score,
      };
    }
  }
  // fallback to v1 matchedSkill
  return report.matchedSkill ?? null;
}

export function getLegacyDependencies(report: AnalysisReport): AnalysisDependency[] {
  if (report.resolved) {
    return report.resolved
      .filter(r => r.dd.type !== "skill")
      .map(r => ({
        name: r.dd.name,
        description: r.dd.description,
        level: r.dd.trust === "org-approved" ? "critical" as const : "helpful" as const,
        coverage: r.coverage,
        coveredBy: r.coveredBy,
      }));
  }
  return report.dependencies ?? [];
}

// ─── Legacy types (kept for backward compat) ─────────────────────────────────

/** @deprecated Use ResolvedDependency instead */
export interface AnalysisDependency {
  name: string;
  description: string;
  level: "critical" | "helpful";
  coverage: "full" | "partial" | "none";
  coveredBy: string[];
}
