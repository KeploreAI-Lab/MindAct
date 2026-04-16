import { describe, test, expect, mock, beforeEach } from "bun:test";

// We test the pure helper functions by extracting them via the module.
// previewGitHubImport itself makes network calls — we test its parsing logic
// by mocking global fetch.

// Import the module under test — this gives access to all exports
import {
  previewGitHubImport,
  type GitHubImportRequest,
  type GitHubImportPreview,
  type FileClassification,
} from "../github_import.ts";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

function makeFetchMock(responses: {
  pattern: string | RegExp;
  status: number;
  body: unknown;
}[]) {
  return mock(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const r of responses) {
      const matches = typeof r.pattern === "string"
        ? urlStr.includes(r.pattern)
        : r.pattern.test(urlStr);
      if (matches) {
        return new Response(JSON.stringify(r.body), { status: r.status });
      }
    }
    return new Response("Not found", { status: 404 });
  });
}

// ─── Sample GitHub tree fixture ────────────────────────────────────────────────

const SINGLE_SKILL_TREE = {
  sha: "abc123",
  truncated: false,
  tree: [
    { type: "blob", path: "SKILL.md", sha: "s1", size: 512 },
    { type: "blob", path: "convert.py", sha: "s2", size: 1024 },
    { type: "blob", path: "decision-dependency.yaml", sha: "s3", size: 256 },
    { type: "blob", path: "tests/test_convert.py", sha: "s4", size: 512 },
    { type: "blob", path: "README.md", sha: "s5", size: 256 },
  ],
};

const MULTI_SKILL_TREE = {
  sha: "def456",
  truncated: false,
  tree: [
    { type: "blob", path: "skill-a/SKILL.md", sha: "a1", size: 512 },
    { type: "blob", path: "skill-a/run.py", sha: "a2", size: 1024 },
    { type: "blob", path: "skill-b/SKILL.md", sha: "b1", size: 512 },
    { type: "blob", path: "skill-b/process.ts", sha: "b2", size: 1024 },
    { type: "blob", path: "skill-b/tests/test_process.ts", sha: "b3", size: 256 },
    { type: "blob", path: "knowledge-pack/overview.md", sha: "k1", size: 256 },
    { type: "blob", path: "knowledge-pack/details.md", sha: "k2", size: 512 },
    { type: "blob", path: "README.md", sha: "r1", size: 256 },
  ],
};

const KNOWLEDGE_ONLY_TREE = {
  sha: "ghi789",
  truncated: false,
  tree: [
    { type: "blob", path: "kinematics.md", sha: "k1", size: 512 },
    { type: "blob", path: "joint-limits.md", sha: "k2", size: 1024 },
    { type: "blob", path: "README.md", sha: "r1", size: 256 },
  ],
};

const REF_RESPONSE = {
  object: { sha: "commit-sha-1234" },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("previewGitHubImport — single-skill repo", () => {
  test("returns one candidate with correct maturity", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: SINGLE_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/single-skill",
        ref: "main",
      });

      expect(result.candidates).toHaveLength(1);
      const c = result.candidates[0];

      // L3: has manifest + tests
      expect(c.maturity).toBe("L3");
      expect(c.draft.trust).toBe("untrusted"); // ALWAYS untrusted
      expect(c.draft.type).toBe("skill");       // has SKILL.md
      expect(c.confidence).toBeGreaterThan(0.5);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("sets repoMeta correctly", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: SINGLE_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/single-skill",
        ref: "main",
      });

      expect(result.repoMeta.url).toBe("https://github.com/owner/single-skill");
      expect(result.repoMeta.ref).toBe("main");
      expect(result.repoMeta.commitSha).toBe("commit-sha-1234");
      expect(result.repoMeta.importHash).toHaveLength(16); // hex slice
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("provenance is set on draft", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: SINGLE_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/single-skill",
        ref: "main",
      });

      const c = result.candidates[0];
      expect(c.draft.provenance).toBeDefined();
      expect(c.draft.provenance?.importedFrom?.repoUrl).toBe("https://github.com/owner/single-skill");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("previewGitHubImport — multi-skill repo", () => {
  test("returns multiple candidates for repos with multiple SKILL.md files", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: MULTI_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/multi-skills",
        ref: "main",
      });

      // Should find skill-a and skill-b candidates (both have SKILL.md)
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      const candidateIds = result.candidates.map(c => c.draft.id);
      expect(candidateIds.some(id => id.includes("skill-a"))).toBe(true);
      expect(candidateIds.some(id => id.includes("skill-b"))).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("all candidates have trust: untrusted", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: MULTI_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/multi-skills",
        ref: "main",
      });

      for (const c of result.candidates) {
        expect(c.draft.trust).toBe("untrusted");
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("previewGitHubImport — knowledge-only repo", () => {
  test("infers type: knowledge when no SKILL.md", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: KNOWLEDGE_ONLY_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/knowledge-repo",
        ref: "main",
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].draft.type).toBe("knowledge");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("previewGitHubImport — error handling", () => {
  test("throws on invalid GitHub URL", async () => {
    await expect(previewGitHubImport({
      repoUrl: "https://gitlab.com/owner/repo",
      ref: "main",
    })).rejects.toThrow("Invalid GitHub URL");
  });

  test("throws when GitHub tree API returns 404", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 404, body: { message: "Not Found" } },
    ]) as typeof fetch;

    try {
      await expect(previewGitHubImport({
        repoUrl: "https://github.com/owner/nonexistent",
        ref: "main",
      })).rejects.toThrow("GitHub tree fetch failed");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("proceeds without commitSha if ref resolution fails", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 404, body: { message: "Not Found" } },
      { pattern: /\/git\/trees\//, status: 200, body: SINGLE_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/fallback-ref",
        ref: "main",
      });

      // Should still return candidates; commitSha may be undefined
      expect(result.candidates).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("maturity inference", () => {
  // Test the maturity logic via previewGitHubImport outputs

  test("L0 — no SKILL.md, no knowledge docs", async () => {
    const noDocsTree = {
      sha: "x", truncated: false,
      tree: [
        { type: "blob", path: "main.py", sha: "p1", size: 100 },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: noDocsTree },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/l0-repo", ref: "main",
      });
      expect(result.candidates[0].maturity).toBe("L0");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("L1 — has README.md only", async () => {
    const l1Tree = {
      sha: "x", truncated: false,
      tree: [
        { type: "blob", path: "README.md", sha: "r1", size: 100 },
        { type: "blob", path: "knowledge.md", sha: "k1", size: 100 },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: l1Tree },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/l1-repo", ref: "main",
      });
      expect(result.candidates[0].maturity).toBe("L1");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("L3 — has manifest + tests", async () => {
    const l3Tree = {
      sha: "x", truncated: false,
      tree: [
        { type: "blob", path: "SKILL.md", sha: "s1", size: 100 },
        { type: "blob", path: "decision-dependency.yaml", sha: "m1", size: 100 },
        { type: "blob", path: "tests/test_skill.py", sha: "t1", size: 100 },
      ],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: l3Tree },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/owner/l3-repo", ref: "main",
      });
      expect(result.candidates[0].maturity).toBe("L3");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("candidate id generation", () => {
  test("uses owner-repo for root-level candidate", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = makeFetchMock([
      { pattern: /\/git\/ref\//, status: 200, body: REF_RESPONSE },
      { pattern: /\/git\/trees\//, status: 200, body: SINGLE_SKILL_TREE },
    ]) as typeof fetch;

    try {
      const result = await previewGitHubImport({
        repoUrl: "https://github.com/my-org/cool-skill",
        ref: "main",
      });
      expect(result.candidates[0].draft.id).toContain("my-org");
      expect(result.candidates[0].draft.id).toContain("cool-skill");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
