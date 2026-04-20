#!/usr/bin/env bun
/**
 * mindact-admin — MindAct Registry Admin CLI
 *
 * Usage:
 *   ADMIN_TOKEN=<token> bun scripts/admin-cli.ts <command> [args]
 *
 * Commands:
 *   stats                              Registry statistics
 *   list [--status=pending|published|deprecated|yanked]
 *   list-pending                       Alias for list --status=pending
 *   publish <path>   [--trust=reviewed|org-approved] [--force-publish]
 *   publish-all <dir> [--trust=reviewed] [--force-publish]
 *   approve <dd_id> <version> [--trust=reviewed|org-approved] [--note=...]
 *   reject  <dd_id> <version> [--note=...]
 *   yank    <dd_id> <version> [--note=...]
 *   set-status <dd_id> <version> <status>
 *   token-add <raw_token> <actor_id> <role>  [--expires=ISO8601] [--note=...]
 *   upload-package <dd_id> <version> <zip_path>
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import AdmZip from "adm-zip";
import yaml from "js-yaml";

// ─── Config ───────────────────────────────────────────────────────────────────

const REGISTRY_URL = process.env.MINDACT_REGISTRY_URL ?? "https://registry.physical-mind.ai";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? process.env.REGISTRY_TOKEN ?? "";

if (!ADMIN_TOKEN) {
  console.error("Error: ADMIN_TOKEN environment variable is required.");
  process.exit(1);
}

function authHeaders(extra?: Record<string, string>) {
  return { "Authorization": `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json", ...extra };
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    method,
    headers: authHeaders(body ? undefined : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdStats() {
  const data = await api("GET", "/registry/admin/stats") as any;
  console.log("\n── Registry Stats ──────────────────────────────");
  console.log(`  Total packages : ${data.total_packages}`);
  console.log(`  Total installs : ${data.total_installs}`);
  if (data.by_status?.length) {
    console.log("  By status:");
    for (const s of data.by_status) console.log(`    ${s.status.padEnd(12)} ${s.cnt}`);
  }
  if (data.governance?.length) {
    console.log("  Governance events:");
    for (const e of data.governance) console.log(`    ${e.event_type.padEnd(18)} ${e.cnt}`);
  }
}

async function cmdList(status?: string) {
  const qs = status ? `?status=${status}` : "";
  const data = await api("GET", `/registry/admin/list${qs}`) as any;
  const items = data.items ?? [];
  if (items.length === 0) { console.log("(empty)"); return; }
  console.log(`\n${"ID".padEnd(36)} ${"NAME".padEnd(28)} ${"VER".padEnd(8)} ${"STATUS".padEnd(12)} TRUST`);
  console.log("─".repeat(100));
  for (const i of items) {
    console.log(`${String(i.id).padEnd(36)} ${String(i.name).padEnd(28)} ${String(i.version).padEnd(8)} ${String(i.pkg_status).padEnd(12)} ${i.trust}`);
  }
  console.log(`\n${items.length} item(s)`);
}

async function cmdListPending() {
  const data = await api("GET", "/registry/admin/pending") as any;
  const items = data.items ?? [];
  if (items.length === 0) { console.log("No pending items."); return; }
  console.log(`\n${"DD_ID".padEnd(36)} ${"NAME".padEnd(28)} ${"VER".padEnd(8)} ${"PUBLISHER".padEnd(20)} HAS_ZIP`);
  console.log("─".repeat(100));
  for (const i of items) {
    console.log(`${String(i.id).padEnd(36)} ${String(i.name).padEnd(28)} ${String(i.version).padEnd(8)} ${String(i.publisher).padEnd(20)} ${i.r2_zip_key ? "yes" : "no"}`);
  }
  console.log(`\n${items.length} pending item(s)`);
}

async function cmdApprove(ddId: string, version: string, trust: string, note?: string) {
  const data = await api("POST", "/registry/admin/approve", {
    dd_id: ddId, version, action: "approve", trust: trust ?? "reviewed", note,
  }) as any;
  console.log(`✓ Approved ${ddId}@${version} → trust=${trust} status=${data.status}`);
}

async function cmdReject(ddId: string, version: string, note?: string) {
  await api("POST", "/registry/admin/approve", { dd_id: ddId, version, action: "reject", note });
  console.log(`✓ Rejected ${ddId}@${version}`);
}

async function cmdYank(ddId: string, version: string, note?: string) {
  await api("POST", "/registry/admin/approve", { dd_id: ddId, version, action: "yank", note });
  console.log(`✓ Yanked ${ddId}@${version}`);
}

async function cmdSetStatus(ddId: string, version: string, status: string) {
  await api("POST", "/registry/admin/set-status", { dd_id: ddId, version, status });
  console.log(`✓ ${ddId}@${version} status → ${status}`);
}

async function cmdTokenAdd(rawToken: string, actorId: string, role: string, expiresAt?: string, note?: string) {
  const data = await api("POST", "/registry/admin/token", {
    raw_token: rawToken, actor_id: actorId, role, expires_at: expiresAt, note,
  }) as any;
  console.log(`✓ Token registered: actor=${data.actor_id} role=${data.role} hash_prefix=${data.hash_prefix}`);
}

async function uploadPackageFile(ddId: string, version: string, zipPath: string) {
  const zipBytes = readFileSync(zipPath);
  const form = new FormData();
  form.append("dd_id", ddId);
  form.append("version", version);
  form.append("package", new Blob([zipBytes], { type: "application/zip" }), basename(zipPath));
  const res = await fetch(`${REGISTRY_URL}/registry/upload-package`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },
    body: form,
  });
  if (!res.ok) { console.error(`Upload failed: ${res.status} ${await res.text()}`); process.exit(1); }
  return res.json() as Promise<{ zip_sha256: string; zip_size_bytes: number }>;
}

/** Pack a skill directory into a zip, return the zip bytes. */
function packSkillDir(dirPath: string): { zipBytes: Buffer; skillMdText: string | null } {
  const zip = new AdmZip();
  const files = readdirSync(dirPath, { recursive: true, withFileTypes: true } as any);
  let skillMdText: string | null = null;

  function addDir(dir: string, zipPrefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      const zipPath = join(zipPrefix, entry.name);
      if (entry.isDirectory()) {
        addDir(fullPath, zipPath);
      } else {
        zip.addLocalFile(fullPath, zipPrefix);
        if (entry.name === "SKILL.md") {
          skillMdText = readFileSync(fullPath, "utf-8");
        }
      }
    }
  }
  addDir(dirPath, "");
  return { zipBytes: zip.toBuffer(), skillMdText };
}

/** Read decision-dependency.yaml or SKILL.md frontmatter to get DD metadata. */
function readManifest(dirPath: string): Record<string, unknown> | null {
  const yamlPath = join(dirPath, "decision-dependency.yaml");
  if (existsSync(yamlPath)) {
    try { return yaml.load(readFileSync(yamlPath, "utf-8")) as Record<string, unknown>; } catch { return null; }
  }
  const skillMdPath = join(dirPath, "SKILL.md");
  if (existsSync(skillMdPath)) {
    const text = readFileSync(skillMdPath, "utf-8");
    const match = text.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      try { return yaml.load(match[1]) as Record<string, unknown>; } catch { return null; }
    }
  }
  return null;
}

async function cmdPublish(dirPath: string, trust: string, forcePublish: boolean) {
  const abs = resolve(dirPath);
  if (!existsSync(abs)) { console.error(`Path not found: ${abs}`); process.exit(1); }

  const manifest = readManifest(abs);
  if (!manifest?.id || !manifest?.version) {
    console.error(`Cannot publish: missing id or version in manifest at ${abs}`);
    process.exit(1);
  }

  const ddId = String(manifest.id);
  const version = String(manifest.version);
  console.log(`Publishing ${ddId}@${version} from ${abs}...`);

  // Step 1: Register metadata
  const ddPayload = {
    ...manifest,
    trust,
    _status: forcePublish ? "published" : "pending",
  };
  await api("POST", "/registry/publish", ddPayload);
  console.log(`  ✓ Metadata registered (status=${ddPayload._status})`);

  // Step 2: Pack + upload zip
  const { zipBytes, skillMdText } = packSkillDir(abs);
  const tmpPath = `/tmp/${ddId}_v${version}.zip`;
  require("fs").writeFileSync(tmpPath, zipBytes);
  const uploadResult = await uploadPackageFile(ddId, version, tmpPath);
  require("fs").unlinkSync(tmpPath);

  console.log(`  ✓ Package uploaded: ${(uploadResult.zip_size_bytes / 1024).toFixed(1)} KB sha256=${uploadResult.zip_sha256.slice(0, 12)}…`);

  if (!forcePublish) {
    console.log(`  → Status is 'pending'. Run: bun scripts/admin-cli.ts approve ${ddId} ${version} --trust=${trust}`);
  }
}

async function cmdPublishAll(dirPath: string, trust: string, forcePublish: boolean) {
  const abs = resolve(dirPath);
  const entries = readdirSync(abs, { withFileTypes: true }).filter(e => e.isDirectory());
  console.log(`Publishing ${entries.length} directories from ${abs}...`);
  for (const entry of entries) {
    const subDir = join(abs, entry.name);
    const manifest = readManifest(subDir);
    if (!manifest?.id) {
      console.log(`  ⚠ Skipping ${entry.name} — no manifest`);
      continue;
    }
    await cmdPublish(subDir, trust, forcePublish);
  }
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];

for (const arg of args) {
  if (arg.startsWith("--")) {
    const [k, v] = arg.slice(2).split("=");
    flags[k] = v ?? true;
  } else {
    positional.push(arg);
  }
}

const [command, ...rest] = positional;

switch (command) {
  case "stats":
    await cmdStats();
    break;
  case "list":
    await cmdList(flags.status as string);
    break;
  case "list-pending":
    await cmdListPending();
    break;
  case "approve":
    if (rest.length < 2) { console.error("Usage: approve <dd_id> <version> [--trust=reviewed] [--note=...]"); process.exit(1); }
    await cmdApprove(rest[0], rest[1], (flags.trust as string) ?? "reviewed", flags.note as string);
    break;
  case "reject":
    if (rest.length < 2) { console.error("Usage: reject <dd_id> <version> [--note=...]"); process.exit(1); }
    await cmdReject(rest[0], rest[1], flags.note as string);
    break;
  case "yank":
    if (rest.length < 2) { console.error("Usage: yank <dd_id> <version> [--note=...]"); process.exit(1); }
    await cmdYank(rest[0], rest[1], flags.note as string);
    break;
  case "set-status":
    if (rest.length < 3) { console.error("Usage: set-status <dd_id> <version> <status>"); process.exit(1); }
    await cmdSetStatus(rest[0], rest[1], rest[2]);
    break;
  case "token-add":
    if (rest.length < 3) { console.error("Usage: token-add <raw_token> <actor_id> <role>"); process.exit(1); }
    await cmdTokenAdd(rest[0], rest[1], rest[2], flags.expires as string, flags.note as string);
    break;
  case "upload-package":
    if (rest.length < 3) { console.error("Usage: upload-package <dd_id> <version> <zip_path>"); process.exit(1); }
    await uploadPackageFile(rest[0], rest[1], rest[2]).then(r =>
      console.log(`✓ Uploaded: sha256=${r.zip_sha256} size=${r.zip_size_bytes} bytes`)
    );
    break;
  case "publish":
    if (!rest[0]) { console.error("Usage: publish <path> [--trust=reviewed] [--force-publish]"); process.exit(1); }
    await cmdPublish(rest[0], (flags.trust as string) ?? "reviewed", !!flags["force-publish"]);
    break;
  case "publish-all":
    if (!rest[0]) { console.error("Usage: publish-all <dir> [--trust=reviewed] [--force-publish]"); process.exit(1); }
    await cmdPublishAll(rest[0], (flags.trust as string) ?? "reviewed", !!flags["force-publish"]);
    break;
  default:
    console.log(`
mindact-admin — MindAct Registry Admin CLI
Registry: ${REGISTRY_URL}

Commands:
  stats                                Registry statistics
  list [--status=pending|published|deprecated|yanked]
  list-pending                         Alias for list --status=pending
  publish <path> [--trust=reviewed] [--force-publish]
  publish-all <dir> [--trust=reviewed] [--force-publish]
  approve <dd_id> <version> [--trust=reviewed|org-approved] [--note=...]
  reject  <dd_id> <version> [--note=...]
  yank    <dd_id> <version> [--note=...]
  set-status <dd_id> <version> <status>
  token-add <raw_token> <actor_id> <role> [--expires=ISO] [--note=...]
  upload-package <dd_id> <version> <zip_path>
`);
}
