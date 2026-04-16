import { describe, test, expect } from "bun:test";
import {
  ManifestSchema,
  DomainDetectSchema,
  DependencyArraySchema,
  FileMatchSchema,
  BatchMatchSchema,
} from "../../manifest_schema.ts";

// ─── ManifestSchema ───────────────────────────────────────────────────────────

describe("ManifestSchema", () => {
  const minimalValid = {
    id: "my-skill",
    name: "My Skill",
    description: "Does something useful",
    version: "1.0.0",
    type: "skill",
  };

  test("accepts a minimal valid manifest", () => {
    const result = ManifestSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("my-skill");
      expect(result.data.type).toBe("skill");
    }
  });

  test("applies defaults for optional fields", () => {
    const result = ManifestSchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modes).toEqual([]);
      expect(result.data.tags).toEqual([]);
      expect(result.data.domain).toBe("");
      expect(result.data.publisher).toBe("");
      expect(result.data.visibility).toBe("private");
      expect(result.data.trust).toBe("untrusted");
      expect(result.data.maturity).toBe("L0");
    }
  });

  test("accepts all four DDTypes", () => {
    for (const type of ["skill", "knowledge", "connector", "memory"] as const) {
      const result = ManifestSchema.safeParse({ ...minimalValid, type });
      expect(result.success).toBe(true);
    }
  });

  test("rejects unknown type", () => {
    const result = ManifestSchema.safeParse({ ...minimalValid, type: "wizard" });
    expect(result.success).toBe(false);
  });

  test("accepts all valid modes", () => {
    const modes = ["tool_wrapper", "generator", "reviewer", "inversion", "pipeline"];
    const result = ManifestSchema.safeParse({ ...minimalValid, modes });
    expect(result.success).toBe(true);
  });

  test("rejects unknown mode in array", () => {
    const result = ManifestSchema.safeParse({ ...minimalValid, modes: ["generator", "unknown-mode"] });
    expect(result.success).toBe(false);
  });

  test("validates semver version", () => {
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "1.0.0" }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "0.0.1" }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "10.20.30" }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "v1.0.0" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "1.0" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...minimalValid, version: "not-a-version" }).success).toBe(false);
  });

  test("requires non-empty id, name, description", () => {
    expect(ManifestSchema.safeParse({ ...minimalValid, id: "" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...minimalValid, name: "" }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...minimalValid, description: "" }).success).toBe(false);
  });

  test("accepts all trust levels", () => {
    for (const trust of ["untrusted", "reviewed", "org-approved"] as const) {
      const result = ManifestSchema.safeParse({ ...minimalValid, trust });
      expect(result.success).toBe(true);
    }
  });

  test("accepts all maturity levels", () => {
    for (const maturity of ["L0", "L1", "L2", "L3"] as const) {
      const result = ManifestSchema.safeParse({ ...minimalValid, maturity });
      expect(result.success).toBe(true);
    }
  });

  test("accepts all visibility values", () => {
    for (const visibility of ["public", "private", "org"] as const) {
      const result = ManifestSchema.safeParse({ ...minimalValid, visibility });
      expect(result.success).toBe(true);
    }
  });

  test("rejects missing required fields", () => {
    const { id, ...noId } = minimalValid;
    expect(ManifestSchema.safeParse(noId).success).toBe(false);

    const { version, ...noVersion } = minimalValid;
    expect(ManifestSchema.safeParse(noVersion).success).toBe(false);
  });

  test("accepts trigger with intents array", () => {
    const result = ManifestSchema.safeParse({
      ...minimalValid,
      trigger: {
        intents: ["convert annotations", "process images"],
        preconditions: ["input files present"],
        scoringHints: { halcon: 1.5 },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts executionPolicy for runtime: none", () => {
    const result = ManifestSchema.safeParse({
      ...minimalValid,
      executionPolicy: {
        runtime: "none",
        allowNetwork: false,
        allowSideEffects: false,
        allowFileWrite: false,
        requiresApproval: false,
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts executionPolicy for runtime: python", () => {
    const result = ManifestSchema.safeParse({
      ...minimalValid,
      executionPolicy: {
        runtime: "python",
        entrypoint: "main.py",
        allowNetwork: false,
        allowSideEffects: true,
        allowFileWrite: true,
        requiresApproval: false,
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown runtime", () => {
    const result = ManifestSchema.safeParse({
      ...minimalValid,
      executionPolicy: {
        runtime: "ruby",
        allowNetwork: false,
        allowSideEffects: false,
        allowFileWrite: false,
        requiresApproval: false,
      },
    });
    expect(result.success).toBe(false);
  });

  test("accepts resourceIndex with mixed arrays", () => {
    const result = ManifestSchema.safeParse({
      ...minimalValid,
      resourceIndex: {
        entryDocs: ["SKILL.md"],
        knowledgeDocs: ["docs/overview.md"],
        executableScripts: ["run.py"],
        tests: ["tests/test_run.py"],
        configFiles: ["decision-dependency.yaml"],
      },
    });
    expect(result.success).toBe(true);
  });

  test("fully valid complex manifest parses correctly", () => {
    const full = {
      id: "halcon-to-coco",
      name: "HALCON to COCO Format Converter",
      description: "Converts HALCON machine vision annotations to COCO JSON",
      version: "1.0.0",
      type: "skill",
      modes: ["generator", "tool_wrapper"],
      tags: ["halcon", "coco", "annotation"],
      domain: "computer-vision",
      publisher: "mindact-examples",
      visibility: "public",
      trust: "reviewed",
      maturity: "L2",
      trigger: {
        intents: ["convert HALCON to COCO", "machine vision annotation conversion"],
        preconditions: ["HALCON export files present"],
      },
      executionPolicy: {
        runtime: "python",
        entrypoint: "convert.py",
        allowNetwork: false,
        allowSideEffects: true,
        allowFileWrite: true,
        requiresApproval: false,
      },
    };

    const result = ManifestSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("halcon-to-coco");
      expect(result.data.modes).toContain("generator");
      expect(result.data.trust).toBe("reviewed");
    }
  });
});

// ─── DomainDetectSchema ───────────────────────────────────────────────────────

describe("DomainDetectSchema", () => {
  test("accepts valid domain detection output", () => {
    const result = DomainDetectSchema.safeParse({
      is_domain_specific: true,
      domain: "robotics",
      reason: "Task involves kinematics",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe("robotics");
    }
  });

  test("transforms null domain to empty string", () => {
    const result = DomainDetectSchema.safeParse({
      is_domain_specific: false,
      domain: null,
      reason: "General task",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe("");
    }
  });

  test("applies default empty reason", () => {
    const result = DomainDetectSchema.safeParse({
      is_domain_specific: true,
      domain: "robotics",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("");
    }
  });

  test("rejects non-boolean is_domain_specific", () => {
    const result = DomainDetectSchema.safeParse({
      is_domain_specific: "yes",
      domain: "robotics",
    });
    expect(result.success).toBe(false);
  });
});

// ─── DependencyArraySchema ────────────────────────────────────────────────────

describe("DependencyArraySchema", () => {
  test("accepts valid dependency list", () => {
    const result = DependencyArraySchema.safeParse({
      dependencies: [
        { name: "Kinematics", description: "Robot kinematics formulas", level: "critical" },
        { name: "Joint Limits", description: "Per-model joint constraints", level: "helpful" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toHaveLength(2);
      expect(result.data.dependencies[0].level).toBe("critical");
    }
  });

  test("defaults level to helpful", () => {
    const result = DependencyArraySchema.safeParse({
      dependencies: [{ name: "Docs" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies[0].level).toBe("helpful");
    }
  });

  test("defaults to empty array when missing", () => {
    const result = DependencyArraySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toEqual([]);
    }
  });

  test("rejects unknown level", () => {
    const result = DependencyArraySchema.safeParse({
      dependencies: [{ name: "X", level: "mandatory" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty name", () => {
    const result = DependencyArraySchema.safeParse({
      dependencies: [{ name: "" }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── FileMatchSchema ──────────────────────────────────────────────────────────

describe("FileMatchSchema", () => {
  test("accepts valid file coverage output", () => {
    const result = FileMatchSchema.safeParse({
      covered: [
        { dependency: "Kinematics", coverage: "full" },
        { dependency: "Joint Limits", coverage: "partial" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.covered).toHaveLength(2);
    }
  });

  test("defaults coverage to partial", () => {
    const result = FileMatchSchema.safeParse({
      covered: [{ dependency: "X" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.covered[0].coverage).toBe("partial");
    }
  });

  test("defaults to empty covered array", () => {
    const result = FileMatchSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.covered).toEqual([]);
    }
  });

  test("rejects unknown coverage value", () => {
    const result = FileMatchSchema.safeParse({
      covered: [{ dependency: "X", coverage: "maybe" }],
    });
    expect(result.success).toBe(false);
  });
});

// ─── BatchMatchSchema ─────────────────────────────────────────────────────────

describe("BatchMatchSchema", () => {
  test("accepts valid batch match output", () => {
    const result = BatchMatchSchema.safeParse({
      matches: [
        {
          dependency: "Kinematics KB",
          level: "critical",
          covered_by: ["kinematics/forward.md"],
          coverage: "full",
        },
        {
          dependency: "Motion Planning",
          level: "helpful",
          covered_by: [],
          coverage: "none",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matches).toHaveLength(2);
      expect(result.data.matches[0].coverage).toBe("full");
    }
  });

  test("defaults to empty matches array", () => {
    const result = BatchMatchSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matches).toEqual([]);
    }
  });

  test("applies defaults for level, covered_by, coverage", () => {
    const result = BatchMatchSchema.safeParse({
      matches: [{ dependency: "X" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const m = result.data.matches[0];
      expect(m.level).toBe("helpful");
      expect(m.covered_by).toEqual([]);
      expect(m.coverage).toBe("none");
    }
  });
});
