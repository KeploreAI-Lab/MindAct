/**
 * graph_manager — public API
 * Everything the React layer needs to render and extend the Brain Graph.
 */

export { createGraphRenderer } from "./renderer";
export { nodeRadius, nodeColor, nodeStroke, nodeLabelColor } from "./config";
export type {
  GraphNode,
  GraphEdge,
  GraphData,
  GraphCallbacks,
  GraphRendererHandle,
  HighlightNode,
  NodeSource,
} from "./types";
