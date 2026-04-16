/**
 * decision_manager — public API
 * All server-side AI and vault logic is exposed through this entry point.
 */

// Vault indexing
export { buildIndex, collectMdFiles, parseLinks, BRAIN_INDEX_PATH } from "./build_index.ts";

// File retrieval
export { loadVaultFiles, retrieveContext } from "./graph_retrieval.ts";
export type { VaultFile, RetrievedContext } from "./graph_retrieval.ts";

// AI tasks
export { ragQuery } from "./tasks/rag_query.ts";
export { suggestLinks, summarizeFile, findMissingDeps } from "./tasks/graph_analysis.ts";

// Dependency analysis pipeline
export { analyzeDependencies } from "./tasks/dependency_analysis.ts";
export type { AnalysisReport, AnalysisDependency } from "./tasks/dependency_analysis.ts";

// Unified DecisionDependency types
export type {
  DecisionDependency,
  ResolvedDependency,
  DDType,
  DDMode,
  TrustLevel,
  MaturityLevel,
  Visibility,
  CoverageLevel,
  DDSource,
  LocalSource,
  RemoteRegistrySource,
  GitHubSource,
  TriggerContract,
  ExecutionPolicy,
  ProgressEvent,
  ProgressEventType,
  FileProgressData,
  HighlightData,
} from "./types.ts";

// Compat adapters (for legacy UI code)
export {
  getMatchedSkill,
  toMatchedSkill,
  toLegacyDependency,
  toLegacyDependencies,
} from "./compat.ts";
export type { LegacyMatchedSkill, LegacyAnalysisDependency } from "./compat.ts";

// Registry
export { loadLocalRegistry, getLocalContent } from "./registry/local_registry.ts";
export { RemoteRegistry } from "./registry/remote_registry.ts";
export type { DecisionDependencyRegistry, RegistryFilter } from "./registry/types.ts";

// Manifest validation
export { ManifestSchema, DomainDetectSchema, DependencyArraySchema, FileMatchSchema } from "./manifest_schema.ts";
export type { Manifest } from "./manifest_schema.ts";

// AI client (for custom tasks)
export { aiCall, aiStream, DEFAULT_MODEL } from "./ai_client.ts";
export type { ChatMessage, AiCallOptions, StreamCallOptions } from "./ai_client.ts";

// i18n
export { dm } from "./i18n.ts";
export type { Lang } from "./i18n.ts";
