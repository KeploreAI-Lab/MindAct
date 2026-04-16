import type { AnalysisReport, ResolvedDependency } from "./types.ts";

// ─── Legacy Shape ─────────────────────────────────────────────────────────────

/** @deprecated Use ResolvedDependency instead */
export interface LegacyAnalysisDependency {
  name: string;
  description: string;
  level: "critical" | "helpful";
  coverage: "full" | "partial" | "none";
  coveredBy: string[];
}

/** @deprecated Use AnalysisReport.resolved instead */
export interface LegacyMatchedSkill {
  id: string;
  name: string;
  path: string;
  score: number;
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

/**
 * Convert a skill ResolvedDependency to the legacy matchedSkill shape expected
 * by old UI code (Terminal.tsx, DependencyReport.tsx).
 * Returns null if the resolved dependency is not a skill.
 */
export function toMatchedSkill(rd: ResolvedDependency): LegacyMatchedSkill | null {
  if (rd.dd.type !== "skill") return null;
  const path = rd.dd.source.type === "local" ? rd.dd.source.path : "";
  return { id: rd.dd.id, name: rd.dd.name, path, score: rd.score };
}

/**
 * Find the best skill resolution in a report and return it in the legacy
 * matchedSkill shape. Returns null if no skill dependency was resolved.
 * Drop-in replacement for report.matchedSkill access.
 */
export function getMatchedSkill(report: AnalysisReport): LegacyMatchedSkill | null {
  const skillDep = report.resolved.find(r => r.dd.type === "skill");
  return skillDep ? toMatchedSkill(skillDep) : null;
}

/**
 * Convert a ResolvedDependency to the legacy AnalysisDependency shape.
 * Maps trust level to criticality: org-approved → "critical", else → "helpful".
 */
export function toLegacyDependency(rd: ResolvedDependency): LegacyAnalysisDependency {
  return {
    name: rd.dd.name,
    description: rd.dd.description,
    level: rd.dd.trust === "org-approved" ? "critical" : "helpful",
    coverage: rd.coverage,
    coveredBy: rd.coveredBy,
  };
}

/**
 * Convert all ResolvedDependencies in a report to the legacy dependencies array.
 * Excludes skill entries (those are surfaced via getMatchedSkill).
 */
export function toLegacyDependencies(report: AnalysisReport): LegacyAnalysisDependency[] {
  return report.resolved
    .filter(rd => rd.dd.type !== "skill")
    .map(toLegacyDependency);
}
