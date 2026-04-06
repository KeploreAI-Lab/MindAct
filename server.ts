import { serve } from "bun";
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, relative, basename } from "path";
import { homedir } from "os";
import pty from "node-pty";

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
  const re = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    links.push(m[1].trim());
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

// PTY management
interface PtySession {
  pty: ReturnType<typeof pty.spawn>;
  ws: import("bun").ServerWebSocket<unknown>;
}

const ptySessions = new Map<import("bun").ServerWebSocket<unknown>, ReturnType<typeof pty.spawn>>();

function spawnPty(ws: import("bun").ServerWebSocket<unknown>, projectPath: string) {
  // Kill existing
  const existing = ptySessions.get(ws);
  if (existing) {
    try { existing.kill(); } catch {}
  }

  const shell = process.env.SHELL || "/bin/zsh";
  const ptyProcess = pty.spawn("bun", [
    "run",
    "/Users/jtu/important-code/src/entrypoints/cli.tsx"
  ], {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: projectPath || homedir(),
    env: { ...process.env, TERM: "xterm-256color" },
  });

  ptyProcess.onData((data: string) => {
    try {
      ws.send(JSON.stringify({ type: "data", data }));
    } catch {}
  });

  ptyProcess.onExit(() => {
    try {
      ws.send(JSON.stringify({ type: "exit" }));
    } catch {}
    ptySessions.delete(ws);
  });

  ptySessions.set(ws, ptyProcess);
  return ptyProcess;
}

const server = serve({
  port: PORT,
  fetch(req, server) {
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
        const ptyProcess = ptySessions.get(ws);
        if (!ptyProcess) return;
        if (msg.type === "input") {
          ptyProcess.write(msg.data);
        } else if (msg.type === "resize") {
          ptyProcess.resize(msg.cols, msg.rows);
        } else if (msg.type === "restart") {
          const config = readConfig();
          spawnPty(ws, config?.project_path || homedir());
        }
      } catch {}
    },
    close(ws) {
      const ptyProcess = ptySessions.get(ws);
      if (ptyProcess) {
        try { ptyProcess.kill(); } catch {}
        ptySessions.delete(ws);
      }
    },
  },
});

console.log(`PhysMind server running at http://localhost:${PORT}`);
