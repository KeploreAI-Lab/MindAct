import { create } from "zustand";
import type { UiLanguage } from "./i18n";

// Re-export graph types from graph_manager — single source of truth
export type { GraphNode, GraphEdge } from "./graph_manager";

export interface Config {
  vault_path: string;
  project_path: string;
  skills_path: string;
  panel_ratio: number;
  kplr_token?: string;
  minimax_token?: string;
  glm_token?: string;
  anthropic_token?: string;
  nvidia_token?: string;
  custom_provider_key?: string;
  custom_provider_url?: string;
  custom_provider_model?: string;
  custom_provider_model_fast?: string;
  selected_backend?: "minimax" | "anthropic" | "glm" | "nvidia" | "custom";
  account_token?: string;   // mact_xxx — MindAct user token for registry sync
  registry_url?: string;    // Override default registry URL
  admin_url?: string;       // Override default admin UI URL (for auth redirect)
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}


export interface HistoryEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  line: number; // xterm buffer line number to scroll to
}

export interface GraphHighlightNode {
  id: string;   // file path (matches GraphNode.path)
  status: "found" | "missing";
}

export interface LogEntry {
  id: number;
  text: string;
  ts: number;
}

export type RegistryConnectionStatus = "connecting" | "connected" | "unreachable" | "degraded";

export interface RegistryStats {
  total_packages: number;
  total_installs: number;
  last_updated: string | null;
}

interface AppState {
  config: Config | null;
  configLoaded: boolean;
  vaultTree: TreeNode[];
  platformTree: TreeNode[];
  projectTree: TreeNode[];
  activeTab: "kb" | "skills" | "files";
  graphMode: boolean;
  kbViewMode: "files" | "brain";
  openFilePath: string | null;
  openFileContent: string | null;
  searchQuery: string;
  panelRatio: number;
  terminalBanner: string | null;
  chatHistory: HistoryEntry[];
  scrollToTerminalLine: ((line: number) => void) | null;
  isThinking: boolean;
  uiLanguage: UiLanguage;

  // Registry connection
  registryStatus: RegistryConnectionStatus;
  registryStats: RegistryStats | null;
  registryUrl: string;
  lastRegistrySync: Date | null;

  // Install state
  installedPackageIds: Set<string>;
  installProgress: Map<string, number>;   // dd_id → 0–100

  // Dependency analysis
  analysisMode: boolean;
  analysisRunning: boolean;
  graphHighlights: GraphHighlightNode[];
  ghostNodes: { name: string; template: string }[];   // missing deps with AI-generated templates
  pendingGhostFile: { name: string; template: string } | null; // unsaved ghost file being edited
  logEntries: LogEntry[];
  logDrawerOpen: boolean;
  analysisProgress: { current: number; total: number; fileName: string } | null;

  setConfig: (c: Config) => void;
  setConfigLoaded: (v: boolean) => void;
  setVaultTree: (t: TreeNode[]) => void;
  setPlatformTree: (t: TreeNode[]) => void;
  setProjectTree: (t: TreeNode[]) => void;
  setActiveTab: (t: "kb" | "skills" | "files") => void;
  setGraphMode: (v: boolean) => void;
  setKbViewMode: (m: "files" | "brain") => void;
  setOpenFile: (path: string | null, content: string | null) => void;
  setSearchQuery: (q: string) => void;
  setPanelRatio: (r: number) => void;
  setTerminalBanner: (msg: string | null) => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
  setScrollToTerminalLine: (fn: ((line: number) => void) | null) => void;
  setIsThinking: (v: boolean) => void;
  setUiLanguage: (lang: UiLanguage) => void;

  setRegistryStatus: (status: RegistryConnectionStatus, stats?: RegistryStats | null, url?: string) => void;
  markInstalled: (ddId: string) => void;
  removeInstalledPackageId: (ddId: string) => void;
  initInstalledFromLocal: (ids: string[]) => void;
  setInstallProgress: (ddId: string, progress: number) => void;
  clearInstallProgress: (ddId: string) => void;

  setAnalysisMode: (v: boolean) => void;
  setAnalysisRunning: (v: boolean) => void;
  setGraphHighlights: (nodes: GraphHighlightNode[]) => void;
  clearGraphHighlights: () => void;
  setGhostNodes: (nodes: { name: string; template: string }[]) => void;
  clearGhostNodes: () => void;
  openGhostNode: (name: string, vaultPath: string, template?: string) => void;
  clearPendingGhostFile: () => void;
  addLogEntry: (text: string) => void;
  clearLog: () => void;
  setLogDrawerOpen: (v: boolean) => void;
  setAnalysisProgress: (p: { current: number; total: number; fileName: string } | null) => void;

  // Skill creator chat window
  skillCreatorChatOpen: boolean;
  skillCreatorChatTarget: string | null;
  pendingTerminalInput: string | null;
  setSkillCreatorChatOpen: (open: boolean, target?: string | null) => void;
  setPendingTerminalInput: (input: string | null) => void;

  // Auto-update: set by electron-updater IPC when a new version is downloaded and staged
  updateInfo: { version: string } | null;
  setUpdateInfo: (info: { version: string } | null) => void;
}

let _logId = 0;

export const useStore = create<AppState>((set) => ({
  config: null,
  configLoaded: false,
  vaultTree: [],
  platformTree: [],
  projectTree: [],
  activeTab: "kb",
  graphMode: false,
  kbViewMode: "brain",
  openFilePath: null,
  openFileContent: null,
  searchQuery: "",
  panelRatio: 0.45,
  terminalBanner: null,
  chatHistory: [],
  scrollToTerminalLine: null,
  isThinking: false,
  uiLanguage: "en",

  registryStatus: "connecting" as RegistryConnectionStatus,
  registryStats: null,
  registryUrl: "",
  lastRegistrySync: null,
  installedPackageIds: new Set<string>(),
  installProgress: new Map<string, number>(),

  analysisMode: false,
  analysisRunning: false,
  graphHighlights: [],
  ghostNodes: [] as { name: string; template: string }[],
  pendingGhostFile: null,
  logEntries: [],
  logDrawerOpen: false,
  analysisProgress: null,

  setConfig: (c) => set({ config: c }),
  setConfigLoaded: (v) => set({ configLoaded: v }),
  setVaultTree: (t) => set({ vaultTree: t }),
  setPlatformTree: (t) => set({ platformTree: t }),
  setProjectTree: (t) => set({ projectTree: t }),
  setActiveTab: (t) => set({ activeTab: t }),
  setGraphMode: (v) => set({ graphMode: v }),
  setKbViewMode: (m) => set({ kbViewMode: m }),
  setOpenFile: (path, content) => set({ openFilePath: path, openFileContent: content }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setPanelRatio: (r) => set({ panelRatio: r }),
  setTerminalBanner: (msg) => set({ terminalBanner: msg }),
  addHistoryEntry: (entry) => set((s) => ({ chatHistory: [...s.chatHistory, entry] })),
  clearHistory: () => set({ chatHistory: [] }),
  setScrollToTerminalLine: (fn) => set({ scrollToTerminalLine: fn }),
  setIsThinking: (v) => set({ isThinking: v }),
  setUiLanguage: (lang) => set({ uiLanguage: lang }),

  markInstalled: (ddId) => set((s) => ({
    installedPackageIds: new Set([...s.installedPackageIds, ddId]),
  })),
  removeInstalledPackageId: (ddId) => set((s) => {
    const next = new Set(s.installedPackageIds);
    next.delete(ddId);
    return { installedPackageIds: next };
  }),
  initInstalledFromLocal: (ids) => set((s) => ({
    // Merge disk-state ids with any in-session marks (so mid-session installs survive reloads)
    installedPackageIds: new Set([...ids, ...s.installedPackageIds]),
  })),
  setInstallProgress: (ddId, progress) => set((s) => {
    const next = new Map(s.installProgress);
    next.set(ddId, progress);
    return { installProgress: next };
  }),
  clearInstallProgress: (ddId) => set((s) => {
    const next = new Map(s.installProgress);
    next.delete(ddId);
    return { installProgress: next };
  }),

  setRegistryStatus: (status, stats, url) => set((s) => ({
    registryStatus: status,
    registryStats: stats !== undefined ? stats : s.registryStats,
    ...(url ? { registryUrl: url } : {}),
    lastRegistrySync: status === "connected" ? new Date() : s.lastRegistrySync,
  })),

  setAnalysisMode: (v) => set({ analysisMode: v }),
  setAnalysisRunning: (v) => set({ analysisRunning: v }),
  setGraphHighlights: (nodes) => set({ graphHighlights: nodes }),
  clearGraphHighlights: () => set({ graphHighlights: [], ghostNodes: [] }),
  setGhostNodes: (nodes) => set({ ghostNodes: nodes }),
  clearGhostNodes: () => set({ ghostNodes: [] }),
  openGhostNode: (name, vaultPath, template) => {
    const filePath = `${vaultPath}/${name.replace(/\s+/g, "_")}.md`;
    const content = template ?? `# ${name}\n\n`;
    set({
      openFilePath: filePath,
      openFileContent: content,
      graphMode: false,
      activeTab: "kb",
      kbViewMode: "files",
      pendingGhostFile: { name, template: content },
    });
  },
  clearPendingGhostFile: () => set({ pendingGhostFile: null }),
  addLogEntry: (text) => set((s) => ({
    logEntries: [...s.logEntries.slice(-200), { id: _logId++, text, ts: Date.now() }],
  })),
  clearLog: () => set({ logEntries: [] }),
  setLogDrawerOpen: (v) => set({ logDrawerOpen: v }),
  setAnalysisProgress: (p) => set({ analysisProgress: p }),

  skillCreatorChatOpen: false,
  skillCreatorChatTarget: null,
  pendingTerminalInput: null,
  setSkillCreatorChatOpen: (open, target) => set({ skillCreatorChatOpen: open, skillCreatorChatTarget: target ?? null }),
  setPendingTerminalInput: (input) => set({ pendingTerminalInput: input }),

  updateInfo: null,
  setUpdateInfo: (info) => set({ updateInfo: info }),
}));
