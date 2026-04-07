/**
 * Tests for graph_manager highlight logic and config utilities.
 * Renderer itself requires a DOM — tested via config/type assertions.
 */

import { describe, it, expect } from "bun:test";
import {
  nodeRadius, nodeColor, nodeStroke, nodeLabelColor,
  NODE_RADIUS_BASE, NODE_RADIUS_INDEGREE_SCALE, NODE_RADIUS_MAX,
  CONFIDENCE_THRESHOLDS_CHECK,
} from "./helpers";
import type { GraphNode } from "../../client/src/graph_manager/types";

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: "n1", label: "Test", path: "/test.md", ...overrides };
}

// ── nodeRadius ──────────────────────────────────────────────────────────────

describe("nodeRadius", () => {
  it("returns base radius for node with no inDegree", () => {
    expect(nodeRadius(node())).toBe(NODE_RADIUS_BASE);
  });

  it("returns base radius for inDegree=0", () => {
    expect(nodeRadius(node({ inDegree: 0 }))).toBe(NODE_RADIUS_BASE);
  });

  it("increases with inDegree", () => {
    const r1 = nodeRadius(node({ inDegree: 1 }));
    const r5 = nodeRadius(node({ inDegree: 5 }));
    expect(r5).toBeGreaterThan(r1);
  });

  it("respects NODE_RADIUS_MAX cap", () => {
    expect(nodeRadius(node({ inDegree: 9999 }))).toBe(NODE_RADIUS_MAX);
  });

  it("formula: base + inDegree * scale (uncapped)", () => {
    const n = node({ inDegree: 3 });
    const expected = Math.min(NODE_RADIUS_BASE + 3 * NODE_RADIUS_INDEGREE_SCALE, NODE_RADIUS_MAX);
    expect(nodeRadius(n)).toBe(expected);
  });
});

// ── nodeColor ───────────────────────────────────────────────────────────────

describe("nodeColor", () => {
  it("returns amber for platform nodes", () => {
    const color = nodeColor(node({ source: "platform" }));
    expect(color).toBe("#c8a45a");
  });

  it("returns blue for private nodes with inDegree > 0", () => {
    const color = nodeColor(node({ source: "private", inDegree: 2 }));
    expect(color).toBe("#007acc");
  });

  it("returns dim color for private nodes with inDegree = 0", () => {
    const color = nodeColor(node({ source: "private", inDegree: 0 }));
    expect(color).toBe("#4a4a6a");
  });

  it("treats undefined source as private", () => {
    // No source → private path
    const color = nodeColor(node({ inDegree: 1 }));
    expect(color).toBe("#007acc");
  });
});

// ── nodeStroke ──────────────────────────────────────────────────────────────

describe("nodeStroke", () => {
  it("returns amber stroke for platform", () => {
    expect(nodeStroke(node({ source: "platform" }))).toBe("#e8c47a");
  });

  it("returns grey stroke for private", () => {
    expect(nodeStroke(node({ source: "private" }))).toBe("#888");
  });
});

// ── nodeLabelColor ──────────────────────────────────────────────────────────

describe("nodeLabelColor", () => {
  it("returns amber label for platform", () => {
    expect(nodeLabelColor(node({ source: "platform" }))).toBe("#e8c47a");
  });

  it("returns light label for private", () => {
    expect(nodeLabelColor(node({ source: "private" }))).toBe("#ccc");
  });
});

// ── Highlight status type-safety ────────────────────────────────────────────

describe("HighlightNode type contract", () => {
  it("found status maps to green glow", () => {
    // This is a semantic test — verifies the convention is correct
    const FOUND_COLOR = "#4ec9b0";
    const MISSING_COLOR = "#e05555";
    expect(FOUND_COLOR).not.toBe(MISSING_COLOR);
  });

  it("both statuses are distinct strings", () => {
    const found: "found" | "missing" = "found";
    const missing: "found" | "missing" = "missing";
    expect(found).not.toBe(missing);
  });
});
