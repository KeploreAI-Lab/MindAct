import { describe, it, expect } from "bun:test";
import { loadVaultFiles, retrieveContext } from "../../decision_manager/graph_retrieval";

const PLATFORM = "/tmp/physmind-test-vault/platform";
const PRIVATE  = "/tmp/physmind-test-vault/private";

// ── loadVaultFiles ──────────────────────────────────────────────────────────

describe("loadVaultFiles", () => {
  it("loads platform files with source=platform", () => {
    const files = loadVaultFiles({ vaultPath: "", platformDir: PLATFORM });
    expect(files.every(f => f.source === "platform")).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it("loads private files with source=private", () => {
    const files = loadVaultFiles({ vaultPath: PRIVATE, platformDir: "/tmp/no-platform-xyz" });
    expect(files.every(f => f.source === "private")).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it("loads both platform and private when both paths exist", () => {
    const files = loadVaultFiles({ vaultPath: PRIVATE, platformDir: PLATFORM });
    const sources = new Set(files.map(f => f.source));
    expect(sources.has("platform")).toBe(true);
    expect(sources.has("private")).toBe(true);
  });

  it("returns empty array when both paths missing", () => {
    const files = loadVaultFiles({ vaultPath: "/no/such/path", platformDir: "/no/such/platform" });
    expect(files).toEqual([]);
  });

  it("each file has name, path, content fields", () => {
    const files = loadVaultFiles({ vaultPath: PRIVATE, platformDir: PLATFORM });
    for (const f of files) {
      expect(f.name).toBeTruthy();
      expect(f.path).toBeTruthy();
      expect(typeof f.content).toBe("string");
    }
  });

  it("file name has no .md extension", () => {
    const files = loadVaultFiles({ vaultPath: PRIVATE, platformDir: PLATFORM });
    for (const f of files) {
      expect(f.name.endsWith(".md")).toBe(false);
    }
  });
});

// ── retrieveContext ─────────────────────────────────────────────────────────

describe("retrieveContext", () => {
  const allFiles = loadVaultFiles({ vaultPath: PRIVATE, platformDir: PLATFORM });

  it("returns results with files and totalFiles", () => {
    const result = retrieveContext({ query: "path planning robot", allFiles, topK: 3 });
    expect(result.totalFiles).toBe(allFiles.length);
    expect(Array.isArray(result.files)).toBe(true);
  });

  it("returns at most topK*2 files (with graph expansion)", () => {
    const result = retrieveContext({ query: "motion planning", allFiles, topK: 2 });
    expect(result.files.length).toBeLessThanOrEqual(4);
  });

  it("ranks relevant files higher for motion planning query", () => {
    const result = retrieveContext({ query: "motion planning A* RRT", allFiles, topK: 5 });
    const names = result.files.map(f => f.name);
    expect(names).toContain("motion_planning");
  });

  it("returns empty files for completely unrelated query", () => {
    const result = retrieveContext({ query: "xyzzy foobar qwerty nonexistent", allFiles, topK: 3 });
    expect(result.files.length).toBe(0);
  });

  it("expands graph to include linked files", () => {
    // motion_planning links to robot_kinematics via {{ }}
    const result = retrieveContext({ query: "motion planning A*", allFiles, topK: 1 });
    const names = result.files.map(f => f.name);
    // Either motion_planning or robot_kinematics should appear due to graph expansion
    expect(names.some(n => ["motion_planning", "robot_kinematics"].includes(n))).toBe(true);
  });

  it("works with empty allFiles array", () => {
    const result = retrieveContext({ query: "anything", allFiles: [], topK: 5 });
    expect(result.files).toEqual([]);
    expect(result.totalFiles).toBe(0);
  });

  it("uses topK=5 as default", () => {
    const result = retrieveContext({ query: "robot kinematics planning", allFiles });
    expect(result.files.length).toBeLessThanOrEqual(10); // topK*2
  });
});
