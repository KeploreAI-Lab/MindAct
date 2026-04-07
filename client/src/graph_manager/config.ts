/**
 * All visual and physics constants for the Brain Graph.
 * Change here to affect the whole graph — nothing is hard-coded in renderer.ts.
 */

import type { GraphNode } from "./types";

// ── Node appearance ────────────────────────────────────────────────────────

export const NODE_RADIUS_BASE = 6;
export const NODE_RADIUS_INDEGREE_SCALE = 1.2; // added per in-degree unit
export const NODE_RADIUS_MAX = 20;

export function nodeRadius(n: GraphNode): number {
  return Math.min(NODE_RADIUS_BASE + (n.inDegree || 0) * NODE_RADIUS_INDEGREE_SCALE, NODE_RADIUS_MAX);
}

export function nodeColor(n: GraphNode): string {
  if (n.source === "platform") return "#c8a45a";
  return (n.inDegree ?? 0) > 0 ? "#007acc" : "#4a4a6a";
}

export function nodeStroke(n: GraphNode): string {
  return n.source === "platform" ? "#e8c47a" : "#888";
}

export function nodeLabelColor(n: GraphNode): string {
  return n.source === "platform" ? "#e8c47a" : "#ccc";
}

export const NODE_LABEL_FONT_SIZE = "11px";
export const NODE_LABEL_OFFSET_X = 4; // px after radius

// ── Edge appearance ────────────────────────────────────────────────────────

export const EDGE_COLOR_NORMAL = "#444";
export const EDGE_COLOR_CROSS = "#c8a45a";   // platform ↔ private
export const EDGE_WIDTH = 1.5;
export const EDGE_DASH_CROSS = "5,3";

export const ARROW_MARKER_ID = "arrow";
export const ARROW_MARKER_CROSS_ID = "arrow-cross";

// ── Force simulation ────────────────────────────────────────────────────────

export const FORCE_LINK_DISTANCE = 120;
export const FORCE_CHARGE_STRENGTH = -200;
export const FORCE_COLLISION_PADDING = 8;
export const FORCE_DRAG_ALPHA_TARGET = 0.3;

// ── Zoom ───────────────────────────────────────────────────────────────────

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

// ── Tooltip ────────────────────────────────────────────────────────────────

export const TOOLTIP_PREVIEW_LINES = 3;
export const TOOLTIP_MAX_WIDTH = "280px";
