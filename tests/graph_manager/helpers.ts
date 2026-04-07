// Re-export config values for use in tests (avoids importing from client/src directly)
export {
  nodeRadius,
  nodeColor,
  nodeStroke,
  nodeLabelColor,
  NODE_RADIUS_BASE,
  NODE_RADIUS_INDEGREE_SCALE,
  NODE_RADIUS_MAX,
} from "../../client/src/graph_manager/config";

// Confidence threshold constants (mirrored from server-side prompts for cross-checking)
export const CONFIDENCE_THRESHOLDS_CHECK = {
  HIGH: 75,
  MEDIUM: 40,
};
