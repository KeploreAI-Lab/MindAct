/**
 * Tests for the dependency_analysis task.
 * Mocks aiCall so no real API key is needed.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";

// ── Mock ai_client via mock.module ──────────────────────────────────────────

function fakeAiCall(opts: { messages: { content: string }[] }): Promise<string> {
  const lastMsg = opts.messages[opts.messages.length - 1].content;

  if (lastMsg.includes("is_domain_specific")) {
    if (lastMsg.includes("机械臂") || lastMsg.includes("路径规划") || lastMsg.includes("6-DOF")) {
      return Promise.resolve(JSON.stringify({ is_domain_specific: true, domain: "机器人工程", reason: "涉及机械臂运动规划" }));
    }
    return Promise.resolve(JSON.stringify({ is_domain_specific: false, domain: null, reason: "普通任务" }));
  }
  if (lastMsg.includes("dependencies") && lastMsg.includes("critical")) {
    return Promise.resolve(JSON.stringify({
      dependencies: [
        { name: "路径规划算法", description: "需要路径规划算法", level: "critical" },
        { name: "关节约束", description: "关节限位参数", level: "critical" },
        { name: "控制器参数", description: "控制器配置", level: "helpful" },
      ],
    }));
  }
  if (lastMsg.includes("covered_by")) {
    return Promise.resolve(JSON.stringify({
      matches: [
        { dependency: "路径规划算法", level: "critical", covered_by: ["motion_planning"], coverage: "full" },
        { dependency: "关节约束",     level: "critical", covered_by: ["joint_constraints"], coverage: "partial" },
        { dependency: "控制器参数",   level: "helpful",  covered_by: [], coverage: "none" },
      ],
    }));
  }
  return Promise.resolve("{}");
}

mock.module("../../decision_manager/ai_client", () => ({
  aiCall: fakeAiCall,
  aiStream: async () => {},
  DEFAULT_MODEL: "claude-sonnet-4-6",
  DEFAULT_MAX_TOKENS: 4096,
}));

import { analyzeDependencies } from "../../decision_manager/tasks/dependency_analysis";

const PLATFORM = "/tmp/physmind-test-vault/platform";
const PRIVATE  = "/tmp/physmind-test-vault/private";

// ── analyzeDependencies ─────────────────────────────────────────────────────

describe("analyzeDependencies — domain-specific task", () => {
  let events: { type: string; data: unknown }[] = [];
  let logMessages: string[] = [];

  beforeEach(async () => {
    events = [];
    logMessages = [];
  });

  const runAnalysis = (task: string) =>
    analyzeDependencies({
      task,
      vaultPath: PRIVATE,
      platformDir: PLATFORM,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "log") logMessages.push(e.data as string);
      },
    });

  it("emits log events during analysis", async () => {
    await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(logMessages.length).toBeGreaterThan(3);
  });

  it("emits a report event", async () => {
    await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    const reportEvent = events.find(e => e.type === "report");
    expect(reportEvent).toBeTruthy();
  });

  it("report has correct structure", async () => {
    const report = await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(report.task).toBe("设计一个6-DOF机械臂的路径规划方案");
    expect(report.isDomainSpecific).toBe(true);
    expect(report.domain).toBeTruthy();
    expect(Array.isArray(report.dependencies)).toBe(true);
    expect(typeof report.confidence).toBe("number");
    expect(["high", "medium", "low"]).toContain(report.confidenceLevel);
    expect(typeof report.enrichedPrompt).toBe("string");
  });

  it("confidence is between 0 and 100", async () => {
    const report = await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(report.confidence).toBeGreaterThanOrEqual(0);
    expect(report.confidence).toBeLessThanOrEqual(100);
  });

  it("foundFiles includes matched file names", async () => {
    const report = await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(report.foundFiles).toContain("motion_planning");
    expect(report.foundFiles).toContain("joint_constraints");
  });

  it("missingDeps includes unmatched dependency names", async () => {
    const report = await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(report.missingDeps).toContain("控制器参数");
  });

  it("emits highlight event with found/missing nodes", async () => {
    await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    const hlEvent = events.find(e => e.type === "highlight");
    expect(hlEvent).toBeTruthy();
    const hl = hlEvent!.data as { nodes: { id: string; status: string }[] };
    expect(Array.isArray(hl.nodes)).toBe(true);
  });

  it("enrichedPrompt contains original task", async () => {
    const task = "设计一个6-DOF机械臂的路径规划方案";
    const report = await runAnalysis(task);
    expect(report.enrichedPrompt).toContain(task);
  });

  it("enrichedPrompt contains context file names", async () => {
    const report = await runAnalysis("设计一个6-DOF机械臂的路径规划方案");
    expect(report.enrichedPrompt).toContain("motion_planning");
  });
});

describe("analyzeDependencies — non-domain task", () => {
  it("returns isDomainSpecific=false for generic task", async () => {
    const report = await analyzeDependencies({
      task: "写一首关于春天的诗",
      vaultPath: PRIVATE,
      platformDir: PLATFORM,
      onEvent: () => {},
    });
    expect(report.isDomainSpecific).toBe(false);
    expect(report.confidence).toBe(100);
    expect(report.enrichedPrompt).toBe("写一首关于春天的诗");
  });
});

describe("analyzeDependencies — empty vault", () => {
  it("returns low confidence when vault is empty", async () => {
    const report = await analyzeDependencies({
      task: "设计一个6-DOF机械臂的路径规划方案",
      vaultPath: "/tmp/nonexistent-vault",
      platformDir: "/tmp/nonexistent-platform",
      onEvent: () => {},
    });
    expect(report.confidence).toBe(0);
    expect(report.confidenceLevel).toBe("low");
  });
});
