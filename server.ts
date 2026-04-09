import { serve } from "bun";
import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, relative, basename } from "path";
import { homedir } from "os";
import { buildIndex, collectMdFiles, parseLinks, BRAIN_INDEX_PATH } from "./decision_manager/build_index";
import { analyzeDependencies } from "./decision_manager/tasks/dependency_analysis";
import { aiCall, FAST_MODEL } from "./decision_manager/ai_client";
import { TEMPLATE_SYSTEM, buildTemplateMessage } from "./decision_manager/prompts/dependency_analysis";
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
  skills_path: string;
  panel_ratio: number;
}

function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || `skill-${Date.now()}`;
}

function defaultSkillsRoot(): string {
  return join(process.cwd(), "skills-test");
}

function buildFastSkillTemplate(params: {
  task: string;
  domain?: string;
  dependencies?: { name: string; level: string; description?: string }[];
  foundFiles?: string[];
  referenceSkill?: string;
}): string {
  const domain = (params.domain || "general").trim();
  const deps = params.dependencies || [];
  const found = params.foundFiles || [];
  const skillName = slugifySkillName(`${domain}-workflow-skill`);

  const triggerHints = deps
    .map(d => d.name)
    .slice(0, 6)
    .join(" / ");
  const depChecklist = deps.length > 0
    ? deps.map(d => `- [${d.level}] ${d.name}${d.description ? `: ${d.description}` : ""}`).join("\n")
    : "- (TODO) Add required dependencies";
  const contextFiles = found.length > 0
    ? found.map(f => `- ${f}`).join("\n")
    : "- (TODO) Add context files";
  const referenceSnippet = (params.referenceSkill || "").trim();
  const referenceSection = referenceSnippet
    ? `\n## Reference Skill Pattern\nUse the following existing skill style as a structural reference:\n\n\`\`\`markdown\n${referenceSnippet}\n\`\`\`\n`
    : "";

  return `---
name: ${skillName}
description: Domain workflow skill for ${domain}. Use this skill when user requests tasks related to ${triggerHints || domain}, or asks to reuse a proven workflow in this domain.
---

# Purpose
Capture a reusable execution workflow from validated knowledge/context, so repeated tasks are handled consistently.

## Trigger Conditions
- User asks for tasks in domain: ${domain}
- User intent includes: ${triggerHints || "(TODO: add trigger keywords)"}
- User asks for standardized or repeatable execution

## Input
- Task prompt from user
- Optional constraints (latency/safety/quality)
- Optional project-specific parameters

## Dependency Checklist
${depChecklist}

## Context Files
${contextFiles}

## Execution Procedure
1. Parse task objective and constraints.
2. Verify dependency checklist and mark missing items.
3. Use context files first; avoid unsupported assumptions.
4. Produce result using concise, testable steps.
5. If critical dependency is missing, return fallback plan and request missing info.

## Output Format
Use this structure:
1) Summary
2) Key assumptions
3) Step-by-step plan
4) Risks and fallback
5) Next actions

## Failure Handling
- If required dependency is missing: stop and ask for missing knowledge.
- If confidence is low: provide conservative fallback and validation steps.
- If context conflicts: report conflict sources explicitly.

## Notes
- Derived from task:
  ${params.task}
${referenceSection}
`;
}

function loadSkillCreatorReference(skillsRoot: string): string {
  if (!skillsRoot || !existsSync(skillsRoot)) return "";
  const entries = buildTree(skillsRoot, [".md"], 0, 4);
  const stack: TreeNode[] = [...entries];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "dir" && node.children?.length) {
      stack.push(...node.children);
      continue;
    }
    if (node.type !== "file") continue;
    const normalizedPath = node.path.toLowerCase();
    if (!normalizedPath.endsWith("skill.md")) continue;
    try {
      const content = readFileSync(node.path, "utf-8").trim();
      if (!content) return "";
      const parent = basename(normalizedPath.replace(/\/skill\.md$/, ""));
      const isSkillCreator =
        parent.includes("skill-creator") ||
        /name:\s*["']?skill-creator["']?/i.test(content) ||
        /skill-creator/i.test(content);
      if (!isSkillCreator) continue;
      // Keep full reference structure but cap extreme size.
      return content.length > 8000 ? content.slice(0, 8000) : content;
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeConfig(raw: any): Config | null {
  if (!raw || typeof raw !== "object") return null;
  const vault_path = String(raw.vault_path ?? "").trim();
  const project_path = String(raw.project_path ?? "").trim();
  const skills_path = String(raw.skills_path ?? "").trim();
  const panel_ratio = Number.isFinite(raw.panel_ratio) ? Number(raw.panel_ratio) : 0.45;
  if (!vault_path || !project_path || !skills_path) return null;
  return { vault_path, project_path, skills_path, panel_ratio };
}

function readConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    return normalizeConfig(parsed);
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
  idleTimeout: 0,
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
          const normalized = normalizeConfig(body);
          if (!normalized) return errorResponse("vault_path, project_path, skills_path are required");
          writeConfig(normalized);
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
    // ── BrainIndex ──────────────────────────────────────────────────────────
    if (url.pathname === "/api/brain-index" && req.method === "GET") {
      if (!existsSync(BRAIN_INDEX_PATH)) return jsonResponse({ content: null });
      return jsonResponse({ content: readFileSync(BRAIN_INDEX_PATH, "utf-8") });
    }

    if (url.pathname === "/api/brain-index" && req.method === "PUT") {
      return req.json().then((body: { content: string }) => {
        writeFileSync(BRAIN_INDEX_PATH, body.content, "utf-8");
        return jsonResponse({ ok: true });
      });
    }

    if (url.pathname === "/api/brain-index/generate" && req.method === "POST") {
      const cfg = readConfig();
      const content = buildIndex({ vaultPath: cfg?.vault_path || "" });
      return jsonResponse({ content });
    }

    // Load platform content from a local directory
    if (url.pathname === "/api/platform/load-local" && req.method === "POST") {
      return req.json().then((body: { path: string }) => {
        const srcDir = body.path?.trim();
        if (!srcDir || !existsSync(srcDir)) return errorResponse("目录不存在：" + srcDir);
        const platformDir = join(homedir(), ".physmind", "platform");
        if (!existsSync(platformDir)) mkdirSync(platformDir, { recursive: true });
        const mdFiles = collectMdFiles(srcDir);
        const copied: string[] = [];
        for (const f of mdFiles) {
          const rel = relative(srcDir, f);
          const dest = join(platformDir, rel);
          const destDir = join(dest, "..");
          if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
          writeFileSync(dest, readFileSync(f));
          copied.push(rel);
        }
        return jsonResponse({ ok: true, count: copied.length, files: copied });
      });
    }

    // Load platform content from a URL
    if (url.pathname === "/api/platform/load-url" && req.method === "POST") {
      return req.json().then(async (body: { url: string }) => {
        try {
          const res = await fetch(body.url);
          if (!res.ok) return errorResponse("fetch failed: " + res.status);
          const text = await res.text();
          const platformDir = join(homedir(), ".physmind", "platform");
          if (!existsSync(platformDir)) mkdirSync(platformDir, { recursive: true });
          // Derive filename from URL
          const urlObj = new URL(body.url);
          const name = basename(urlObj.pathname).replace(/[^a-z0-9_\-\.]/gi, "_") || "loaded.md";
          const filePath = join(platformDir, name.endsWith(".md") ? name : name + ".md");
          writeFileSync(filePath, text, "utf-8");
          return jsonResponse({ ok: true, path: filePath, name });
        } catch (e: any) {
          return errorResponse(e.message);
        }
      });
    }

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
        const msg = `\r\n\x1b[36m[MindAct] ${body.text}\x1b[0m\r\n`;
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
              ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[36m[MindAct] ${body.text}\x1b[0m\r\n` }));
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

    // Platform marketplace — search available modules
    if (url.pathname === "/api/platform/search") {
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const catalog = [
        { id: "control_theory", name: "Control Theory", tags: ["PID", "MPC", "LQR", "控制", "control"], description: "经典控制理论：PID、LQR、MPC 决策依赖图谱" },
        { id: "computer_vision", name: "Computer Vision", tags: ["vision", "YOLO", "detection", "视觉", "目标检测"], description: "目标检测与视觉感知决策依赖" },
        { id: "slam", name: "SLAM", tags: ["slam", "localization", "mapping", "定位", "建图"], description: "同步定位与建图的算法依赖链" },
        { id: "motion_planning", name: "Motion Planning", tags: ["planning", "trajectory", "轨迹", "规划"], description: "运动规划算法：A*、RRT*、轨迹优化" },
        { id: "deep_learning", name: "Deep Learning", tags: ["neural", "training", "深度学习", "神经网络", "训练"], description: "深度学习训练流程与超参数依赖" },
        { id: "ros", name: "ROS / ROS2", tags: ["ros", "middleware", "中间件", "通信"], description: "ROS2 架构与节点通信决策依赖" },
        { id: "embedded", name: "Embedded Systems", tags: ["embedded", "RTOS", "嵌入式", "实时"], description: "嵌入式系统与 RTOS 决策约束" },
        { id: "simulation", name: "Simulation & Digital Twin", tags: ["simulation", "digital twin", "仿真", "数字孪生"], description: "仿真环境搭建与数字孪生依赖" },
        { id: "data_pipeline", name: "Data Pipeline", tags: ["data", "pipeline", "数据", "流水线", "ETL"], description: "数据采集、清洗、标注流水线依赖" },
        { id: "safety", name: "Safety & Reliability", tags: ["safety", "fault", "安全", "可靠性", "故障"], description: "功能安全与故障模式分析（FMEA）" },
        { id: "cloud_deploy", name: "Cloud Deployment", tags: ["cloud", "deploy", "kubernetes", "云", "部署", "k8s"], description: "云端部署与容器化决策依赖" },
        { id: "hardware_selection", name: "Hardware Selection", tags: ["hardware", "GPU", "sensor", "硬件", "传感器", "选型"], description: "硬件选型决策：GPU、传感器、计算平台" },
      ];
      const results = q
        ? catalog.filter(m => m.name.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q)) || m.description.includes(q))
        : catalog;
      const platformDir = join(homedir(), ".physmind", "platform");
      const installed = existsSync(platformDir) ? readdirSync(platformDir).map(f => f.replace(".md", "")) : [];
      return jsonResponse(results.map(m => ({ ...m, installed: installed.includes(m.id) })));
    }

    // Platform marketplace — install a module
    if (url.pathname === "/api/platform/install" && req.method === "POST") {
      return req.json().then((body: { id: string }) => {
        const platformDir = join(homedir(), ".physmind", "platform");
        if (!existsSync(platformDir)) mkdirSync(platformDir, { recursive: true });
        const templates: Record<string, string> = {
          control_theory: `# Control Theory — Decision Dependency\n\n## PID Control\n- **比例项 (P)**: 响应速度 vs 超调量\n- **积分项 (I)**: 消除稳态误差，引入积分饱和风险\n- **微分项 (D)**: 抑制超调，对噪声敏感\n\n## Decision Table\n| 控制目标 | 推荐方法 | 约束 |\n|---------|---------|------|\n| 稳定关节 | PID | 带宽 < 传感器采样率/4 |\n| 动态轨迹 | MPC | 计算延迟 < 控制周期 |\n| 最优调节 | LQR | 系统需线性化 |\n\n## Links\n- {{ algorithms }} — 数值求解器\n- {{ physics }} — 动力学方程\n`,
          computer_vision: `# Computer Vision — Decision Dependency\n\n## Detection Pipeline\n- **预处理**: 分辨率 vs 推理延迟\n- **主干网络**: 精度 vs FPS 权衡\n- **后处理**: NMS 阈值影响 recall/precision\n\n## Decision Table\n| 场景 | 模型 | 约束 |\n|------|------|------|\n| 实时检测 | YOLOv8n | FPS > 30 |\n| 高精度 | YOLOv8x | 延迟 < 100ms |\n| 边缘部署 | MobileNet | RAM < 512MB |\n\n## Links\n- {{ algorithms }} — 搜索与优化\n- {{ system_design }} — 部署架构\n`,
          slam: `# SLAM — Decision Dependency\n\n## Core Components\n- **前端**: 特征提取精度 vs 计算速度\n- **后端**: 图优化收敛性 vs 内存\n- **回环检测**: 误报率 vs 漏报率\n\n## Decision Table\n| 环境 | 方案 | 传感器 |\n|------|------|--------|\n| 室内 | ORB-SLAM3 | 单目/双目 |\n| 室外 | LIO-SAM | LiDAR+IMU |\n| 水下 | 声学SLAM | 声纳 |\n\n## Links\n- {{ physics }} — 运动学模型\n- {{ algorithms }} — 图优化\n`,
          motion_planning: `# Motion Planning — Decision Dependency\n\n## Planning Hierarchy\n- **全局规划**: 最优性 vs 计算时间\n- **局部规划**: 避障实时性 vs 平滑度\n- **轨迹优化**: 动力学可行性约束\n\n## Decision Table\n| 问题类型 | 算法 | 权衡 |\n|---------|------|------|\n| 全局路径 | A* | 内存 vs 最优性 |\n| 高维空间 | RRT* | 完备性 vs 最优性 |\n| 实时重规划 | D* Lite | 增量更新 |\n\n## Links\n- {{ algorithms }} — 搜索算法\n- {{ robots }} — 机器人约束\n`,
          deep_learning: `# Deep Learning — Decision Dependency\n\n## Training Pipeline\n- **数据**: 量 vs 质量 vs 多样性\n- **架构**: 参数量 vs 表达能力\n- **训练**: 学习率、批大小、优化器\n\n## Decision Table\n| 决策点 | 选项 | 依赖条件 |\n|--------|------|----------|\n| 优化器 | AdamW | 默认首选 |\n| 学习率调度 | Cosine | 训练轮数 > 100 |\n| 混合精度 | FP16 | GPU 支持 Tensor Core |\n\n## Links\n- {{ system_design }} — 训练基础设施\n- {{ data_pipeline }} — 数据来源\n`,
          ros: `# ROS / ROS2 — Decision Dependency\n\n## Architecture Decisions\n- **节点粒度**: 细粒度 vs 延迟开销\n- **通信方式**: Topic vs Service vs Action\n- **QoS 策略**: 可靠 vs 尽力传输\n\n## Decision Table\n| 场景 | 通信模式 | QoS |\n|------|---------|-----|\n| 传感器流 | Topic | Best Effort |\n| 控制指令 | Service | Reliable |\n| 长时任务 | Action | Reliable |\n\n## Links\n- {{ system_design }} — 系统架构\n- {{ robots }} — 机器人集成\n`,
          embedded: `# Embedded Systems — Decision Dependency\n\n## RTOS Decisions\n- **调度策略**: 实时性 vs 公平性\n- **内存管理**: 静态 vs 动态分配\n- **中断处理**: 延迟 vs 吞吐量\n\n## Decision Table\n| 需求 | 方案 | 约束 |\n|------|------|------|\n| 硬实时 | FreeRTOS | 响应 < 1ms |\n| 软实时 | Linux RT | 响应 < 10ms |\n| 超低功耗 | Bare Metal | 无OS开销 |\n\n## Links\n- {{ hardware_selection }} — 平台选型\n- {{ control_theory }} — 控制周期\n`,
          simulation: `# Simulation & Digital Twin — Decision Dependency\n\n## Sim-to-Real Gap\n- **物理引擎精度** vs 仿真速度\n- **传感器模型** vs 真实噪声\n- **域随机化** vs 过拟合风险\n\n## Decision Table\n| 用途 | 仿真器 | 精度 |\n|------|--------|------|\n| 机器人 | Isaac Sim | 高 |\n| 自动驾驶 | CARLA | 高 |\n| 快速原型 | PyBullet | 中 |\n\n## Links\n- {{ physics }} — 物理建模\n- {{ deep_learning }} — Sim2Real 训练\n`,
          data_pipeline: `# Data Pipeline — Decision Dependency\n\n## Pipeline Stages\n- **采集**: 采样率 vs 存储成本\n- **清洗**: 自动化 vs 人工审核\n- **标注**: 速度 vs 精度 vs 成本\n\n## Decision Table\n| 阶段 | 工具 | 瓶颈 |\n|------|------|------|\n| 标注 | Label Studio | 人力 |\n| 存储 | HDF5/Parquet | IO 带宽 |\n| 版本控制 | DVC | 数据追溯 |\n\n## Links\n- {{ deep_learning }} — 训练数据需求\n- {{ system_design }} — 存储架构\n`,
          safety: `# Safety & Reliability — Decision Dependency\n\n## Safety Standards\n- **ISO 26262**: 汽车功能安全\n- **IEC 61508**: 工业安全完整性等级\n- **FMEA**: 故障模式与影响分析\n\n## Decision Table\n| 安全等级 | 要求 | 验证方法 |\n|---------|------|----------|\n| SIL 1 | 10⁻⁵/h 失效率 | 软件测试 |\n| SIL 2 | 10⁻⁶/h 失效率 | 形式验证 |\n| SIL 3 | 10⁻⁷/h 失效率 | 多重冗余 |\n\n## Links\n- {{ system_design }} — 冗余架构\n- {{ hardware_selection }} — 可靠性指标\n`,
          cloud_deploy: `# Cloud Deployment — Decision Dependency\n\n## Deployment Strategy\n- **容器化**: Docker 镜像一致性\n- **编排**: Kubernetes 弹性伸缩\n- **CI/CD**: 自动化测试与发布\n\n## Decision Table\n| 场景 | 策略 | 权衡 |\n|------|------|------|\n| 无状态服务 | Deployment | 弹性扩容 |\n| 有状态服务 | StatefulSet | 数据持久化 |\n| GPU 推理 | DaemonSet | 资源独占 |\n\n## Links\n- {{ system_design }} — 架构设计\n- {{ data_pipeline }} — 数据流\n`,
          hardware_selection: `# Hardware Selection — Decision Dependency\n\n## Selection Criteria\n- **计算平台**: TOPS vs 功耗 vs 成本\n- **传感器**: 精度 vs 频率 vs 接口\n- **存储**: 带宽 vs 容量 vs 可靠性\n\n## Decision Table\n| 场景 | 平台 | 功耗 |\n|------|------|------|\n| 边缘推理 | Jetson Orin | 15-60W |\n| 云端训练 | A100 | 400W |\n| 移动机器人 | Jetson Nano | 5-10W |\n\n## Links\n- {{ embedded }} — 实时约束\n- {{ deep_learning }} — 推理需求\n`,
        };
        const content = templates[body.id] || `# ${body.id}\n\n待补充内容。\n`;
        const filePath = join(platformDir, `${body.id}.md`);
        writeFileSync(filePath, content, "utf-8");
        return jsonResponse({ ok: true, path: filePath });
      });
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

    if (url.pathname === "/api/skills/tree") {
      const skillsPath = url.searchParams.get("path") || readConfig()?.skills_path || "";
      if (!skillsPath || !existsSync(skillsPath)) return errorResponse("skills path not found");
      const tree = buildTree(skillsPath, undefined, 0, 5);
      return jsonResponse(tree);
    }

    if (url.pathname === "/api/project/file") {
      if (req.method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        if (!filePath || !existsSync(filePath)) return errorResponse("file not found");
        const content = readFileSync(filePath, "utf-8");
        return jsonResponse({ content });
      }
      if (req.method === "PUT") {
        const { path: filePath, content } = await req.json() as { path: string; content: string };
        if (!filePath) return errorResponse("missing path");
        writeFileSync(filePath, content, "utf-8");
        return jsonResponse({ ok: true });
      }
    }

    if (url.pathname === "/api/skills/file") {
      if (req.method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        if (!filePath || !existsSync(filePath)) return errorResponse("file not found");
        const content = readFileSync(filePath, "utf-8");
        return jsonResponse({ content });
      }
      if (req.method === "PUT") {
        const { path: filePath, content } = await req.json() as { path: string; content: string };
        if (!filePath) return errorResponse("missing path");
        writeFileSync(filePath, content, "utf-8");
        return jsonResponse({ ok: true });
      }
    }

    // ── AI suggest template for ghost file ──────────────────────────────────
    if (url.pathname === "/api/dm/suggest-template" && req.method === "POST") {
      const { name, currentContent } = await req.json() as { name: string; currentContent: string };
      try {
        const content = await aiCall({
          system: TEMPLATE_SYSTEM,
          messages: [{ role: "user", content: `${buildTemplateMessage(name, currentContent || name, name)}\n\n现有草稿（如有）：\n${currentContent}` }],
          model: FAST_MODEL,
          maxTokens: 1200,
        });
        return jsonResponse({ content });
      } catch (err: any) {
        return jsonResponse({ error: err?.message }, 500);
      }
    }

    // ── Skills: generate template from analysis report ──────────────────────
    if (url.pathname === "/api/skills/generate-template" && req.method === "POST") {
      const body = await req.json() as {
        task: string;
        domain?: string;
        dependencies?: { name: string; level: string; description?: string }[];
        foundFiles?: string[];
      };
      try {
        // Fast local draft generation to avoid LLM latency.
        const cfg = readConfig();
        const referenceSkill = loadSkillCreatorReference(cfg?.skills_path || defaultSkillsRoot());
        const content = buildFastSkillTemplate({ ...body, referenceSkill });
        return jsonResponse({ content });
      } catch (err: any) {
        return jsonResponse({ error: err?.message ?? "failed to generate skill template" }, 500);
      }
    }

    // ── Skills: save edited skill template ──────────────────────────────────
    if (url.pathname === "/api/skills/save" && req.method === "POST") {
      const body = await req.json() as { name: string; content: string; rootDir?: string };
      if (!body.name?.trim()) return errorResponse("name required");
      if (!body.content?.trim()) return errorResponse("content required");

      const cfg = readConfig();
      const rootDir = body.rootDir?.trim() || cfg?.skills_path || defaultSkillsRoot();
      const slug = slugifySkillName(body.name);
      const skillDir = join(rootDir, slug);
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
      const skillFile = join(skillDir, "SKILL.md");
      writeFileSync(skillFile, body.content, "utf-8");
      return jsonResponse({ ok: true, path: skillFile, skillDir });
    }

    // ── Dependency Analysis (SSE streaming) ─────────────────────────────────
    if (url.pathname === "/api/dm/analyze" && req.method === "POST") {
      const { task, lang } = await req.json() as { task: string; lang?: string };
      const cfg = readConfig();
      const vaultPath = cfg?.vault_path || "";

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: object) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };
          try {
            await analyzeDependencies({
              task,
              vaultPath,
              skillsDir: cfg?.skills_path || defaultSkillsRoot(),
              lang: (lang === "zh" || lang === "en") ? lang : "en",
              onEvent: (event) => send(event),
            });
          } catch (err: any) {
            send({ type: "error", data: err?.message ?? String(err) });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
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

    return new Response("MindAct server running. Start client with: cd client && bun run dev", {
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

console.log(`MindAct server running at http://localhost:${PORT}`);
