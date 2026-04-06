import { create } from "zustand";

export interface Config {
  vault_path: string;
  project_path: string;
  panel_ratio: number;
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  inDegree?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface HistoryEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  line: number; // xterm buffer line number to scroll to
}

interface AppState {
  config: Config | null;
  configLoaded: boolean;
  vaultTree: TreeNode[];
  platformTree: TreeNode[];
  projectTree: TreeNode[];
  activeTab: "kb" | "files";
  graphMode: boolean;
  openFilePath: string | null;
  openFileContent: string | null;
  searchQuery: string;
  panelRatio: number;
  terminalBanner: string | null;
  chatHistory: HistoryEntry[];
  scrollToTerminalLine: ((line: number) => void) | null;

  setConfig: (c: Config) => void;
  setConfigLoaded: (v: boolean) => void;
  setVaultTree: (t: TreeNode[]) => void;
  setPlatformTree: (t: TreeNode[]) => void;
  setProjectTree: (t: TreeNode[]) => void;
  setActiveTab: (t: "kb" | "files") => void;
  setGraphMode: (v: boolean) => void;
  setOpenFile: (path: string | null, content: string | null) => void;
  setSearchQuery: (q: string) => void;
  setPanelRatio: (r: number) => void;
  setTerminalBanner: (msg: string | null) => void;
  addHistoryEntry: (entry: HistoryEntry) => void;
  clearHistory: () => void;
  setScrollToTerminalLine: (fn: ((line: number) => void) | null) => void;
}

export const useStore = create<AppState>((set) => ({
  config: null,
  configLoaded: false,
  vaultTree: [],
  platformTree: [],
  projectTree: [],
  activeTab: "kb",
  graphMode: false,
  openFilePath: null,
  openFileContent: null,
  searchQuery: "",
  panelRatio: 0.45,
  terminalBanner: null,
  chatHistory: [],
  scrollToTerminalLine: null,

  setConfig: (c) => set({ config: c }),
  setConfigLoaded: (v) => set({ configLoaded: v }),
  setVaultTree: (t) => set({ vaultTree: t }),
  setPlatformTree: (t) => set({ platformTree: t }),
  setProjectTree: (t) => set({ projectTree: t }),
  setActiveTab: (t) => set({ activeTab: t }),
  setGraphMode: (v) => set({ graphMode: v }),
  setOpenFile: (path, content) => set({ openFilePath: path, openFileContent: content }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setPanelRatio: (r) => set({ panelRatio: r }),
  setTerminalBanner: (msg) => set({ terminalBanner: msg }),
  addHistoryEntry: (entry) => set((s) => ({ chatHistory: [...s.chatHistory, entry] })),
  clearHistory: () => set({ chatHistory: [] }),
  setScrollToTerminalLine: (fn) => set({ scrollToTerminalLine: fn }),
}));
