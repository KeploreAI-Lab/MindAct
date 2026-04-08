/** Shared frontend types for the dependency analysis pipeline. */

export interface AnalysisDependency {
  name: string;
  description: string;
  level: "critical" | "helpful";
  coverage: "full" | "partial" | "none";
  coveredBy: string[];
}

export interface AnalysisReport {
  task: string;
  domain: string;
  isDomainSpecific: boolean;
  dependencies: AnalysisDependency[];
  foundFiles: string[];
  missingDeps: string[];
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  enrichedPrompt: string;
  reasoning?: {
    multiHopScore: number;
    brokenCriticalChains: string[];
  };
  matchedSkill?: {
    id: string;
    name: string;
    path: string;
    score: number;
  } | null;
}
