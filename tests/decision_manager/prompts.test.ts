import { describe, it, expect } from "bun:test";
import {
  buildDetectMessage,
  buildDecomposeMessage,
  buildMatchMessage,
  computeConfidence,
  confidenceLevel,
  buildEnrichedPrompt,
  CONFIDENCE_THRESHOLDS,
} from "../../decision_manager/prompts/dependency_analysis";

// ── buildDetectMessage ──────────────────────────────────────────────────────

describe("buildDetectMessage", () => {
  it("includes the task text", () => {
    const msg = buildDetectMessage("设计一个机械臂轨迹规划方案");
    expect(msg).toContain("设计一个机械臂轨迹规划方案");
  });

  it("asks for JSON output", () => {
    const msg = buildDetectMessage("任务");
    expect(msg).toContain("is_domain_specific");
  });

  it("requests domain and reason fields", () => {
    const msg = buildDetectMessage("任务");
    expect(msg).toContain("domain");
    expect(msg).toContain("reason");
  });
});

// ── buildDecomposeMessage ───────────────────────────────────────────────────

describe("buildDecomposeMessage", () => {
  it("includes task and domain", () => {
    const msg = buildDecomposeMessage("设计机械臂", "机器人");
    expect(msg).toContain("设计机械臂");
    expect(msg).toContain("机器人");
  });

  it("asks for critical/helpful distinction", () => {
    const msg = buildDecomposeMessage("任务", "领域");
    expect(msg).toContain("critical");
    expect(msg).toContain("helpful");
  });

  it("requests JSON with dependencies array", () => {
    const msg = buildDecomposeMessage("任务", "领域");
    expect(msg).toContain("dependencies");
  });
});

// ── buildMatchMessage ───────────────────────────────────────────────────────

describe("buildMatchMessage", () => {
  const deps = [
    { name: "路径规划", description: "需要路径规划算法知识", level: "critical" },
    { name: "关节约束", description: "关节限位参数", level: "helpful" },
  ];
  const files = [
    { name: "motion_planning", source: "platform" as const, snippet: "A* and RRT* algorithms" },
    { name: "joint_constraints", source: "private" as const, snippet: "Joint 1: ±180°" },
  ];

  it("includes all dependency names", () => {
    const msg = buildMatchMessage({ dependencies: deps, availableFiles: files });
    expect(msg).toContain("路径规划");
    expect(msg).toContain("关节约束");
  });

  it("includes all file names", () => {
    const msg = buildMatchMessage({ dependencies: deps, availableFiles: files });
    expect(msg).toContain("motion_planning");
    expect(msg).toContain("joint_constraints");
  });

  it("marks platform vs private sources", () => {
    const msg = buildMatchMessage({ dependencies: deps, availableFiles: files });
    expect(msg).toContain("PLATFORM");
    expect(msg).toContain("PRIVATE");
  });

  it("requests covered_by and coverage in output", () => {
    const msg = buildMatchMessage({ dependencies: deps, availableFiles: files });
    expect(msg).toContain("covered_by");
    expect(msg).toContain("coverage");
  });

  it("handles empty dependencies list", () => {
    const msg = buildMatchMessage({ dependencies: [], availableFiles: files });
    expect(typeof msg).toBe("string");
  });

  it("handles empty files list", () => {
    const msg = buildMatchMessage({ dependencies: deps, availableFiles: [] });
    expect(typeof msg).toBe("string");
  });
});

// ── computeConfidence ───────────────────────────────────────────────────────

describe("computeConfidence", () => {
  it("returns 100 when all full coverage", () => {
    const score = computeConfidence([
      { dependency: "a", level: "critical", coverage: "full" },
      { dependency: "b", level: "helpful", coverage: "full" },
    ]);
    expect(score).toBe(100);
  });

  it("returns 0 when all no coverage", () => {
    const score = computeConfidence([
      { dependency: "a", level: "critical", coverage: "none" },
      { dependency: "b", level: "critical", coverage: "none" },
    ]);
    expect(score).toBe(0);
  });

  it("returns ~50 for partial coverage", () => {
    const score = computeConfidence([
      { dependency: "a", level: "critical", coverage: "partial" },
    ]);
    expect(score).toBe(50);
  });

  it("weights critical higher than helpful", () => {
    const allCritical = computeConfidence([
      { dependency: "a", level: "critical", coverage: "full" },
      { dependency: "b", level: "critical", coverage: "none" },
    ]);
    const mixedWeight = computeConfidence([
      { dependency: "a", level: "critical", coverage: "full" },
      { dependency: "b", level: "helpful", coverage: "none" },
    ]);
    // critical:helpful = 3:1, so missing critical hurts more
    expect(mixedWeight).toBeGreaterThan(allCritical);
  });

  it("returns 0 for empty matches", () => {
    expect(computeConfidence([])).toBe(0);
  });

  it("score is always 0-100", () => {
    const score = computeConfidence([
      { dependency: "a", level: "critical", coverage: "full" },
      { dependency: "b", level: "helpful", coverage: "partial" },
      { dependency: "c", level: "critical", coverage: "none" },
    ]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── confidenceLevel ─────────────────────────────────────────────────────────

describe("confidenceLevel", () => {
  it("returns high for score >= HIGH threshold", () => {
    expect(confidenceLevel(CONFIDENCE_THRESHOLDS.HIGH)).toBe("high");
    expect(confidenceLevel(100)).toBe("high");
    expect(confidenceLevel(75)).toBe("high");
  });

  it("returns medium for score between MEDIUM and HIGH", () => {
    expect(confidenceLevel(CONFIDENCE_THRESHOLDS.MEDIUM)).toBe("medium");
    expect(confidenceLevel(60)).toBe("medium");
    expect(confidenceLevel(74)).toBe("medium");
  });

  it("returns low for score below MEDIUM threshold", () => {
    expect(confidenceLevel(0)).toBe("low");
    expect(confidenceLevel(10)).toBe("low");
    expect(confidenceLevel(CONFIDENCE_THRESHOLDS.MEDIUM - 1)).toBe("low");
  });
});

// ── buildEnrichedPrompt ─────────────────────────────────────────────────────

describe("buildEnrichedPrompt", () => {
  const contextFiles = [
    { name: "motion_planning", source: "platform", content: "A* algorithm details..." },
    { name: "joint_constraints", source: "private", content: "Joint 1: ±180°..." },
  ];

  it("includes original task", () => {
    const prompt = buildEnrichedPrompt({ task: "设计轨迹规划", contextFiles, confidence: 80, missingDeps: [] });
    expect(prompt).toContain("设计轨迹规划");
  });

  it("includes confidence score", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles, confidence: 75, missingDeps: [] });
    expect(prompt).toContain("75%");
  });

  it("includes all context file names", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles, confidence: 80, missingDeps: [] });
    expect(prompt).toContain("motion_planning");
    expect(prompt).toContain("joint_constraints");
  });

  it("includes missing deps warning when present", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles, confidence: 40, missingDeps: ["材料属性", "热力学参数"] });
    expect(prompt).toContain("材料属性");
    expect(prompt).toContain("热力学参数");
  });

  it("does not include warning when no missing deps", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles, confidence: 90, missingDeps: [] });
    expect(prompt).not.toContain("未找到");
  });

  it("marks PLATFORM vs PRIVATE sources", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles, confidence: 80, missingDeps: [] });
    expect(prompt).toContain("PLATFORM");
    expect(prompt).toContain("PRIVATE");
  });

  it("works with empty context files", () => {
    const prompt = buildEnrichedPrompt({ task: "任务", contextFiles: [], confidence: 0, missingDeps: [] });
    expect(prompt).toContain("任务");
  });
});
