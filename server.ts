import { serve } from "bun";
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, relative, basename } from "path";
import { homedir } from "os";
import { createRequire } from "module";
// node-pty must be loaded via Node's require (not Bun's) because its native
// addon uses posix_spawnp via spawn-helper, which Bun's loader breaks.
// We shell out to `node` for the PTY worker instead.
const nodeBin = process.env.NODE_PATH || "node";

const CONFIG_DIR = join(homedir(), ".physmind");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const PORT = 3001;

interface Config {
  vault_path: string;
  project_path: string;
  panel_ratio: number;
}

function readConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeConfig(config: Config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

function buildTree(dir: string, exts?: string[], depth = 0, maxDepth = 4): TreeNode[] {
  if (depth > maxDepth) return [];
  const nodes: TreeNode[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue;
    const fullPath = join(dir, name);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      const children = buildTree(fullPath, exts, depth + 1, maxDepth);
      if (children.length > 0 || !exts) {
        nodes.push({ name, path: fullPath, type: "dir", children });
      }
    } else if (!exts || exts.some(e => name.endsWith(e))) {
      nodes.push({ name, path: fullPath, type: "file" });
    }
  }
  return nodes;
}

function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(d, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith(".md")) files.push(full);
    }
  }
  walk(dir);
  return files;
}

function parseLinks(content: string): string[] {
  // Matches both [[wiki]] and {{ cross }} links
  const re = /\[\[([^\]]+)\]\]|\{\{([^}]+)\}\}/g;
  const links: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    links.push((m[1] || m[2]).trim());
  }
  return links;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// PTY management — runs a Node.js worker process that owns node-pty,
// communicating via newline-delimited JSON on stdio.
interface PtySession {
  worker: ReturnType<typeof Bun.spawn>;
  ws: import("bun").ServerWebSocket<unknown>;
}

const ptySessions = new Map<import("bun").ServerWebSocket<unknown>, PtySession>();

const PTY_WORKER = join(import.meta.dir, "pty-worker.cjs");

function spawnPty(ws: import("bun").ServerWebSocket<unknown>, projectPath: string) {
  const existing = ptySessions.get(ws);
  if (existing) {
    try { existing.worker.kill(); } catch {}
    ptySessions.delete(ws);
  }

  const cwd = (projectPath && existsSync(projectPath)) ? projectPath : homedir();

  let worker: ReturnType<typeof Bun.spawn>;
  try {
    worker = Bun.spawn(["node", PTY_WORKER], {
      cwd,
      env: { ...process.env, PTY_CWD: cwd },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err: any) {
    console.error("PTY worker spawn failed:", err.message);
    try { ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[31m[Error] ${err.message}\x1b[0m\r\n` })); } catch {}
    return null;
  }

  // Stream stdout (newline-delimited JSON) → WebSocket
  (async () => {
    let buf = "";
    let msgCount = 0;
    try {
      for await (const chunk of worker.stdout) {
        buf += new TextDecoder().decode(chunk);
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            ws.send(JSON.stringify(msg));
            msgCount++;
            if (msgCount <= 2) console.log(`[PTY] sent msg #${msgCount} type=${msg.type} len=${msg.data?.length ?? 0}`);
          } catch (e: any) {
            console.error("[PTY] parse/send error:", e.message, line.slice(0, 50));
          }
        }
      }
    } catch (e: any) {
      console.error("[PTY] stream error:", e.message);
    }
    console.log(`[PTY] worker done, sent ${msgCount} msgs`);
    try { ws.send(JSON.stringify({ type: "exit" })); } catch {}
    ptySessions.delete(ws);
  })();

  const session: PtySession = { worker, ws };
  ptySessions.set(ws, session);
  console.log("[PTY] Worker started, pid:", worker.pid);
  return session;
}

const server = serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade
    if (url.pathname === "/ws/pty") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // OPTIONS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // API routes
    if (url.pathname === "/api/config") {
      if (req.method === "GET") {
        const config = readConfig();
        return jsonResponse(config);
      }
      if (req.method === "POST") {
        return req.json().then((body: Config) => {
          writeConfig(body);
          return jsonResponse({ ok: true });
        });
      }
    }

    if (url.pathname === "/api/vault/tree") {
      const vaultPath = url.searchParams.get("path") || readConfig()?.vault_path || "";
      if (!vaultPath || !existsSync(vaultPath)) return errorResponse("vault path not found");
      const tree = buildTree(vaultPath, [".md"]);
      return jsonResponse(tree);
    }

    if (url.pathname === "/api/vault/file") {
      if (req.method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        if (!filePath || !existsSync(filePath)) return errorResponse("file not found", 404);
        const content = readFileSync(filePath, "utf-8");
        return jsonResponse({ content });
      }
      if (req.method === "PUT") {
        return req.json().then((body: { path: string; content: string }) => {
          writeFileSync(body.path, body.content, "utf-8");
          return jsonResponse({ ok: true });
        });
      }
      if (req.method === "DELETE") {
        const filePath = url.searchParams.get("path") || "";
        if (!filePath || !existsSync(filePath)) return errorResponse("file not found", 404);
        unlinkSync(filePath);
        return jsonResponse({ ok: true });
      }
    }

    if (url.pathname === "/api/vault/links") {
      const vaultPath = url.searchParams.get("path") || readConfig()?.vault_path || "";
      if (!vaultPath || !existsSync(vaultPath)) return errorResponse("vault path not found");
      const files = collectMdFiles(vaultPath);
      const nodes: { id: string; label: string; path: string }[] = [];
      const edges: { source: string; target: string }[] = [];
      const nameToId = new Map<string, string>();

      for (const f of files) {
        const name = basename(f, ".md");
        nameToId.set(name.toLowerCase(), f);
        nodes.push({ id: f, label: name, path: f });
      }

      for (const f of files) {
        try {
          const content = readFileSync(f, "utf-8");
          const links = parseLinks(content);
          for (const link of links) {
            const targetId = nameToId.get(link.toLowerCase());
            if (targetId) {
              edges.push({ source: f, target: targetId });
            }
          }
        } catch {}
      }

      return jsonResponse({ nodes, edges });
    }

    // Combined graph: private vault + platform, with cross-section edges
    if (url.pathname === "/api/graph/all") {
      const vaultPath = url.searchParams.get("path") || readConfig()?.vault_path || "";
      const platformDir = join(homedir(), ".physmind", "platform");

      const privateFiles = vaultPath && existsSync(vaultPath) ? collectMdFiles(vaultPath) : [];
      const platformFiles = existsSync(platformDir) ? collectMdFiles(platformDir) : [];

      const nodes: { id: string; label: string; path: string; source: "private" | "platform" }[] = [];
      const edges: { source: string; target: string }[] = [];
      const nameToId = new Map<string, string>();

      for (const f of platformFiles) {
        const name = basename(f, ".md");
        nameToId.set(name.toLowerCase(), f);
        nodes.push({ id: f, label: name, path: f, source: "platform" });
      }
      for (const f of privateFiles) {
        const name = basename(f, ".md");
        nameToId.set(name.toLowerCase(), f);
        nodes.push({ id: f, label: name, path: f, source: "private" });
      }

      for (const f of [...privateFiles, ...platformFiles]) {
        try {
          const content = readFileSync(f, "utf-8");
          const links = parseLinks(content);
          for (const link of links) {
            const targetId = nameToId.get(link.toLowerCase());
            if (targetId && targetId !== f) edges.push({ source: f, target: targetId });
          }
        } catch {}
      }

      return jsonResponse({ nodes, edges });
    }

    // Inject a system message into all active PTY sessions
    if (url.pathname === "/api/pty/notify" && req.method === "POST") {
      return req.json().then((body: { text: string }) => {
        const msg = `\r\n\x1b[36m[PhysMind] ${body.text}\x1b[0m\r\n`;
        for (const [ws] of ptySessions) {
          try { ws.send(JSON.stringify({ type: "data", data: msg })); } catch {}
        }
        return jsonResponse({ ok: true });
      });
    }

    // Restart PTY worker with a new CWD (called when project path changes)
    if (url.pathname === "/api/pty/switch-cwd" && req.method === "POST") {
      return req.json().then((body: { cwd: string; text?: string }) => {
        for (const [ws] of ptySessions) {
          try {
            if (body.text) {
              ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[36m[PhysMind] ${body.text}\x1b[0m\r\n` }));
            }
            // Small delay so the message renders before restart clears
            setTimeout(() => spawnPty(ws, body.cwd), 300);
          } catch {}
        }
        return jsonResponse({ ok: true });
      });
    }

    if (url.pathname === "/api/pick-dir") {
      // macOS native folder picker via AppleScript
      try {
        const proc = Bun.spawnSync([
          "osascript", "-e",
          'set f to choose folder\nPOSIX path of f'
        ]);
        const picked = proc.stdout.toString().trim();
        if (picked) return jsonResponse({ path: picked });
        return jsonResponse({ path: null });
      } catch {
        return errorResponse("Folder picker failed", 500);
      }
    }

    if (url.pathname === "/api/create-dir") {
      if (req.method === "POST") {
        return req.json().then((body: { path: string }) => {
          if (!body.path) return errorResponse("path required");
          try {
            mkdirSync(body.path, { recursive: true });
            return jsonResponse({ ok: true });
          } catch (e: any) {
            return errorResponse(e.message, 500);
          }
        });
      }
    }

    if (url.pathname === "/api/check-dir") {
      const p = url.searchParams.get("path") || "";
      return jsonResponse({ exists: p ? existsSync(p) : false });
    }

    if (url.pathname === "/api/upload-image" && req.method === "POST") {
      const body = await req.json() as { data: string; ext: string };
      const tmpDir = join(homedir(), ".physmind", "tmp");
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
      const fileName = `img-${Date.now()}.${body.ext || "png"}`;
      const filePath = join(tmpDir, fileName);
      const buf = Buffer.from(body.data, "base64");
      writeFileSync(filePath, buf);
      return jsonResponse({ path: filePath });
    }

    if (url.pathname === "/api/platform/tree") {
      const platformDir = join(homedir(), ".physmind", "platform");
      if (!existsSync(platformDir)) mkdirSync(platformDir, { recursive: true });
      const tree = buildTree(platformDir, undefined, 0, 3);
      return jsonResponse(tree);
    }

    if (url.pathname === "/api/platform/file") {
      const p = url.searchParams.get("path") || "";
      if (!p || !existsSync(p)) return errorResponse("file not found");
      const content = readFileSync(p, "utf-8");
      return jsonResponse({ content });
    }

    if (url.pathname === "/api/project/tree") {
      const projectPath = url.searchParams.get("path") || readConfig()?.project_path || "";
      if (!projectPath || !existsSync(projectPath)) return errorResponse("project path not found");
      const tree = buildTree(projectPath, undefined, 0, 4);
      return jsonResponse(tree);
    }

    // Serve static files from client/dist
    const distDir = join(import.meta.dir, "client", "dist");
    if (existsSync(distDir)) {
      let filePath = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
      if (!existsSync(filePath)) filePath = join(distDir, "index.html");
      try {
        const file = Bun.file(filePath);
        return new Response(file);
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    return new Response("PhysMind server running. Start client with: cd client && bun run dev", {
      headers: corsHeaders(),
    });
  },

  websocket: {
    open(ws) {
      const config = readConfig();
      const projectPath = config?.project_path || homedir();
      spawnPty(ws, projectPath);
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === "restart") {
          const config = readConfig();
          spawnPty(ws, config?.project_path || homedir());
          return;
        }
        const session = ptySessions.get(ws);
        if (!session) return;
        // Forward message as newline-delimited JSON to worker stdin
        session.worker.stdin.write(JSON.stringify(msg) + "\n");
      } catch {}
    },
    close(ws) {
      const session = ptySessions.get(ws);
      if (session) {
        try { session.worker.kill(); } catch {}
        ptySessions.delete(ws);
      }
    },
  },
});

console.log(`PhysMind server running at http://localhost:${PORT}`);
