/**
 * All type definitions for the Brain Graph.
 */

export type NodeSource = "platform" | "private";

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  source?: NodeSource;
  // d3 simulation fields — populated at runtime
  inDegree?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  cross?: boolean; // true = platform↔private edge
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Callbacks the renderer exposes back to the React layer. */
export interface GraphCallbacks {
  onNodeClick?: (node: GraphNode) => void;
  onNodeHoverStart?: (node: GraphNode, event: MouseEvent) => void;
  onNodeHoverEnd?: () => void;
}

export interface HighlightNode {
  id: string;             // matches GraphNode.path
  status: "found" | "missing";
}

/** Return value of createGraphRenderer — lets the caller clean up. */
export interface GraphRendererHandle {
  destroy: () => void;
  highlightNodes: (highlights: HighlightNode[]) => void;
  clearHighlights: () => void;
}
