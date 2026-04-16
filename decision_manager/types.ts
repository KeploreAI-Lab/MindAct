// ─── Enumerations ────────────────────────────────────────────────────────────

export type DDType = "skill" | "knowledge" | "connector" | "memory";
export type DDMode = "tool_wrapper" | "generator" | "reviewer" | "inversion" | "pipeline";
export type TrustLevel = "untrusted" | "reviewed" | "org-approved";
export type Visibility = "public" | "private" | "org";
export type CoverageLevel = "full" | "partial" | "none";
export type MaturityLevel = "L1" | "L2" | "L3" | "L4";

// ─── Source Abstraction ──────────────────────────────────────────────────────

export interface LocalSource {
  type: "local";
  path: string;
}
export interface RemoteRegistrySource {
  type: "remote";
  registryUrl: string;
  id: string;
  version?: string;
}
export interface GitHubSource {
  type: "github";
  repoUrl: string;
  ref: string;
  commitSha?: string;
  importedAt: string;
}
export type DDSource = LocalSource | RemoteRegistrySource | GitHubSource;

// ─── Sub-structures ──────────────────────────────────────────────────────────

export interface TriggerContract {
  intents: string[];
  preconditions?: string[];
  requiredInputs?: string[];
  blockedUntil?: string[];
  scoringHints?: Record<string, number>;
}

export interface ExecutionPolicy {
  runtime: "python" | "typescript" | "bash" | "none";
  entrypoint?: string;
  allowNetwork: boolean;
  allowSideEffects: boolean;
  allowFileWrite: boolean;
  allowedConnectors?: string[];
  requiresApproval: boolean;
}

export interface Checkpoint {
  id: string;
  label: string;
  blocking: boolean;
  requiresUserConfirmation: boolean;
  completionCondition?: string;
}

export interface ResourceIndex {
  entryDocs?: string[];
  knowledgeDocs?: string[];
  executableScripts?: string[];
  references?: string[];
  assets?: string[];
  tests?: string[];
  evals?: string[];
  configFiles?: string[];
}

export interface ProvenanceRecord {
  importedFrom?: GitHubSource;
  importHash?: string;
  originalFiles?: string[];
  classificationConfidence?: number;
  normalizedAt?: string;
}

// ─── DecisionDependency ───────────────────────────────────────────────────────
//
// Represents one specific loaded version of a registered package.
// `id` is the stable package identity (never changes); `version` identifies which
// version of that package this instance represents (e.g. "1.2.0").
// Version-varying fields (trust, maturity, executionPolicy) reflect THIS version's values.
//
// `content`: ephemeral lazy-load field. Set by registry.getContent(dd) when SKILL.md body
// is needed. Never persisted in D1 or registry metadata — always fetched on demand.
//
// `installedAt`: local-installation-state field. Populated only for locally installed packages.
// Not part of the remote registry schema. Marked as local-only.

export interface DecisionDependency {
  id: string;               // stable package identity key — never changes across versions
  version: string;          // version string of this instance (e.g. "1.2.0")
  type: DDType;
  modes: DDMode[];
  name: string;
  description: string;
  tags: string[];
  domain: string;
  source: DDSource;
  publisher: string;
  visibility: Visibility;
  trust: TrustLevel;        // version-specific: updated when a version is reviewed
  maturity: MaturityLevel;  // version-specific: may improve in later versions
  trigger?: TriggerContract;
  executionPolicy?: ExecutionPolicy;
  checkpoints?: Checkpoint[];
  resourceIndex?: ResourceIndex;
  provenance?: ProvenanceRecord;
  installedAt?: string;     // LOCAL-ONLY: set when installed locally; absent in remote records
  content?: string;         // EPHEMERAL: set by registry.getContent(dd); never stored in D1/registry
  _isSkillCreatable?: boolean; // RUNTIME-ONLY: set by analysis pipeline; never stored or transmitted
}

// ─── ResolvedDependency ───────────────────────────────────────────────────────
//
// Runtime analysis result (per-task, ephemeral).
// Created fresh each time analyzeDependencies() runs.
// Combines a DecisionDependency reference with per-task resolution state.

export interface ResolvedDependency {
  dd: DecisionDependency;   // pointer to stable registry object
  coverage: CoverageLevel;
  coveredBy: string[];      // vault file names that cover this dep
  score: number;            // relevance score 0–1
  matchReason?: string;     // why it was included / how it was matched
}

// ─── AnalysisReport ───────────────────────────────────────────────────────────
//
// Unified analysis report. matchedSkill is removed from this struct.
// Use toMatchedSkill() / getMatchedSkill() compat adapters in compat.ts.

export interface AnalysisReport {
  task: string;
  domain: string;
  isDomainSpecific: boolean;
  resolved: ResolvedDependency[];   // all deps: skills, knowledge, connectors, memory
  foundFiles: string[];
  missingDeps: string[];
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  enrichedPrompt: string;
  reasoning?: {
    multiHopScore: number;
    brokenCriticalChains: string[];
  };
}

// ─── Progress Events (unchanged from existing) ────────────────────────────────

export type ProgressEventType = "log" | "highlight" | "ghost" | "report" | "error" | "file_progress";

export interface ProgressEvent {
  type: ProgressEventType;
  data: unknown;
}

export interface FileProgressData {
  current: number;
  total: number;
  fileName: string;
}

export interface HighlightData {
  nodes: { id: string; status: "found" | "missing" }[];
}
