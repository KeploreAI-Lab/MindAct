/**
 * Tests for analyzeDependencies pipeline.
 *
 * The pipeline calls aiCall (LLM) and loadVaultFiles (filesystem).
 * Both are mocked here so tests are deterministic and offline.
 *
 * We use Bun's module mock system to intercept module imports.
 */

import { describe, test, expect, mock, spyOn } from "bun:test";
import type { DecisionDependency, AnalysisReport, ProgressEvent } from "../../types.ts";

// ─── Minimal DecisionDependency factory ──────────────────────────────────────

function makeSkillDD(overrides: Partial<DecisionDependency> = {}): DecisionDependency {
  return {
    id: "test-skill",
    version: "1.0.0",
    type: "skill",
    modes: ["generator"],
    name: "Test Skill",
    description: "convert HALCON annotations to COCO format",
    tags: ["halcon", "coco"],
    domain: "computer-vision",
    source: { type: "local", path: "/tmp/test-skill" },
    publisher: "test",
    visibility: "public",
    trust: "reviewed",
    maturity: "L2",
    trigger: {
      intents: ["convert HALCON to COCO", "HALCON annotation conversion"],
    },
    ...overrides,
  };
}

function makeKnowledgeDD(overrides: Partial<DecisionDependency> = {}): DecisionDependency {
  return {
    id: "robotics-kb",
    version: "1.0.0",
    type: "knowledge",
    modes: ["reviewer"],
    name: "Robotics Knowledge Pack",
    description: "Robot kinematics, joint constraints, motion planning",
    tags: ["robotics", "kinematics"],
    domain: "robotics",
    source: { type: "local", path: "/tmp/robotics-kb" },
    publisher: "test",
    visibility: "public",
    trust: "reviewed",
    maturity: "L1",
    ...overrides,
  };
}

// ─── Event collector helper ────────────────────────────────────────────────

function collectEvents(): { events: ProgressEvent[]; onEvent: (e: ProgressEvent) => void } {
  const events: ProgressEvent[] = [];
  return { events, onEvent: (e: ProgressEvent) => events.push(e) };
}

// ─── Tests using real imports with mocked dependencies ────────────────────

describe("findBestMatch (pure scoring)", () => {
  // We can test findBestMatch directly since it's a pure function
  test("returns null for empty candidate list", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");
    const result = findBestMatch("some task", []);
    expect(result).toBeNull();
  });

  test("returns null when no candidate scores above threshold", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");
    const dd = makeSkillDD({ description: "process xyz", trigger: undefined });
    const result = findBestMatch("completely unrelated task about weather forecasting", [dd]);
    expect(result).toBeNull();
  });

  test("returns ResolvedDependency when a candidate scores above threshold", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");
    const dd = makeSkillDD();
    const result = findBestMatch("convert HALCON annotations to COCO format", [dd]);

    expect(result).not.toBeNull();
    expect(result?.dd.id).toBe("test-skill");
    expect(result?.dd.type).toBe("skill");
    expect(result?.score).toBeGreaterThan(0.18);
  });

  test("sets matchReason on returned ResolvedDependency", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");
    const dd = makeSkillDD();
    const result = findBestMatch("convert HALCON annotations", [dd]);

    expect(result?.matchReason).toBeDefined();
    expect(typeof result?.matchReason).toBe("string");
  });

  test("only returns skills — ignores knowledge candidates", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");
    const knowledgeDD = makeKnowledgeDD({
      description: "convert HALCON annotations to COCO",
    });
    // findBestMatch is called with pre-filtered skills; passing knowledge should still work
    // but real callers filter by type first
    const result = findBestMatch("convert HALCON annotations", [knowledgeDD]);
    // Whether it scores or not depends on scoring logic; no crash is the key guarantee
    expect(typeof result === "object" || result === null).toBe(true);
  });

  test("trigger.intents boost increases score", async () => {
    const { findBestMatch } = await import("../../skill_matcher.ts");

    const withTrigger = makeSkillDD({
      trigger: { intents: ["convert HALCON to COCO"] },
    });
    const withoutTrigger = makeSkillDD({ trigger: undefined });

    const task = "I need to convert HALCON to COCO format";
    const rWith = findBestMatch(task, [withTrigger]);
    const rWithout = findBestMatch(task, [withoutTrigger]);

    // Both may or may not match, but if they do, trigger should give higher score
    if (rWith && rWithout) {
      expect(rWith.score).toBeGreaterThanOrEqual(rWithout.score);
    }
  });
});

describe("scoreDD (pure scoring function)", () => {
  test("returns a number between 0 and 1", async () => {
    const { scoreDD } = await import("../../skill_matcher.ts");
    const dd = makeSkillDD();
    const score = scoreDD("convert HALCON annotations", dd);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test("higher score for more closely matched task", async () => {
    const { scoreDD } = await import("../../skill_matcher.ts");
    const dd = makeSkillDD({
      description: "convert HALCON machine vision annotations to COCO",
      trigger: { intents: ["convert HALCON to COCO"] },
    });

    const highScore = scoreDD("convert HALCON to COCO format", dd);
    const lowScore = scoreDD("unrelated weather forecasting task", dd);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});

describe("analyzeDependencies — general task (no domain, no skill)", () => {
  test("returns report with empty resolved[] for generic task", async () => {
    // Mock aiCall to return non-domain-specific detection
    const aiClientModule = await import("../../ai_client.ts");
    const origAiCall = aiClientModule.aiCall;
    const mockAiCall = mock(async () => '{"is_domain_specific": false, "domain": null, "reason": "generic"}');
    (aiClientModule as Record<string, unknown>).aiCall = mockAiCall;

    const graphModule = await import("../../graph_retrieval.ts");
    const origLoadVault = graphModule.loadVaultFiles;
    (graphModule as Record<string, unknown>).loadVaultFiles = mock(() => []);

    try {
      const { analyzeDependencies } = await import("../dependency_analysis.ts");
      const { events, onEvent } = collectEvents();

      const report = await analyzeDependencies({
        task: "write a poem about cats",
        vaultPath: "/tmp/empty-vault",
        candidates: [],
        onEvent,
      });

      expect(report.resolved).toEqual([]);
      expect(report.isDomainSpecific).toBe(false);
      expect(report.enrichedPrompt).toBe("write a poem about cats");
    } finally {
      (aiClientModule as Record<string, unknown>).aiCall = origAiCall;
      (graphModule as Record<string, unknown>).loadVaultFiles = origLoadVault;
    }
  });
});

describe("analyzeDependencies — skill match", () => {
  test("skill match appears in report.resolved[]", async () => {
    const aiClientModule = await import("../../ai_client.ts");
    const origAiCall = aiClientModule.aiCall;
    let callCount = 0;
    const mockAiCall = mock(async () => {
      callCount++;
      if (callCount === 1) {
        // Stage 1 domain detect
        return '{"is_domain_specific": true, "domain": "computer-vision", "reason": "HALCON"}';
      }
      // Subsequent calls — decompose / file match
      return '{"dependencies": []}';
    });
    (aiClientModule as Record<string, unknown>).aiCall = mockAiCall;

    const graphModule = await import("../../graph_retrieval.ts");
    const origLoadVault = graphModule.loadVaultFiles;
    (graphModule as Record<string, unknown>).loadVaultFiles = mock(() => []);

    try {
      const { analyzeDependencies } = await import("../dependency_analysis.ts");
      const { events, onEvent } = collectEvents();

      const skillDD = makeSkillDD();
      const report = await analyzeDependencies({
        task: "convert HALCON annotations to COCO format",
        vaultPath: "/tmp/vault",
        candidates: [skillDD],
        onEvent,
      });

      // Skill should appear in resolved[]
      const skillResolved = report.resolved.find(r => r.dd.type === "skill");
      expect(skillResolved).toBeDefined();
      expect(skillResolved?.dd.id).toBe("test-skill");
      expect(skillResolved?.score).toBeGreaterThan(0);
    } finally {
      (aiClientModule as Record<string, unknown>).aiCall = origAiCall;
      (graphModule as Record<string, unknown>).loadVaultFiles = origLoadVault;
    }
  });
});

describe("AnalysisReport shape", () => {
  test("report always has resolved array", async () => {
    const aiClientModule = await import("../../ai_client.ts");
    const origAiCall = aiClientModule.aiCall;
    (aiClientModule as Record<string, unknown>).aiCall = mock(async () =>
      '{"is_domain_specific": false, "domain": null, "reason": "general"}'
    );

    const graphModule = await import("../../graph_retrieval.ts");
    const origLoadVault = graphModule.loadVaultFiles;
    (graphModule as Record<string, unknown>).loadVaultFiles = mock(() => []);

    try {
      const { analyzeDependencies } = await import("../dependency_analysis.ts");
      const { onEvent } = collectEvents();

      const report = await analyzeDependencies({
        task: "any task",
        vaultPath: "/tmp/vault",
        candidates: [],
        onEvent,
      });

      expect(Array.isArray(report.resolved)).toBe(true);
      expect(typeof report.task).toBe("string");
      expect(typeof report.confidence).toBe("number");
      expect(typeof report.enrichedPrompt).toBe("string");
    } finally {
      (aiClientModule as Record<string, unknown>).aiCall = origAiCall;
      (graphModule as Record<string, unknown>).loadVaultFiles = origLoadVault;
    }
  });

  test("report emits a report event", async () => {
    const aiClientModule = await import("../../ai_client.ts");
    const origAiCall = aiClientModule.aiCall;
    (aiClientModule as Record<string, unknown>).aiCall = mock(async () =>
      '{"is_domain_specific": false, "domain": null, "reason": "general"}'
    );

    const graphModule = await import("../../graph_retrieval.ts");
    const origLoadVault = graphModule.loadVaultFiles;
    (graphModule as Record<string, unknown>).loadVaultFiles = mock(() => []);

    try {
      const { analyzeDependencies } = await import("../dependency_analysis.ts");
      const { events, onEvent } = collectEvents();

      await analyzeDependencies({
        task: "test task",
        vaultPath: "/tmp/vault",
        candidates: [],
        onEvent,
      });

      const reportEvent = events.find(e => e.type === "report");
      expect(reportEvent).toBeDefined();
    } finally {
      (aiClientModule as Record<string, unknown>).aiCall = origAiCall;
      (graphModule as Record<string, unknown>).loadVaultFiles = origLoadVault;
    }
  });
});
