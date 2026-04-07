import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { collectMdFiles, parseLinks, buildIndex } from "../../decision_manager/build_index";

const TMP = "/tmp/physmind-test-build-index";

beforeAll(() => {
  mkdirSync(join(TMP, "sub"), { recursive: true });
  writeFileSync(join(TMP, "a.md"), "# A\n[[b]] and {{ c }}");
  writeFileSync(join(TMP, "b.md"), "# B\nNo links here");
  writeFileSync(join(TMP, "sub", "c.md"), "# C\n[[a]]");
  writeFileSync(join(TMP, ".hidden.md"), "# hidden"); // should be skipped
  writeFileSync(join(TMP, "readme.txt"), "not markdown"); // should be skipped
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── collectMdFiles ─────────────────────────────────────────────────────────

describe("collectMdFiles", () => {
  it("collects all .md files recursively", () => {
    const files = collectMdFiles(TMP);
    expect(files.length).toBe(3); // a.md, b.md, sub/c.md
  });

  it("skips dot-files", () => {
    const files = collectMdFiles(TMP);
    expect(files.some(f => f.includes(".hidden"))).toBe(false);
  });

  it("skips non-.md files", () => {
    const files = collectMdFiles(TMP);
    expect(files.some(f => f.endsWith(".txt"))).toBe(false);
  });

  it("returns empty array for non-existent dir", () => {
    const files = collectMdFiles("/tmp/does-not-exist-xyz");
    expect(files).toEqual([]);
  });

  it("returns empty array for empty dir", () => {
    mkdirSync("/tmp/empty-vault-test", { recursive: true });
    const files = collectMdFiles("/tmp/empty-vault-test");
    expect(files).toEqual([]);
    rmSync("/tmp/empty-vault-test", { recursive: true });
  });
});

// ── parseLinks ─────────────────────────────────────────────────────────────

describe("parseLinks", () => {
  it("parses [[wiki]] links", () => {
    const links = parseLinks("See [[motion_planning]] for details");
    expect(links).toContain("motion_planning");
  });

  it("parses {{ cross }} links", () => {
    const links = parseLinks("Also see {{ robot_kinematics }} here");
    expect(links).toContain("robot_kinematics");
  });

  it("parses mixed links in one document", () => {
    const links = parseLinks("[[a]] and {{ b }} and [[c]]");
    expect(links).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace from link names", () => {
    const links = parseLinks("{{  spaced link  }} and [[ also spaced ]]");
    expect(links).toContain("spaced link");
    expect(links).toContain("also spaced");
  });

  it("returns empty array for content with no links", () => {
    const links = parseLinks("# Heading\nSome text without any links.");
    expect(links).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseLinks("")).toEqual([]);
  });

  it("does not pick up partial brackets", () => {
    const links = parseLinks("[single bracket] and {single brace}");
    expect(links).toEqual([]);
  });

  it("handles multiple links on same line", () => {
    const links = parseLinks("[[a]], [[b]], {{ c }}");
    expect(links.length).toBe(3);
  });
});

// ── buildIndex ─────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  const PLATFORM = "/tmp/physmind-test-vault/platform";
  const PRIVATE  = "/tmp/physmind-test-vault/private";

  it("generates markdown content with expected sections", () => {
    const content = buildIndex({ vaultPath: PRIVATE, platformDir: PLATFORM });
    expect(content).toContain("Brain Index");
    expect(content).toContain("依赖关系图（邻接表）");
    expect(content).toContain("文件索引");
  });

  it("includes platform files in index table", () => {
    const content = buildIndex({ vaultPath: PRIVATE, platformDir: PLATFORM });
    expect(content).toContain("motion_planning");
    expect(content).toContain("robot_kinematics");
  });

  it("includes private files in index table", () => {
    const content = buildIndex({ vaultPath: PRIVATE, platformDir: PLATFORM });
    expect(content).toContain("joint_constraints");
    expect(content).toContain("project_params");
  });

  it("records cross-links in adjacency table", () => {
    const content = buildIndex({ vaultPath: PRIVATE, platformDir: PLATFORM });
    expect(content).toContain("→");
  });

  it("writes file to BRAIN_INDEX_PATH", () => {
    import("../../decision_manager/build_index").then(({ BRAIN_INDEX_PATH }) => {
      expect(existsSync(BRAIN_INDEX_PATH)).toBe(true);
    });
  });

  it("handles empty vault gracefully", () => {
    mkdirSync("/tmp/empty-private", { recursive: true });
    const content = buildIndex({ vaultPath: "/tmp/empty-private", platformDir: PLATFORM });
    expect(content).toContain("暂无 Private 文件");
    rmSync("/tmp/empty-private", { recursive: true });
  });

  it("handles empty platform gracefully", () => {
    mkdirSync("/tmp/empty-platform", { recursive: true });
    const content = buildIndex({ vaultPath: PRIVATE, platformDir: "/tmp/empty-platform" });
    expect(content).toContain("暂无 Platform 文件");
    rmSync("/tmp/empty-platform", { recursive: true });
  });
});
