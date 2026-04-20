import { serve } from "bun";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, extname, relative, basename } from "path";
import { homedir } from "os";

// In packaged Electron, electron-main.cjs sets MINDACT_RESOURCES = process.resourcesPath
// so that the bun-compiled binary (which has import.meta.dir baked to the build-time path)
// can locate bundled assets at runtime. Fall back to import.meta.dir in dev mode.
const RESOURCE_DIR: string = process.env.MINDACT_RESOURCES ?? import.meta.dir;
import { buildIndex, collectMdFiles, parseLinks, BRAIN_INDEX_PATH } from "./decision_manager/build_index";
import { analyzeDependencies } from "./decision_manager/tasks/dependency_analysis";
import { loadLocalRegistry } from "./decision_manager/registry/local_registry";
import { aiCall, FAST_MODEL } from "./decision_manager/ai_client";
import { getTemplateSystem, buildTemplateMessage } from "./decision_manager/prompts/dependency_analysis";
import { handleRegistry } from "./server/routes/registry";
import { syncSkillsToPhysmind, syncCloudSkillStubs } from "./server/utils/skill_sync";
import { RemoteRegistry } from "./decision_manager/registry/remote_registry";
import type { DecisionDependency } from "./decision_manager/types";
import yaml from "js-yaml";
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
  /** Optional: URL for the remote Cloudflare Workers registry. Absent = local-only mode. */
  registry_url?: string;
  /** Optional: MindAct user account token (mact_xxx) for private registry sync. */
  account_token?: string;
  /** Optional: Admin UI URL override (for auth redirect flow). */
  admin_url?: string;
  /** Which AI backend to use: minimax | anthropic | glm */
  selected_backend?: "minimax" | "anthropic" | "glm";
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

// ─── Shared cloud publish helper ─────────────────────────────────────────────
//
// Uploads a skill DD + SKILL.md to the cloud registry as status:"pending".
// Non-admin submissions are always pending until reviewed — this prevents
// registry pollution by requiring explicit admin approval before a skill
// becomes publicly searchable.
//
// Callers should fire-and-forget with .catch() since cloud unavailability
// must never break local save operations.

const DEFAULT_REGISTRY_URL = "https://registry.physical-mind.ai";

async function publishToCloud(dd: DecisionDependency, content: string, cfg: Config | null): Promise<void> {
  const registryUrl =
    (cfg as any)?.registry_url ??
    process.env.MINDACT_REGISTRY_URL ??
    DEFAULT_REGISTRY_URL;
  // Prefer user account_token (sets owner_user_id), fall back to admin registry_token
  const authToken = (cfg as any)?.account_token ?? (cfg as any)?.registry_token;
  const remote = new RemoteRegistry(registryUrl, authToken);
  // Ensure user-published skills are private by default
  const ddToPublish: DecisionDependency = { ...dd, visibility: dd.visibility ?? "private" };
  // Publish metadata → lands as status:"pending" for non-admin publishers
  await remote.publish(ddToPublish);
  // Build ZIP with SKILL.md + manifest
  const AdmZip = createRequire(import.meta.url)("adm-zip");
  const zip = new AdmZip();
  zip.addFile("SKILL.md", Buffer.from(content, "utf-8"));
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(ddToPublish, null, 2), "utf-8"));
  const buf: Buffer = zip.toBuffer();
  await remote.uploadPackage(
    ddToPublish.id, ddToPublish.version,
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    content,
  );
}

// ─── Skill content structural validator ──────────────────────────────────────
//
// Quick heuristic check on SKILL.md content quality before cloud upload.
// Returns a 0-100 score and a list of issues. Score ≥ 60 is uploadable.

function validateSkillContent(content: string): { score: number; issues: string[]; passed: boolean } {
  const issues: string[] = [];
  let score = 100;
  if (!content.trimStart().startsWith("---"))           { issues.push("Missing YAML frontmatter"); score -= 20; }
  if (!/^name:\s*\S/m.test(content))                   { issues.push("Frontmatter missing 'name'"); score -= 15; }
  if (!/^description:\s*\S/m.test(content))            { issues.push("Frontmatter missing 'description'"); score -= 10; }
  if (!/##\s+Execution\s+Procedure/i.test(content))    { issues.push("Missing '## Execution Procedure' section"); score -= 25; }
  if (!/##\s+Trigger(\s+Conditions)?/i.test(content))  { issues.push("Missing '## Trigger Conditions' section"); score -= 15; }
  const todos = (content.match(/\(TODO\)/g) ?? []).length;
  if (todos > 2) { issues.push(`${todos} unfilled TODO placeholders`); score -= Math.min(20, 5 * todos); }
  score = Math.max(0, score);
  return { score, issues, passed: score >= 60 };
}

function normalizeConfig(raw: any): Config | null {
  if (!raw || typeof raw !== "object") return null;
  const vault_path = String(raw.vault_path ?? "").trim();
  const project_path = String(raw.project_path ?? "").trim();
  const skills_path = String(raw.skills_path ?? "").trim();
  const panel_ratio = Number.isFinite(raw.panel_ratio) ? Number(raw.panel_ratio) : 0.45;
  const config: Config = { vault_path, project_path, skills_path, panel_ratio };
  // Preserve optional fields
  if (raw.registry_url) config.registry_url = String(raw.registry_url);
  if (raw.account_token) config.account_token = String(raw.account_token);
  if (raw.admin_url) config.admin_url = String(raw.admin_url);
  if (raw.selected_backend && ["minimax", "anthropic", "glm"].includes(raw.selected_backend)) {
    config.selected_backend = raw.selected_backend as Config["selected_backend"];
  }
  return config;
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

// Remove skills that were synced from the cloud (identified by .cloud-stub marker).
// Locally-created skills (no .cloud-stub) are preserved.
function removeCloudSkills(skillsRoot: string): void {
  try {
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(skillsRoot, entry.name);
      if (existsSync(join(dir, ".cloud-stub"))) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  } catch (e) {
    console.warn("[logout] removeCloudSkills failed:", e instanceof Error ? e.message : e);
  }
}

function saveKplrCredentials(key: string) {
  const credDir = join(homedir(), ".config", "physmind");
  const credFile = join(credDir, "credentials");
  if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
  // Preserve existing lines other than KPLR_KEY
  let existing = "";
  try { existing = existsSync(credFile) ? readFileSync(credFile, "utf-8") : ""; } catch {}
  const lines = existing.split("\n").filter(l => !l.startsWith("KPLR_KEY=") && l.trim() !== "");
  lines.push(`KPLR_KEY="${key}"`);
  writeFileSync(credFile, lines.join("\n") + "\n");
}

function readKplrCredentials(): string | null {
  const credFile = join(homedir(), ".config", "physmind", "credentials");
  if (!existsSync(credFile)) return null;
  try {
    const lines = readFileSync(credFile, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^KPLR_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function saveMinimaxCredentials(key: string) {
  const credDir = join(homedir(), ".config", "physmind");
  const credFile = join(credDir, "credentials");
  if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
  let existing = "";
  try { existing = existsSync(credFile) ? readFileSync(credFile, "utf-8") : ""; } catch {}
  const lines = existing.split("\n").filter(l => !l.startsWith("MINIMAX_KEY=") && l.trim() !== "");
  lines.push(`MINIMAX_KEY="${key}"`);
  writeFileSync(credFile, lines.join("\n") + "\n");
}

function readMinimaxCredentials(): string | null {
  const credFile = join(homedir(), ".config", "physmind", "credentials");
  if (!existsSync(credFile)) return null;
  try {
    const lines = readFileSync(credFile, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^MINIMAX_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function saveGlmCredentials(key: string) {
  const credDir = join(homedir(), ".config", "physmind");
  const credFile = join(credDir, "credentials");
  if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
  let existing = "";
  try { existing = existsSync(credFile) ? readFileSync(credFile, "utf-8") : ""; } catch {}
  const lines = existing.split("\n").filter(l => !l.startsWith("GLM_KEY=") && l.trim() !== "");
  lines.push(`GLM_KEY="${key}"`);
  writeFileSync(credFile, lines.join("\n") + "\n");
}

function readGlmCredentials(): string | null {
  const credFile = join(homedir(), ".config", "physmind", "credentials");
  if (!existsSync(credFile)) return null;
  try {
    const lines = readFileSync(credFile, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^GLM_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// Auto-extract .skill ZIP files in a directory into sibling subdirectories.
// halcon.skill → halcon/ (only if the dir doesn't already exist or is empty)
// Then symlink every skill dir into ~/.physmind/skills/ so claw /skills <id> works.
function extractSkillZips(skillsRoot: string) {
  const AdmZip = createRequire(import.meta.url)("adm-zip");
  let entries: string[];
  try { entries = readdirSync(skillsRoot); } catch { return; }

  for (const name of entries) {
    if (!name.endsWith(".skill")) continue;
    const zipPath = join(skillsRoot, name);
    const destDir = join(skillsRoot, name.replace(/\.skill$/, ""));
    if (existsSync(destDir) && readdirSync(destDir).length > 0) continue;
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(skillsRoot, true);
    } catch {
      // Corrupt zip — skip
    }
  }

  // Symlink all skill dirs into ~/.physmind/skills/ for claw native /skills command
  syncSkillsToPhysmind(skillsRoot);
}

// syncSkillsToPhysmind is now in server/utils/skill_sync.ts — imported above.

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

function buildAuthHtml(registryUrl: string, callbackUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MindAct — Sign In</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d0d14;color:#ccc;
  display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#111118;border:1px solid #2a2a2a;border-radius:10px;padding:32px 36px;width:420px;max-width:100%}
.logo{text-align:center;margin-bottom:24px}
.logo-icon{font-size:32px;margin-bottom:6px}
.logo-title{font-size:16px;font-weight:700;color:#ccc}
.logo-sub{font-size:11px;color:#444;margin-top:4px;word-break:break-all}
.tabs{display:flex;border-bottom:1px solid #222;margin-bottom:24px}
.tab{flex:1;padding:9px 0;background:none;border:none;border-bottom:2px solid transparent;
  color:#555;cursor:pointer;font-size:12px;font-weight:400;transition:all .1s}
.tab.active{border-bottom-color:#4ec9b0;color:#4ec9b0;font-weight:700}
label{font-size:10px;color:#555;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
input{width:100%;background:#1a1a24;border:1px solid #333;border-radius:4px;color:#d4d4d4;
  padding:8px 10px;font-size:12px;outline:none;margin-bottom:12px}
input:focus{border-color:#4ec9b055}
.btn{width:100%;background:#0a2a20;border:1px solid #4ec9b088;border-radius:4px;
  color:#4ec9b0;cursor:pointer;font-size:12px;padding:9px 0;font-weight:700;margin-top:4px}
.btn:disabled{opacity:.6;cursor:default}
.btn-sec{background:#1a1a2a;border-color:#333;color:#888}
.err{padding:7px 12px;background:#2a0808;border:1px solid #e0555544;border-radius:4px;
  font-size:11px;color:#e05555;margin-bottom:12px}
.ok{padding:7px 12px;background:#082a1a;border:1px solid #4ec9b044;border-radius:4px;
  font-size:11px;color:#4ec9b0;margin-bottom:12px}
.token-box{background:#0d0d14;border:1px solid #4ec9b044;border-radius:6px;
  padding:14px 16px;margin-bottom:16px;text-align:center}
.token-label{font-size:9px;color:#444;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.token-text{font-family:monospace;font-size:11px;color:#4ec9b0;word-break:break-all;letter-spacing:.05em}
.row{display:flex;gap:8px}
.note{font-size:10px;color:#444;text-align:center;margin-top:10px}
.otp-input{letter-spacing:.3em;font-size:16px;text-align:center;font-family:monospace}
hr{border:none;border-top:1px solid #1a1a1a;margin:20px 0}
a{font-size:10px;color:#333;display:block;text-align:center;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🧠</div>
    <div class="logo-title">MindAct Account</div>
    <div class="logo-sub">${registryUrl.replace("https://","")}</div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="showTab('register',this)">Register</button>
    <button class="tab" onclick="showTab('retrieve',this)">Retrieve Token</button>
  </div>

  <!-- Register tab -->
  <div id="tab-register">
    <div id="reg-err" class="err" style="display:none"></div>
    <div id="reg-done" style="display:none">
      <div class="token-box">
        <div class="token-label">Your Account Token — save it now</div>
        <div class="token-text" id="reg-token"></div>
      </div>
      <div class="row">
        <button class="btn" style="flex:1" onclick="copyToken('reg-token',this)">Copy Token</button>
        <button class="btn btn-sec" style="flex:1" id="reg-return" onclick="returnToApp()">Return to MindAct →</button>
      </div>
      <div class="note">Store this token safely. You can retrieve a new one via email verification at any time.</div>
    </div>
    <div id="reg-form">
      <label>Email address</label>
      <input id="reg-email" type="email" placeholder="you@example.com" onkeydown="if(event.key==='Enter')doRegister()">
      <label>Username (optional)</label>
      <input id="reg-username" type="text" placeholder="your-handle">
      <button class="btn" onclick="doRegister()" id="reg-btn">Create Account & Get Token</button>
    </div>
  </div>

  <!-- Retrieve tab -->
  <div id="tab-retrieve" style="display:none">
    <div id="ret-err" class="err" style="display:none"></div>
    <div id="ret-info" class="ok" style="display:none"></div>
    <div id="ret-done" style="display:none">
      <div class="token-box">
        <div class="token-label">Your New Account Token</div>
        <div class="token-text" id="ret-token"></div>
      </div>
      <div class="row">
        <button class="btn" style="flex:1" onclick="copyToken('ret-token',this)">Copy Token</button>
        <button class="btn btn-sec" style="flex:1" onclick="returnToApp()">Return to MindAct →</button>
      </div>
      <div class="note">Your previous token has been invalidated.</div>
    </div>
    <div id="ret-email-form">
      <label>Email address</label>
      <input id="ret-email" type="email" placeholder="you@example.com" onkeydown="if(event.key==='Enter')doSendOtp()">
      <button class="btn" onclick="doSendOtp()" id="otp-btn">Send Verification Code</button>
    </div>
    <div id="ret-otp-form" style="display:none">
      <div style="font-size:11px;color:#888;margin-bottom:12px">
        A 6-digit code was sent to <strong id="ret-email-display" style="color:#ccc"></strong>. Enter it below.
      </div>
      <label>Verification Code</label>
      <input id="ret-otp" type="text" class="otp-input" placeholder="123456" maxlength="6"
        oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)"
        onkeydown="if(event.key==='Enter')doVerifyOtp()">
      <div class="row">
        <button class="btn btn-sec" style="flex:0 0 80px" onclick="showOtpEmailForm()">← Back</button>
        <button class="btn" style="flex:1" onclick="doVerifyOtp()" id="verify-btn">Verify & Get Token</button>
      </div>
      <button onclick="doSendOtp()" style="background:none;border:none;color:#444;cursor:pointer;
        font-size:10px;margin-top:10px;width:100%;text-align:center">Resend code</button>
    </div>
  </div>

  <hr>
  <a href="javascript:window.close()">Close this window</a>
</div>

<script>
const REGISTRY = ${JSON.stringify(registryUrl)};
const CALLBACK = ${JSON.stringify(callbackUrl)};
let _token = null;

function showTab(name, el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['register','retrieve'].forEach(t=>{
    document.getElementById('tab-'+t).style.display = t===name?'block':'none';
  });
}

function setErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}
function setInfo(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function copyToken(tokenId, btn) {
  const text = document.getElementById(tokenId).textContent;
  navigator.clipboard.writeText(text).then(()=>{
    btn.textContent = '✓ Copied!';
    setTimeout(()=>{ btn.textContent = 'Copy Token'; }, 2000);
  });
}

function returnToApp() {
  if (_token) {
    window.location.href = CALLBACK + '?token=' + encodeURIComponent(_token);
  }
}

async function doRegister() {
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const username = document.getElementById('reg-username').value.trim();
  if (!email) { setErr('reg-err','Email is required'); return; }
  const btn = document.getElementById('reg-btn');
  btn.disabled = true; btn.textContent = 'Creating account…';
  setErr('reg-err','');
  try {
    const res = await fetch(REGISTRY+'/auth/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email, username: username||undefined})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    _token = data.token;
    document.getElementById('reg-token').textContent = data.token;
    document.getElementById('reg-form').style.display = 'none';
    document.getElementById('reg-done').style.display = 'block';
    // Auto-return after 500ms if callback URL is set
    setTimeout(returnToApp, 500);
  } catch(e) {
    setErr('reg-err', e.message);
    btn.disabled=false; btn.textContent='Create Account & Get Token';
  }
}

async function doSendOtp() {
  const email = document.getElementById('ret-email').value.trim().toLowerCase();
  if (!email) { setErr('ret-err','Email is required'); return; }
  const btn = document.getElementById('otp-btn');
  btn.disabled=true; btn.textContent='Sending code…';
  setErr('ret-err',''); setInfo('ret-info','');
  try {
    const res = await fetch(REGISTRY+'/auth/send-otp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    document.getElementById('ret-email-display').textContent = email;
    document.getElementById('ret-email-form').style.display='none';
    document.getElementById('ret-otp-form').style.display='block';
    setInfo('ret-info', data.message||'Check your email for a 6-digit code.');
  } catch(e) {
    setErr('ret-err',e.message);
    btn.disabled=false; btn.textContent='Send Verification Code';
  }
}

function showOtpEmailForm() {
  document.getElementById('ret-email-form').style.display='block';
  document.getElementById('ret-otp-form').style.display='none';
  document.getElementById('ret-otp').value='';
  setErr('ret-err',''); setInfo('ret-info','');
  const btn = document.getElementById('otp-btn');
  btn.disabled=false; btn.textContent='Send Verification Code';
}

async function doVerifyOtp() {
  const email = document.getElementById('ret-email').value.trim().toLowerCase();
  const otp = document.getElementById('ret-otp').value.trim();
  if (otp.length!==6) { setErr('ret-err','Enter the 6-digit code'); return; }
  const btn = document.getElementById('verify-btn');
  btn.disabled=true; btn.textContent='Verifying…';
  setErr('ret-err','');
  try {
    const res = await fetch(REGISTRY+'/auth/verify-otp',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email, otp})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    _token = data.token;
    document.getElementById('ret-token').textContent = data.token;
    document.getElementById('ret-otp-form').style.display='none';
    document.getElementById('ret-info').style.display='none';
    document.getElementById('ret-done').style.display='block';
    setTimeout(returnToApp, 500);
  } catch(e) {
    setErr('ret-err',e.message);
    btn.disabled=false; btn.textContent='Verify & Get Token';
  }
}
</script>
</body>
</html>`;
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

const PTY_WORKER = join(RESOURCE_DIR, "pty-worker.cjs");

function spawnPty(ws: import("bun").ServerWebSocket<unknown>, projectPath: string) {
  const existing = ptySessions.get(ws);
  if (existing) {
    // Mark session as superseded BEFORE killing — the stdout stream loop
    // checks ptySessions to decide whether to send the exit message, so
    // removing it here prevents the old worker's exit from reaching the client
    // while the new worker is already running.
    ptySessions.delete(ws);
    try { existing.worker.kill(); } catch {}
  }

  const cwd = (projectPath && existsSync(projectPath)) ? projectPath : homedir();

  // When running inside a packaged Electron app, NODE_BINARY points to the
  // Electron binary (not a plain node executable).  Setting ELECTRON_RUN_AS_NODE=1
  // makes Electron behave as Node.js, so we can run pty-worker.cjs without
  // requiring a separate Node installation on the user's machine.
  const useElectronAsNode = process.env.ELECTRON_AS_NODE === "1";
  const ptyEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    PTY_CWD: cwd,
    ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  };

  let worker: ReturnType<typeof Bun.spawn>;
  try {
    worker = Bun.spawn([process.env.NODE_BINARY || nodeBin, PTY_WORKER], {
      cwd,
      env: ptyEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err: any) {
    console.error("PTY worker spawn failed:", err.message);
    try { ws.send(JSON.stringify({ type: "data", data: `\r\n\x1b[31m[Error] ${err.message}\x1b[0m\r\n` })); } catch {}
    return null;
  }

  // Register session BEFORE starting the stream loop so the exit guard works
  const session: PtySession = { worker, ws };
  ptySessions.set(ws, session);
  console.log("[PTY] Worker started, pid:", worker.pid);

  // PTY worker stderr → server log (e.g. uncaught errors before JSON protocol starts)
  (async () => {
    try {
      for await (const chunk of worker.stderr) {
        const text = new TextDecoder().decode(chunk).trimEnd();
        if (text) console.error("[PTY] worker stderr:", text);
      }
    } catch {
      /* ignore */
    }
  })();

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
    // Only send exit if this worker is still the active session (not superseded by restart)
    if (ptySessions.get(ws)?.worker === worker) {
      try { ws.send(JSON.stringify({ type: "exit" })); } catch {}
      ptySessions.delete(ws);
    }
  })();
  return session;
}

// Called by handleRegistry after a skill is successfully installed.
// Sends a skill_installed event to the client — the client handles the restart
// (shows splash overlay, clears state, then sends back { type: "restart" }).
// This avoids writing raw text into xterm.js which caused garbled terminal output.
function onSkillInstalled(skillsDir: string, name: string, id: string) {
  for (const [ws] of ptySessions) {
    try { ws.send(JSON.stringify({ type: "skill_installed", name })); } catch {}
  }
  console.log(`[registry] Notified clients of skill install: ${id}`);
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

    // Registry routes (/api/registry/*)
    const registryRes = await handleRegistry(req, url, { onSkillInstalled });
    if (registryRes) return registryRes;

    // ── GET /auth — serve standalone auth page (register / retrieve token) ─────
    if (url.pathname === "/auth" && req.method === "GET") {
      const registryUrl = readConfig()?.registry_url ?? "https://registry.physical-mind.ai";
      const callbackUrl = `http://localhost:${PORT}/auth/callback`;
      const authHtml = buildAuthHtml(registryUrl, callbackUrl);
      return new Response(authHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() },
      });
    }

    // ── GET /auth/callback — receives token from browser auth flow ────────────
    if (url.pathname === "/auth/callback" && req.method === "GET") {
      const token = url.searchParams.get("token");
      if (token && token.startsWith("mact_")) {
        // Merge token into existing config
        const existing = readConfig();
        const merged: Config = {
          vault_path: existing?.vault_path ?? "",
          project_path: existing?.project_path ?? "",
          skills_path: existing?.skills_path ?? "",
          panel_ratio: existing?.panel_ratio ?? 0.45,
          registry_url: existing?.registry_url,
          admin_url: existing?.admin_url,
          account_token: token,
        };
        writeConfig(merged);
      }
      // Return a self-closing HTML page
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>MindAct — Signed In</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d14;color:#ccc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;}
h2{color:#4ec9b0;margin:0;}p{color:#666;font-size:13px;margin:0;}</style></head>
<body>
<div style="font-size:40px">🧠</div>
<h2>Account token saved!</h2>
<p>You can close this tab and return to MindAct.</p>
<script>setTimeout(()=>window.close(),2000);</script>
</body></html>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() },
      });
    }

    // ── GET /api/registry/me — proxy to worker /auth/me ───────────────────────
    if (url.pathname === "/api/registry/me" && req.method === "GET") {
      const config = readConfig();
      if (!config?.account_token) return jsonResponse({ error: "Not signed in" }, 401);
      const registryUrl = config.registry_url ?? "https://registry.physical-mind.ai";
      try {
        const res = await fetch(`${registryUrl.replace(/\/$/, "")}/auth/me`, {
          headers: { "Authorization": `Bearer ${config.account_token}` },
        });
        const data = await res.json();
        return jsonResponse(data, res.status);
      } catch {
        return jsonResponse({ error: "Registry unreachable" }, 503);
      }
    }

    // ── GET /api/user/api-keys — proxy to worker /user/api-keys ──────────────
    if (url.pathname === "/api/user/api-keys" && req.method === "GET") {
      const config = readConfig();
      if (!config?.account_token) return jsonResponse({ error: "Not signed in" }, 401);
      const registryUrl = config.registry_url ?? "https://registry.physical-mind.ai";
      try {
        const res = await fetch(`${registryUrl.replace(/\/$/, "")}/user/api-keys`, {
          headers: { "Authorization": `Bearer ${config.account_token}` },
        });
        const data = await res.json();
        return jsonResponse(data, res.status);
      } catch {
        return jsonResponse({ error: "Registry unreachable" }, 503);
      }
    }

    // ── PUT /api/user/api-keys — proxy to worker /user/api-keys ──────────────
    if (url.pathname === "/api/user/api-keys" && req.method === "PUT") {
      const config = readConfig();
      if (!config?.account_token) return jsonResponse({ error: "Not signed in" }, 401);
      const registryUrl = config.registry_url ?? "https://registry.physical-mind.ai";
      try {
        const body = await req.text();
        const res = await fetch(`${registryUrl.replace(/\/$/, "")}/user/api-keys`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${config.account_token}`,
            "Content-Type": "application/json",
          },
          body,
        });
        const data = await res.json();
        return jsonResponse(data, res.status);
      } catch {
        return jsonResponse({ error: "Registry unreachable" }, 503);
      }
    }

    // ── POST /api/auth/logout — clear token + remove cloud-synced skills ──────
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const cfg = readConfig();
      if (cfg) {
        if (cfg.skills_path && existsSync(cfg.skills_path)) {
          removeCloudSkills(cfg.skills_path);
          syncSkillsToPhysmind(cfg.skills_path);
        }
        const { account_token: _removed, ...rest } = cfg;
        writeConfig(rest as Config);
      }
      return jsonResponse({ ok: true });
    }

    // API routes
    if (url.pathname === "/api/config") {
      if (req.method === "GET") {
        const config = readConfig();
        const kplr_token = readKplrCredentials();
        const minimax_token = readMinimaxCredentials();
        const glm_token = readGlmCredentials();
        return jsonResponse(config ? { ...config, kplr_token, minimax_token, glm_token } : null);
      }
      if (req.method === "POST") {
        return req.json().then((body: Config & { kplr_token?: string; minimax_token?: string; glm_token?: string }) => {
          // Save keys first, independently of path config validation
          if (body.kplr_token?.startsWith("kplr-")) {
            saveKplrCredentials(body.kplr_token);
          }
          if (body.minimax_token) {
            saveMinimaxCredentials(body.minimax_token);
          }
          if (body.glm_token) {
            saveGlmCredentials(body.glm_token);
          }
          const normalized = normalizeConfig(body);
          if (normalized) writeConfig(normalized);
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
      extractSkillZips(skillsPath);
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
      const { name, currentContent, lang } = await req.json() as { name: string; currentContent: string; lang?: "en" | "zh" };
      const tmplLang = (lang === "zh" || lang === "en") ? lang : "en";
      try {
        const content = await aiCall({
          system: getTemplateSystem(tmplLang),
          messages: [{ role: "user", content: `${buildTemplateMessage(name, currentContent || name, name, tmplLang)}\n\n${tmplLang === "zh" ? "现有草稿（如有）：" : "Existing draft (if any):"}\n${currentContent}` }],
          model: FAST_MODEL,
          maxTokens: 1200,
        });
        return jsonResponse({ content });
      } catch (err: any) {
        return jsonResponse({ error: err?.message }, 500);
      }
    }

    // ── Skills: validate SKILL.md content before cloud upload ─────────────────
    if (url.pathname === "/api/skills/validate" && req.method === "POST") {
      const body = await req.json() as { content: string };
      if (!body?.content?.trim()) return errorResponse("content required");
      return jsonResponse(validateSkillContent(body.content));
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

      // Sync symlinks so PhysMind CLI picks up the skill immediately
      syncSkillsToPhysmind(rootDir);

      // Write decision-dependency.yaml if missing (enables local registry pickup)
      const ddFile = join(skillDir, "decision-dependency.yaml");
      if (!existsSync(ddFile)) {
        writeFileSync(ddFile, yaml.dump({
          id: slug, name: body.name, description: `${body.name} skill`,
          version: "1.0.0", type: "skill", modes: ["generator"],
          tags: [], domain: "general", publisher: "user",
          visibility: "private", trust: "untrusted", maturity: "L1",
        }), "utf-8");
      }

      // Attempt cloud upload (non-blocking) — lands as status:"pending" until admin approves
      const skillDD: DecisionDependency = {
        id: slug, version: "1.0.0", type: "skill", modes: ["generator"],
        name: body.name, description: `${body.name} skill`,
        tags: [], domain: "general",
        source: { type: "local", path: skillDir },
        publisher: "user", visibility: "private",
        trust: "untrusted", maturity: "L1",
        installedAt: new Date().toISOString(),
      };
      publishToCloud(skillDD, body.content, cfg).catch(e =>
        console.warn("[skills/save] cloud pending upload failed:", e?.message ?? e)
      );

      return jsonResponse({ ok: true, path: skillFile, skillDir, cloudStatus: "pending" });
    }

    // ── Skill Contribution — close-loop: missing knowledge DD → new skill DD ──
    // Converts a missing type:"knowledge" DecisionDependency (from analysis pipeline)
    // into a type:"skill" DD, saves it locally (immediate), and uploads to cloud (async).
    if (url.pathname === "/api/registry/contribute-skill" && req.method === "POST") {
      try {
        const { dd, userContent, domain: reqDomain } = await req.json() as {
          dd: DecisionDependency;
          userContent: string;
          domain?: string;
        };
        if (!dd?.name?.trim()) return errorResponse("dd.name required");
        if (!userContent?.trim()) return errorResponse("userContent required");

        const cfg = readConfig();
        const skillsRoot = cfg?.skills_path || defaultSkillsRoot();
        const domain = (reqDomain || dd.domain || "general").trim();
        const slug = slugifySkillName(dd.id || dd.name);
        const skillDir = join(skillsRoot, slug);

        // Build the new skill DecisionDependency (promoted from knowledge → skill)
        const skillDD: DecisionDependency = {
          ...dd,
          id: slug,
          version: "1.0.0",
          type: "skill",
          modes: ["generator"],
          source: { type: "local", path: skillDir },
          publisher: "user",
          visibility: "public",
          trust: "untrusted",
          maturity: "L1",
          installedAt: new Date().toISOString(),
        };

        // Build SKILL.md using existing template + inline user content
        const skillContent = buildFastSkillTemplate({
          task: dd.description || dd.name,
          domain,
          dependencies: [],
          foundFiles: [],
        }).replace(
          "## Execution Procedure",
          `## User-Provided Knowledge\n${userContent.trim()}\n\n## Execution Procedure`,
        );

        // Persist locally — loadLocalRegistry() picks up both files on next analysis run
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), skillContent, "utf-8");
        writeFileSync(
          join(skillDir, "decision-dependency.yaml"),
          yaml.dump({
            id: skillDD.id, name: skillDD.name, description: skillDD.description,
            version: skillDD.version, type: skillDD.type, modes: skillDD.modes,
            tags: skillDD.tags, domain: skillDD.domain, publisher: skillDD.publisher,
            visibility: skillDD.visibility, trust: skillDD.trust, maturity: skillDD.maturity,
          }),
          "utf-8",
        );

        // Sync symlinks immediately — agent can use this skill in the next PTY session
        syncSkillsToPhysmind(skillsRoot);

        // Upload to cloud via shared helper (non-blocking, status:"pending" until admin review)
        let published = false;
        try {
          await publishToCloud(skillDD, skillContent, cfg);
          published = true;
        } catch (e: any) {
          console.warn("[contribute-skill] cloud upload failed:", e?.message ?? e);
        }

        return jsonResponse({ ok: true, localPath: join(skillDir, "SKILL.md"), published, cloudStatus: published ? "pending" : "local-only", dd: skillDD });
      } catch (err: any) {
        return errorResponse(`contribute-skill failed: ${err?.message ?? err}`, 500);
      }
    }

    // ── Dependency Analysis (SSE streaming) ─────────────────────────────────
    if (url.pathname === "/api/dm/analyze" && req.method === "POST") {
      const { task, lang } = await req.json() as { task: string; lang?: string };
      const cfg = readConfig();
      const vaultPath = cfg?.vault_path || "";

      // Pre-load local registry so analyzeDependencies receives candidates[]
      const skillsDir = cfg?.skills_path || defaultSkillsRoot();
      const candidates = await loadLocalRegistry(skillsDir);

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
              candidates,
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
    const distDir = join(RESOURCE_DIR, "client", "dist");
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

// Sync published cloud skills as SKILL.md stubs at startup (non-blocking).
// This makes cloud skills visible to the PhysMind agent without a full install.
// Also auto-uploads all locally-created skills if user is signed in.
(async () => {
  const cfg = readConfig();
  if (!cfg) return;
  const skillsRoot = cfg.skills_path || defaultSkillsRoot();
  const registryUrl =
    cfg.registry_url ??
    process.env.MINDACT_REGISTRY_URL ??
    "https://registry.physical-mind.ai";
  // Pass account_token so user's private skills are included in the stub list
  const userToken = (cfg as any).account_token ?? (cfg as any).registry_token;
  await syncCloudSkillStubs(registryUrl, skillsRoot, userToken);

  // Auto-upload all locally-created skills to cloud when user is signed in
  if ((cfg as any).account_token && existsSync(skillsRoot)) {
    let uploaded = 0;
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(skillsRoot, entry.name);
      // Skip cloud stubs — they came from the cloud, not locally created
      if (existsSync(join(dir, ".cloud-stub"))) continue;
      const skillMdPath = join(dir, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const ddFilePath = join(dir, "decision-dependency.yaml");
        let dd: DecisionDependency;
        if (existsSync(ddFilePath)) {
          dd = yaml.load(readFileSync(ddFilePath, "utf-8")) as DecisionDependency;
        } else {
          dd = {
            id: entry.name, name: entry.name, version: "1.0.0",
            type: "skill", modes: ["generator"], tags: [], domain: "general",
            source: { type: "local", path: dir },
            publisher: "user", visibility: "private", trust: "untrusted", maturity: "L1",
            installedAt: new Date().toISOString(),
          };
        }
        await publishToCloud(dd, content, cfg);
        uploaded++;
      } catch (e) {
        console.warn(`[startup-sync] failed to upload ${entry.name}:`, e instanceof Error ? e.message : e);
      }
    }
    if (uploaded > 0) console.log(`[startup-sync] uploaded ${uploaded} local skill(s) to cloud`);
  }
})();

// Auto-update @keploreai/physmind on startup (non-blocking)
(async () => {
  try {
    const res = await fetch("https://registry.npmjs.org/@keploreai/physmind/latest");
    if (!res.ok) return;
    const data = await res.json() as { version: string };
    const latestVersion = data.version;

    // Get currently installed version from local node_modules
    let installedVersion: string | null = null;
    try {
      const pkgPath = join(import.meta.dir, "node_modules", "@keploreai", "physmind", "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      installedVersion = pkg.version;
    } catch { /* not installed locally */ }

    if (installedVersion === latestVersion) {
      console.log(`[physmind] Up to date: ${latestVersion}`);
      return;
    }

    console.log(`[physmind] ${installedVersion ? `Updating ${installedVersion} →` : "Installing"} ${latestVersion}...`);
    const proc = Bun.spawnSync(
      ["npm", "install", `@keploreai/physmind@${latestVersion}`],
      { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" }
    );
    if (proc.exitCode === 0) {
      console.log(`[physmind] Updated to ${latestVersion} ✓`);
    } else {
      console.error(`[physmind] Update failed (exit ${proc.exitCode})`);
    }
  } catch {
    // Network unavailable or registry error, silently skip
  }
})();
