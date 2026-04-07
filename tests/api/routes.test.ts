/**
 * Integration tests for the HTTP API routes.
 * Server must be running on localhost:3001.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3001";

// ── Health check ─────────────────────────────────────────────────────────────

describe("Server health", () => {
  it("responds on port 3001", async () => {
    const res = await fetch(`${BASE}/api/config`);
    expect(res.status).toBeLessThan(500);
  });
});

// ── /api/project/file ─────────────────────────────────────────────────────────

describe("GET /api/project/file", () => {
  const testFile = "/tmp/physmind-project-test.md";

  beforeAll(() => {
    writeFileSync(testFile, "# Test\nHello from test file.");
  });

  it("returns file content for existing file", async () => {
    const res = await fetch(`${BASE}/api/project/file?path=${encodeURIComponent(testFile)}`);
    expect(res.status).toBe(200);
    const data = await res.json() as { content: string };
    expect(data.content).toContain("Hello from test file");
  });

  it("returns error for non-existent file", async () => {
    const res = await fetch(`${BASE}/api/project/file?path=/tmp/no-such-file-xyz.md`);
    const data = await res.json() as { error: string };
    expect(data.error).toBeTruthy();
  });

  it("returns error when path is missing", async () => {
    const res = await fetch(`${BASE}/api/project/file`);
    const data = await res.json() as { error: string };
    expect(data.error).toBeTruthy();
  });
});

describe("PUT /api/project/file", () => {
  const testFile = "/tmp/physmind-put-test.md";

  it("writes content to file", async () => {
    const res = await fetch(`${BASE}/api/project/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: testFile, content: "# Written by test\nContent here." }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it("written content is readable back", async () => {
    const content = `# Test ${Date.now()}`;
    await fetch(`${BASE}/api/project/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: testFile, content }),
    });
    const res = await fetch(`${BASE}/api/project/file?path=${encodeURIComponent(testFile)}`);
    const data = await res.json() as { content: string };
    expect(data.content).toBe(content);
  });

  it("returns error when path is missing", async () => {
    const res = await fetch(`${BASE}/api/project/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no path given" }),
    });
    const data = await res.json() as { error: string };
    expect(data.error).toBeTruthy();
  });
});

// ── /api/brain-index ───────────────────────────────────────────────────────────

describe("GET /api/brain-index", () => {
  it("returns content or null", async () => {
    const res = await fetch(`${BASE}/api/brain-index`);
    expect(res.status).toBe(200);
    const data = await res.json() as { content: string | null };
    expect(data).toHaveProperty("content");
  });
});

describe("PUT /api/brain-index", () => {
  it("saves and retrieves content", async () => {
    const testContent = `# Test Index ${Date.now()}`;
    const putRes = await fetch(`${BASE}/api/brain-index`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: testContent }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${BASE}/api/brain-index`);
    const data = await getRes.json() as { content: string };
    expect(data.content).toBe(testContent);
  });
});

// ── /api/dm/analyze ────────────────────────────────────────────────────────────

describe("POST /api/dm/analyze", () => {
  it("returns SSE stream (text/event-stream)", async () => {
    const res = await fetch(`${BASE}/api/dm/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "test task" }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  }, 30000);

  it("streams at least one data event", async () => {
    const res = await fetch(`${BASE}/api/dm/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "design a robot arm trajectory" }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    let attempts = 0;

    while (attempts++ < 20) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
      if (received.includes("data:")) break;
    }
    reader.cancel();
    expect(received).toContain("data:");
  }, 30000);

  it("emits a report event in the stream (requires ANTHROPIC_API_KEY)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  ⚠ Skipped: ANTHROPIC_API_KEY not set");
      return;
    }
    const res = await fetch(`${BASE}/api/dm/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "设计一个6-DOF机械臂的轨迹规划方案" }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let foundReport = false;

    while (!foundReport) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"type":"report"')) foundReport = true;
    }
    reader.cancel();
    expect(foundReport).toBe(true);
  }, 60000);
});

// ── /api/vault/file ────────────────────────────────────────────────────────────

describe("GET /api/vault/file", () => {
  it("returns error for non-existent file", async () => {
    const res = await fetch(`${BASE}/api/vault/file?path=/tmp/no-such.md`);
    const data = await res.json() as any;
    // Should have error field OR missing content
    expect(Boolean(data.error) || data.content == null).toBe(true);
  });
});

// ── /api/platform/search ────────────────────────────────────────────────────────

describe("GET /api/platform/search", () => {
  it("returns array of results", async () => {
    const res = await fetch(`${BASE}/api/platform/search?q=robot`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("returns empty array for unmatched query", async () => {
    const res = await fetch(`${BASE}/api/platform/search?q=xyzzynonexistentqqq`);
    const data = await res.json() as any[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });
});
