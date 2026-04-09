/**
 * decision_manager — public API
 * All server-side AI and vault logic is exposed through this entry point.
 */

// Vault indexing
export { buildIndex, collectMdFiles, parseLinks, BRAIN_INDEX_PATH } from "./build_index";

// File retrieval
export { loadVaultFiles, retrieveContext } from "./graph_retrieval";
export type { VaultFile, RetrievedContext } from "./graph_retrieval";

// AI tasks
export { ragQuery } from "./tasks/rag_query";
export { suggestLinks, summarizeFile, findMissingDeps } from "./tasks/graph_analysis";

// AI client (for custom tasks)
export { aiCall, aiStream, DEFAULT_MODEL } from "./ai_client";
export type { ChatMessage, AiCallOptions, StreamCallOptions } from "./ai_client";

// i18n
export { dm } from "./i18n";
export type { Lang } from "./i18n";
