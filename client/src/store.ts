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

interface AppState {
  config: Config | null;
  configLoaded: boolean;
  vaultTree: TreeNode[];
  projectTree: TreeNode[];
  activeTab: "kb" | "files";
  graphMode: boolean;
  openFilePath: string | null;
  openFileContent: string | null;
  searchQuery: string;
  panelRatio: number;

  setConfig: (c: Config) => void;
  setConfigLoaded: (v: boolean) => void;
  setVaultTree: (t: TreeNode[]) => void;
  setProjectTree: (t: TreeNode[]) => void;
  setActiveTab: (t: "kb" | "files") => void;
  setGraphMode: (v: boolean) => void;
  setOpenFile: (path: string | null, content: string | null) => void;
  setSearchQuery: (q: string) => void;
  setPanelRatio: (r: number) => void;
}

export const useStore = create<AppState>((set) => ({
  config: null,
  configLoaded: false,
  vaultTree: [],
  projectTree: [],
  activeTab: "kb",
  graphMode: false,
  openFilePath: null,
  openFileContent: null,
  searchQuery: "",
  panelRatio: 0.45,

  setConfig: (c) => set({ config: c }),
  setConfigLoaded: (v) => set({ configLoaded: v }),
  setVaultTree: (t) => set({ vaultTree: t }),
  setProjectTree: (t) => set({ projectTree: t }),
  setActiveTab: (t) => set({ activeTab: t }),
  setGraphMode: (v) => set({ graphMode: v }),
  setOpenFile: (path, content) => set({ openFilePath: path, openFileContent: content }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setPanelRatio: (r) => set({ panelRatio: r }),
}));
