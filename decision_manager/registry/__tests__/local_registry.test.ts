import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadLocalRegistry, getLocalContent } from "../local_registry.ts";
import type { DecisionDependency } from "../../types.ts";

// ─── Test Fixture Helpers ─────────────────────────────────────────────────────

function makeSkillDir(root: string, name: string, opts: {
  skillMd?: string;
  manifest?: string;
} = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });

  if (opts.skillMd !== undefined) {
    writeFileSync(join(dir, "SKILL.md"), opts.skillMd);
  }
  if (opts.manifest !== undefined) {
    writeFileSync(join(dir, "decision-dependency.yaml"), opts.manifest);
  }
  return dir;
}

const MINIMAL_SKILL_MD = `---
name: My Test Skill
description: A skill for testing
domain: test
tags: [unit-test, example]
version: 1.2.3
---

# My Test Skill

This is the body content.
`;

const FULL_MANIFEST = `
id: test-skill-id
name: Full Manifest Skill
description: Has a complete manifest
version: 2.0.0
type: skill
modes:
  - generator
tags:
  - full
  - manifest
domain: testing
publisher: test-publisher
visibility: public
trust: reviewed
maturity: L2
trigger:
  intents:
    - run tests
    - execute test suite
executionPolicy:
  runtime: python
  entrypoint: run.py
  allowNetwork: false
  allowSideEffects: false
  allowFileWrite: false
  requiresApproval: false
`;

const KNOWLEDGE_MANIFEST = `
id: my-knowledge-pack
name: Knowledge Pack
description: A knowledge base
version: 0.1.0
type: knowledge
modes:
  - reviewer
tags:
  - docs
domain: documentation
publisher: docs-team
visibility: public
trust: untrusted
maturity: L1
executionPolicy:
  runtime: none
  allowNetwork: false
  allowSideEffects: false
  allowFileWrite: false
  requiresApproval: false
`;

// ─── Test Suite ───────────────────────────────────────────────────────────────

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "local-registry-test-"));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadLocalRegistry", () => {
  test("returns [] for a non-existent directory", async () => {
    const result = await loadLocalRegistry("/does/not/exist/anywhere");
    expect(result).toEqual([]);
  });

  test("returns [] for an empty directory", async () => {
    const emptyDir = mkdtempSync(join(tmpRoot, "empty-"));
    const result = await loadLocalRegistry(emptyDir);
    expect(result).toEqual([]);
  });

  test("skips directories with no SKILL.md", async () => {
    const dir = mkdtempSync(join(tmpRoot, "no-skill-"));
    mkdirSync(join(dir, "bare-dir"));
    writeFileSync(join(dir, "bare-dir", "some-file.txt"), "hello");
    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(0);
  });

  test("loads a skill from SKILL.md frontmatter when no manifest", async () => {
    const dir = mkdtempSync(join(tmpRoot, "skill-only-"));
    makeSkillDir(dir, "my-skill", { skillMd: MINIMAL_SKILL_MD });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(1);

    const dd = result[0];
    expect(dd.id).toBe("my-skill"); // falls back to directory name
    expect(dd.name).toBe("My Test Skill");
    expect(dd.description).toBe("A skill for testing");
    expect(dd.domain).toBe("test");
    expect(dd.tags).toContain("unit-test");
    expect(dd.version).toBe("1.2.3");
    expect(dd.type).toBe("skill"); // default
    expect(dd.trust).toBe("untrusted"); // default
    expect(dd.source.type).toBe("local");
    expect(dd.content).toBeUndefined(); // lazy — not yet loaded
  });

  test("manifest fields override SKILL.md frontmatter", async () => {
    const dir = mkdtempSync(join(tmpRoot, "manifest-override-"));
    makeSkillDir(dir, "my-skill", {
      skillMd: MINIMAL_SKILL_MD,
      manifest: FULL_MANIFEST,
    });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(1);

    const dd = result[0];
    expect(dd.id).toBe("test-skill-id");           // from manifest
    expect(dd.name).toBe("Full Manifest Skill");    // from manifest
    expect(dd.version).toBe("2.0.0");              // from manifest
    expect(dd.type).toBe("skill");
    expect(dd.trust).toBe("reviewed");             // from manifest
    expect(dd.maturity).toBe("L2");                // from manifest
    expect(dd.publisher).toBe("test-publisher");
    expect(dd.visibility).toBe("public");
    expect(dd.modes).toContain("generator");
    expect(dd.executionPolicy?.runtime).toBe("python");
    expect(dd.trigger?.intents).toContain("run tests");
  });

  test("loads a knowledge type from manifest", async () => {
    const dir = mkdtempSync(join(tmpRoot, "knowledge-"));
    makeSkillDir(dir, "kb-pack", {
      skillMd: MINIMAL_SKILL_MD,
      manifest: KNOWLEDGE_MANIFEST,
    });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("knowledge");
    expect(result[0].executionPolicy?.runtime).toBe("none");
  });

  test("loads multiple skill directories", async () => {
    const dir = mkdtempSync(join(tmpRoot, "multi-"));
    makeSkillDir(dir, "skill-a", { skillMd: MINIMAL_SKILL_MD });
    makeSkillDir(dir, "skill-b", { skillMd: MINIMAL_SKILL_MD });
    makeSkillDir(dir, "skill-c", { skillMd: MINIMAL_SKILL_MD });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(3);
    const ids = result.map(d => d.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b", "skill-c"]);
  });

  test("normalizes unknown type to 'skill'", async () => {
    const dir = mkdtempSync(join(tmpRoot, "unknown-type-"));
    const badManifest = FULL_MANIFEST.replace("type: skill", "type: widget");
    makeSkillDir(dir, "weird-skill", {
      skillMd: MINIMAL_SKILL_MD,
      manifest: badManifest,
    });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("skill"); // normalized
  });

  test("normalizes unknown trust to 'untrusted'", async () => {
    const dir = mkdtempSync(join(tmpRoot, "bad-trust-"));
    const badManifest = FULL_MANIFEST.replace("trust: reviewed", "trust: super-trusted");
    makeSkillDir(dir, "bad-trust-skill", {
      skillMd: MINIMAL_SKILL_MD,
      manifest: badManifest,
    });

    const result = await loadLocalRegistry(dir);
    expect(result).toHaveLength(1);
    expect(result[0].trust).toBe("untrusted"); // normalized
  });

  test("sets installedAt timestamp", async () => {
    const dir = mkdtempSync(join(tmpRoot, "ts-"));
    makeSkillDir(dir, "timestamped", { skillMd: MINIMAL_SKILL_MD });

    const result = await loadLocalRegistry(dir);
    expect(result[0].installedAt).toBeDefined();
    expect(new Date(result[0].installedAt!).getTime()).not.toBeNaN();
  });

  test("source path points to the skill directory", async () => {
    const dir = mkdtempSync(join(tmpRoot, "src-path-"));
    makeSkillDir(dir, "path-skill", { skillMd: MINIMAL_SKILL_MD });

    const result = await loadLocalRegistry(dir);
    const dd = result[0];
    expect(dd.source.type).toBe("local");
    if (dd.source.type === "local") {
      expect(dd.source.path).toContain("path-skill");
    }
  });
});

describe("getLocalContent", () => {
  test("returns SKILL.md body (without frontmatter)", async () => {
    const dir = mkdtempSync(join(tmpRoot, "content-"));
    makeSkillDir(dir, "content-skill", { skillMd: MINIMAL_SKILL_MD });

    const skills = await loadLocalRegistry(dir);
    const body = await getLocalContent(skills[0]);
    expect(body).toContain("This is the body content.");
    expect(body).not.toContain("name: My Test Skill"); // frontmatter stripped
  });

  test("returns empty string if SKILL.md missing", async () => {
    const dd: DecisionDependency = {
      id: "no-file",
      version: "1.0.0",
      type: "skill",
      modes: [],
      name: "No File",
      description: "Missing file",
      tags: [],
      domain: "",
      source: { type: "local", path: "/tmp/definitely-does-not-exist-xyz" },
      publisher: "",
      visibility: "private",
      trust: "untrusted",
      maturity: "L0",
    };
    const body = await getLocalContent(dd);
    expect(body).toBe("");
  });

  test("throws for non-local source", async () => {
    const dd: DecisionDependency = {
      id: "remote-skill",
      version: "1.0.0",
      type: "skill",
      modes: [],
      name: "Remote",
      description: "Remote package",
      tags: [],
      domain: "",
      source: { type: "remote", registryUrl: "https://example.com", id: "remote-skill" },
      publisher: "",
      visibility: "public",
      trust: "untrusted",
      maturity: "L0",
    };
    await expect(getLocalContent(dd)).rejects.toThrow("local source");
  });
});
