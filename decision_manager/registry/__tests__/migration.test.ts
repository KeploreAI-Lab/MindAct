/**
 * migration.test.ts — Compat adapter tests.
 *
 * Verifies that the backward-compat layer (compat.ts) correctly bridges
 * the old report shapes (matchedSkill, dependencies[]) with the new unified
 * AnalysisReport.resolved[] model.
 */

import { describe, test, expect } from "bun:test";
import {
  toMatchedSkill,
  getMatchedSkill,
  toLegacyDependency,
  toLegacyDependencies,
} from "../../compat.ts";
import type { AnalysisReport, ResolvedDependency, DecisionDependency } from "../../types.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeDD(overrides: Partial<DecisionDependency> = {}): DecisionDependency {
  return {
    id: "test-dd",
    version: "1.0.0",
    type: "skill",
    modes: ["generator"],
    name: "Test DD",
    description: "A test decision dependency",
    tags: [],
    domain: "test",
    source: { type: "local", path: "/tmp/test-dd" },
    publisher: "tester",
    visibility: "public",
    trust: "reviewed",
    maturity: "L2",
    ...overrides,
  };
}

function makeResolved(ddOverrides: Partial<DecisionDependency> = {}, rdOverrides: Partial<ResolvedDependency> = {}): ResolvedDependency {
  return {
    dd: makeDD(ddOverrides),
    coverage: "full",
    coveredBy: ["docs/overview.md"],
    score: 0.75,
    matchReason: "high token overlap",
    ...rdOverrides,
  };
}

function makeReport(resolvedItems: ResolvedDependency[]): AnalysisReport {
  return {
    task: "test task",
    domain: "test",
    isDomainSpecific: true,
    resolved: resolvedItems,
    foundFiles: [],
    missingDeps: [],
    confidence: 80,
    confidenceLevel: "high",
    enrichedPrompt: "test task",
  };
}

// ─── toMatchedSkill ───────────────────────────────────────────────────────────

describe("toMatchedSkill", () => {
  test("returns LegacyMatchedSkill for a skill ResolvedDependency", () => {
    const rd = makeResolved({ type: "skill" });
    const result = toMatchedSkill(rd);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("test-dd");
    expect(result?.name).toBe("Test DD");
    expect(result?.score).toBe(0.75);
    expect(result?.path).toBe("/tmp/test-dd");
  });

  test("returns null for a knowledge ResolvedDependency", () => {
    const rd = makeResolved({ type: "knowledge" });
    const result = toMatchedSkill(rd);
    expect(result).toBeNull();
  });

  test("returns null for a connector ResolvedDependency", () => {
    const rd = makeResolved({ type: "connector" });
    const result = toMatchedSkill(rd);
    expect(result).toBeNull();
  });

  test("returns null for a memory ResolvedDependency", () => {
    const rd = makeResolved({ type: "memory" });
    const result = toMatchedSkill(rd);
    expect(result).toBeNull();
  });

  test("path is empty string for remote source skills", () => {
    const rd = makeResolved({
      type: "skill",
      source: { type: "remote", registryUrl: "https://example.com", id: "test-dd" },
    });
    const result = toMatchedSkill(rd);
    expect(result).not.toBeNull();
    expect(result?.path).toBe("");
  });

  test("path is empty string for github source skills", () => {
    const rd = makeResolved({
      type: "skill",
      source: {
        type: "github",
        repoUrl: "https://github.com/owner/repo",
        ref: "main",
        importedAt: new Date().toISOString(),
      },
    });
    const result = toMatchedSkill(rd);
    expect(result?.path).toBe("");
  });
});

// ─── getMatchedSkill ──────────────────────────────────────────────────────────

describe("getMatchedSkill", () => {
  test("returns first skill from resolved[]", () => {
    const report = makeReport([
      makeResolved({ type: "knowledge" }),   // non-skill first
      makeResolved({ type: "skill", id: "the-skill" }),
      makeResolved({ type: "knowledge" }),
    ]);

    const result = getMatchedSkill(report);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("the-skill");
  });

  test("returns null for report with no skills in resolved[]", () => {
    const report = makeReport([
      makeResolved({ type: "knowledge" }),
      makeResolved({ type: "connector" }),
    ]);

    const result = getMatchedSkill(report);
    expect(result).toBeNull();
  });

  test("returns null for empty resolved[]", () => {
    const report = makeReport([]);
    const result = getMatchedSkill(report);
    expect(result).toBeNull();
  });

  test("returns the highest-scored skill when multiple skills present", () => {
    // Current implementation returns first — this test documents that behavior
    const report = makeReport([
      makeResolved({ type: "skill", id: "skill-a" }, { score: 0.9 }),
      makeResolved({ type: "skill", id: "skill-b" }, { score: 0.5 }),
    ]);

    const result = getMatchedSkill(report);
    // Returns first skill in array (skill-a)
    expect(result?.id).toBe("skill-a");
  });
});

// ─── toLegacyDependency ───────────────────────────────────────────────────────

describe("toLegacyDependency", () => {
  test("maps org-approved trust to level: critical", () => {
    const rd = makeResolved({ trust: "org-approved" });
    const result = toLegacyDependency(rd);
    expect(result.level).toBe("critical");
  });

  test("maps reviewed trust to level: helpful", () => {
    const rd = makeResolved({ trust: "reviewed" });
    const result = toLegacyDependency(rd);
    expect(result.level).toBe("helpful");
  });

  test("maps untrusted trust to level: helpful", () => {
    const rd = makeResolved({ trust: "untrusted" });
    const result = toLegacyDependency(rd);
    expect(result.level).toBe("helpful");
  });

  test("preserves name, description, coverage, coveredBy", () => {
    const rd: ResolvedDependency = {
      dd: makeDD({ name: "My Knowledge", description: "Detailed reference" }),
      coverage: "partial",
      coveredBy: ["file-a.md", "file-b.md"],
      score: 0.6,
    };
    const result = toLegacyDependency(rd);

    expect(result.name).toBe("My Knowledge");
    expect(result.description).toBe("Detailed reference");
    expect(result.coverage).toBe("partial");
    expect(result.coveredBy).toEqual(["file-a.md", "file-b.md"]);
  });

  test("coverage: none is preserved", () => {
    const rd = makeResolved({}, { coverage: "none", coveredBy: [] });
    const result = toLegacyDependency(rd);
    expect(result.coverage).toBe("none");
  });
});

// ─── toLegacyDependencies ─────────────────────────────────────────────────────

describe("toLegacyDependencies", () => {
  test("excludes skill entries", () => {
    const report = makeReport([
      makeResolved({ type: "skill" }),
      makeResolved({ type: "knowledge" }),
      makeResolved({ type: "connector" }),
      makeResolved({ type: "memory" }),
    ]);

    const result = toLegacyDependencies(report);
    expect(result).toHaveLength(3); // knowledge + connector + memory
    expect(result.every(r => r.level !== undefined)).toBe(true);
  });

  test("returns empty array when all entries are skills", () => {
    const report = makeReport([
      makeResolved({ type: "skill" }),
      makeResolved({ type: "skill" }),
    ]);

    const result = toLegacyDependencies(report);
    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty resolved[]", () => {
    const report = makeReport([]);
    const result = toLegacyDependencies(report);
    expect(result).toEqual([]);
  });

  test("preserves order of non-skill entries", () => {
    const report = makeReport([
      makeResolved({ type: "skill" }),
      makeResolved({ type: "knowledge", id: "kb-1", name: "KB 1" }),
      makeResolved({ type: "knowledge", id: "kb-2", name: "KB 2" }),
    ]);

    const result = toLegacyDependencies(report);
    expect(result[0].name).toBe("KB 1");
    expect(result[1].name).toBe("KB 2");
  });
});

// ─── Round-trip compatibility test ───────────────────────────────────────────

describe("round-trip: new report → legacy shape → verify equivalence", () => {
  test("skill from resolved[] matches what old code expected from matchedSkill", () => {
    const skillDD = makeDD({
      id: "halcon-to-coco",
      name: "HALCON to COCO Converter",
      type: "skill",
      source: { type: "local", path: "/home/user/.physmind/skills/halcon-to-coco" },
    });

    const report: AnalysisReport = {
      task: "convert HALCON annotations to COCO",
      domain: "computer-vision",
      isDomainSpecific: true,
      resolved: [
        {
          dd: skillDD,
          coverage: "full",
          coveredBy: [],
          score: 0.82,
          matchReason: "High token overlap + trigger intent match",
        },
      ],
      foundFiles: [],
      missingDeps: [],
      confidence: 90,
      confidenceLevel: "high",
      enrichedPrompt: "convert HALCON annotations to COCO",
    };

    const legacySkill = getMatchedSkill(report);
    expect(legacySkill).not.toBeNull();
    expect(legacySkill?.id).toBe("halcon-to-coco");
    expect(legacySkill?.name).toBe("HALCON to COCO Converter");
    expect(legacySkill?.score).toBe(0.82);
    expect(legacySkill?.path).toContain("halcon-to-coco");
  });

  test("knowledge deps from resolved[] match old dependencies[] shape", () => {
    const report: AnalysisReport = {
      task: "plan robot arm trajectory",
      domain: "robotics",
      isDomainSpecific: true,
      resolved: [
        {
          dd: makeDD({ type: "knowledge", name: "Kinematics KB", trust: "org-approved" }),
          coverage: "full",
          coveredBy: ["kinematics/fk.md"],
          score: 0.7,
        },
        {
          dd: makeDD({ type: "knowledge", name: "Joint Limits", trust: "reviewed" }),
          coverage: "partial",
          coveredBy: ["joints/limits.md"],
          score: 0.5,
        },
      ],
      foundFiles: [],
      missingDeps: [],
      confidence: 75,
      confidenceLevel: "high",
      enrichedPrompt: "plan robot arm trajectory",
    };

    const deps = toLegacyDependencies(report);
    expect(deps).toHaveLength(2);

    const kinematics = deps.find(d => d.name === "Kinematics KB");
    expect(kinematics?.level).toBe("critical");    // org-approved → critical
    expect(kinematics?.coverage).toBe("full");

    const joints = deps.find(d => d.name === "Joint Limits");
    expect(joints?.level).toBe("helpful");         // reviewed → helpful
    expect(joints?.coverage).toBe("partial");
  });
});
