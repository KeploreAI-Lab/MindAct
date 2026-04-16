/**
 * registry.ts — All /api/registry/* route handlers.
 *
 * Export a single dispatch function: handleRegistry(req, url).
 * Returns a Response if the request matches /api/registry/*, or null to fall through.
 *
 * Consistent with the existing Bun serve() pattern in server.ts — no Express/Hono.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import AdmZip from "adm-zip";
import { loadLocalRegistry, getLocalContent } from "../../decision_manager/registry/local_registry.ts";
import { RemoteRegistry } from "../../decision_manager/registry/remote_registry.ts";
import { previewGitHubImport } from "../../decision_manager/registry/github_import.ts";
import { cacheGetList, cacheSetList, cacheGetItem, cacheSetItem, cacheInvalidateItem, cacheDeletePrefix } from "../../decision_manager/registry/cache.ts";
import { syncSkillsToPhysmind } from "../utils/skill_sync.ts";

// One-time startup: purge any list-cache entries written by the old code that
// used an incomplete cache key (only included `type`, dropped query/domain/etc.).
// This ensures stale narrow results don't masquerade as the full list.
cacheDeletePrefix("registry:list:");
import type { DecisionDependency, RegistryFilter } from "../../decision_manager/index.ts";
import yaml from "js-yaml";

// ─── Config helpers (inline to avoid circular dep with server.ts) ─────────────

const CONFIG_FILE = join(homedir(), ".physmind", "config.json");

// Default cloud registry — used when registry_url is absent from config.
// Override at runtime via MINDACT_REGISTRY_URL env var.
const DEFAULT_REGISTRY_URL =
  process.env.MINDACT_REGISTRY_URL ??
  "https://mindact-registry.marvin-gao-cs.workers.dev";

interface RegistryConfig {
  skills_path?: string;
  registry_url?: string;
  registry_token?: string;
}

function readRegistryConfig(): RegistryConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(require("fs").readFileSync(CONFIG_FILE, "utf-8")) as RegistryConfig;
  } catch {
    return {};
  }
}

function defaultSkillsRoot(): string {
  return join(process.cwd(), "skills-test");
}

// ─── Registry status cache (in-process, refreshed every 5 min) ───────────────

interface RegistryStatus {
  status: "connected" | "unreachable" | "degraded";
  stats: { total_packages: number; total_installs: number; last_updated: string | null } | null;
  worker_version: string | null;
  registry_url: string;
  checked_at: string;
}

let _statusCache: RegistryStatus | null = null;
let _statusCheckedAt = 0;
const STATUS_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchRegistryStatus(registryUrl: string, token?: string): Promise<RegistryStatus> {
  const now = Date.now();
  if (_statusCache && (now - _statusCheckedAt) < STATUS_TTL_MS) {
    return _statusCache;
  }
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${registryUrl}/registry/health`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as {
        status: string;
        stats: { total_packages: number; total_installs: number; last_updated: string | null };
        worker_version: string;
      };
      _statusCache = {
        status: "connected",
        stats: data.stats,
        worker_version: data.worker_version,
        registry_url: registryUrl,
        checked_at: new Date().toISOString(),
      };
    } else {
      _statusCache = {
        status: "degraded",
        stats: null,
        worker_version: null,
        registry_url: registryUrl,
        checked_at: new Date().toISOString(),
      };
    }
  } catch {
    _statusCache = {
      status: "unreachable",
      stats: null,
      worker_version: null,
      registry_url: registryUrl,
      checked_at: new Date().toISOString(),
    };
  }
  _statusCheckedAt = now;
  return _statusCache!;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export interface RegistryHooks {
  /** Called after a skill ZIP is successfully extracted and symlinked. */
  onSkillInstalled?: (skillsDir: string, name: string, id: string) => void;
}

// ─── Main dispatch ─────────────────────────────────────────────────────────────

export async function handleRegistry(
  req: Request,
  url: URL,
  hooks: RegistryHooks = {}
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/registry/")) return null;

  const cfg = readRegistryConfig();
  const skillsDir = cfg.skills_path || defaultSkillsRoot();
  const registryUrl = cfg.registry_url || DEFAULT_REGISTRY_URL;
  const remote = new RemoteRegistry(registryUrl, cfg.registry_token);

  // ── GET /api/registry/status ───────────────────────────────────────────────
  if (url.pathname === "/api/registry/status" && req.method === "GET") {
    const status = await fetchRegistryStatus(registryUrl, cfg.registry_token);
    return json(status);
  }

  // ── GET /api/registry/list ─────────────────────────────────────────────────
  if (url.pathname === "/api/registry/list" && req.method === "GET") {
    const filter: RegistryFilter = {};
    if (url.searchParams.get("type")) filter.type = url.searchParams.get("type") as DecisionDependency["type"];
    if (url.searchParams.get("domain")) filter.domain = url.searchParams.get("domain")!;
    if (url.searchParams.get("visibility")) filter.visibility = url.searchParams.get("visibility") as DecisionDependency["visibility"];
    if (url.searchParams.get("trust")) filter.trust = url.searchParams.get("trust") as DecisionDependency["trust"];
    if (url.searchParams.get("query")) filter.query = url.searchParams.get("query")!;
    if (url.searchParams.get("tags")) filter.tags = url.searchParams.get("tags")!.split(",");

    try {
      // Load local registry first
      let items = await loadLocalRegistry(skillsDir);

      // Always try to merge remote items; local items take precedence for same id
      {
        const localIds = new Set(items.map(i => i.id));
        // Cache key must NOT include query — query filtering happens locally below,
        // so we always fetch the full base list from remote and cache it cleanly.
        const cacheKey: Record<string, string> = {};
        if (filter.type) cacheKey.type = filter.type;
        if (filter.domain) cacheKey.domain = filter.domain;
        if (filter.trust) cacheKey.trust = filter.trust;
        if (filter.visibility) cacheKey.visibility = filter.visibility;
        const cached = cacheGetList(cacheKey);
        if (cached) {
          items = [...items, ...cached.filter(i => !localIds.has(i.id))];
        } else {
          try {
            // Fetch without query so the cached result is the full base list.
            // Local query filtering is applied after (lines below).
            const baseFilter = { ...filter, query: undefined };
            const remoteItems = await remote.list(baseFilter);
            cacheSetList(cacheKey, remoteItems);
            items = [...items, ...remoteItems.filter(i => !localIds.has(i.id))];
          } catch {
            // Remote unavailable — local only, status will reflect this
          }
        }
      }

      // Apply query filter on local results
      if (filter.query) {
        const q = filter.query.toLowerCase();
        items = items.filter(i =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.tags.some(t => t.toLowerCase().includes(q))
        );
      }
      if (filter.type) items = items.filter(i => i.type === filter.type);
      if (filter.domain) items = items.filter(i => i.domain === filter.domain);
      if (filter.trust) items = items.filter(i => i.trust === filter.trust);

      return json({ items });
    } catch (e: any) {
      return err(`Failed to list registry: ${e.message}`);
    }
  }

  // ── GET /api/registry/item/:id/content ────────────────────────────────────
  if (url.pathname.match(/^\/api\/registry\/item\/[^/]+\/content$/) && req.method === "GET") {
    const id = decodeURIComponent(url.pathname.split("/")[4]);
    const version = url.searchParams.get("version") ?? undefined;

    try {
      // Try local first
      const items = await loadLocalRegistry(skillsDir);
      const dd = items.find(i => i.id === id && (!version || i.version === version));
      if (dd) {
        const content = await getLocalContent(dd);
        return new Response(content, {
          headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Fall through to remote registry for cloud-only items
      const remoteDD = await remote.get(id, version);
      if (!remoteDD) return err("Not found", 404);
      const content = await remote.getContent(remoteDD);
      return new Response(content, {
        headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" },
      });
    } catch (e: any) {
      return err(`Failed to get content: ${e.message}`);
    }
  }

  // ── GET /api/registry/item/:id ─────────────────────────────────────────────
  if (url.pathname.match(/^\/api\/registry\/item\/[^/]+$/) && req.method === "GET") {
    const id = decodeURIComponent(url.pathname.split("/")[4]);
    const version = url.searchParams.get("version") ?? undefined;

    try {
      const cached = cacheGetItem(id);
      if (cached && (!version || cached.version === version)) return json(cached);

      const items = await loadLocalRegistry(skillsDir);
      const dd = items.find(i => i.id === id && (!version || i.version === version));
      if (!dd) {
        if (remote) {
          const remoteDD = await remote.get(id, version);
          if (remoteDD) { cacheSetItem(remoteDD); return json(remoteDD); }
        }
        return err("Not found", 404);
      }
      cacheSetItem(dd);
      return json(dd);
    } catch (e: any) {
      return err(`Failed to get item: ${e.message}`);
    }
  }

  // ── GET /api/registry/item/:id/versions ───────────────────────────────────
  if (url.pathname.match(/^\/api\/registry\/item\/[^/]+\/versions$/) && req.method === "GET") {
    const id = decodeURIComponent(url.pathname.split("/")[4]);
    try {
      const items = await loadLocalRegistry(skillsDir);
      const versions = items.filter(i => i.id === id).map(i => i.version);
      return json({ versions });
    } catch (e: any) {
      return err(`Failed to list versions: ${e.message}`);
    }
  }

  // ── POST /api/registry/import/github ─────────────────────────────────────
  if (url.pathname === "/api/registry/import/github" && req.method === "POST") {
    try {
      const body = await req.json() as { repoUrl: string; ref?: string; token?: string };
      if (!body.repoUrl) return err("repoUrl is required");
      const preview = await previewGitHubImport({
        repoUrl: body.repoUrl,
        ref: body.ref,
        token: body.token,
      });
      return json(preview);
    } catch (e: any) {
      return err(`GitHub import preview failed: ${e.message}`);
    }
  }

  // ── POST /api/registry/import/github/confirm ──────────────────────────────
  if (url.pathname === "/api/registry/import/github/confirm" && req.method === "POST") {
    try {
      const body = await req.json() as {
        importHash: string;
        selectedCandidates: number[];
        overrides: Partial<DecisionDependency>[];
        previewCandidates: DecisionDependency[];
        uploadToCloud?: boolean;   // true = full upload to R2/D1; false = local skeleton only
        githubToken?: string;      // for private repos
      };
      const uploadToCloud = body.uploadToCloud ?? false;

      const results: DecisionDependency[] = [];

      for (let i = 0; i < body.selectedCandidates.length; i++) {
        const candidateIndex = body.selectedCandidates[i];
        const draft = body.previewCandidates[candidateIndex];
        const override = body.overrides[i] ?? {};
        const finalDD: DecisionDependency = { ...draft, ...override };

        // Always write local files
        const skillDir = join(skillsDir, finalDD.id);
        mkdirSync(skillDir, { recursive: true });

        let skillMdContent: string;

        if (uploadToCloud && finalDD.source.type === "github") {
          // ── Full cloud import ──────────────────────────────────────────────
          const src = finalDD.source as { repoUrl: string; ref?: string; commitSha?: string };
          const { owner, repo } = parseGitHubUrl(src.repoUrl);
          const ref = src.ref ?? "main";
          const ghHeaders: Record<string, string> = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "MindAct-Registry/1.0",
          };
          if (body.githubToken) ghHeaders["Authorization"] = `token ${body.githubToken}`;

          // Fetch tree to know what files to download
          const treeRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/${src.commitSha ?? ref}?recursive=1`,
            { headers: ghHeaders }
          );
          const treeData = await treeRes.json() as { tree: { path: string; type: string; sha: string }[] };
          const blobs = treeData.tree.filter(t => t.type === "blob");

          // Download each file and add to zip
          const AdmZipLib = (await import("adm-zip")).default;
          const zip = new AdmZipLib();
          skillMdContent = "";

          for (const blob of blobs) {
            const contentRes = await fetch(
              `https://api.github.com/repos/${owner}/${repo}/contents/${blob.path}?ref=${ref}`,
              { headers: ghHeaders }
            );
            if (!contentRes.ok) continue;
            const contentData = await contentRes.json() as { content?: string; encoding?: string };
            if (contentData.content && contentData.encoding === "base64") {
              const fileBytes = Buffer.from(contentData.content.replace(/\n/g, ""), "base64");
              const dir = blob.path.includes("/") ? blob.path.substring(0, blob.path.lastIndexOf("/")) : "";
              zip.addFile(blob.path, fileBytes, "", dir);
              if (blob.path.toLowerCase() === "skill.md" || blob.path.endsWith("/SKILL.md")) {
                skillMdContent = fileBytes.toString("utf-8");
              }
              // Write to local skillsDir too
              if (dir) mkdirSync(join(skillDir, dir), { recursive: true });
              writeFileSync(join(skillDir, blob.path), fileBytes);
            }
          }

          if (!skillMdContent) {
            skillMdContent = [
              "---",
              `name: ${finalDD.name}`,
              `description: ${finalDD.description}`,
              `domain: ${finalDD.domain || ""}`,
              "---",
              `# ${finalDD.name}`,
              "",
              `> Imported from ${src.repoUrl}`,
            ].join("\n");
          }

          // Add manifest.json + SKILL.md to zip
          zip.addFile("manifest.json", Buffer.from(JSON.stringify(finalDD, null, 2)));
          zip.addFile("SKILL.md", Buffer.from(skillMdContent));

          const zipBytes = zip.toBuffer();

          // Publish metadata to cloud (status=pending, awaiting admin review)
          await remote.publish({ ...finalDD, _status: "pending" } as any);

          // Upload zip to cloud
          await remote.uploadPackage(finalDD.id, finalDD.version, zipBytes.buffer as ArrayBuffer, skillMdContent);
        } else {
          // ── Local skeleton only (legacy mode) ─────────────────────────────
          skillMdContent = [
            "---",
            `name: ${finalDD.name}`,
            `description: ${finalDD.description}`,
            `domain: ${finalDD.domain || ""}`,
            "---",
            "",
            `# ${finalDD.name}`,
            "",
            `> Imported from ${finalDD.source.type === "github" ? (finalDD.source as any).repoUrl : "unknown"}`,
            "",
          ].join("\n");
          writeFileSync(join(skillDir, "SKILL.md"), skillMdContent, "utf-8");
        }

        // Write decision-dependency.yaml locally
        const manifestContent = yaml.dump({
          id: finalDD.id,
          name: finalDD.name,
          description: finalDD.description,
          version: finalDD.version,
          type: finalDD.type,
          modes: finalDD.modes,
          tags: finalDD.tags,
          domain: finalDD.domain,
          publisher: finalDD.publisher,
          visibility: finalDD.visibility,
          trust: finalDD.trust,
          maturity: finalDD.maturity,
        });
        writeFileSync(join(skillDir, "decision-dependency.yaml"), manifestContent, "utf-8");

        finalDD.installedAt = new Date().toISOString();
        results.push(finalDD);
      }

      return json({ confirmed: results, uploadedToCloud: uploadToCloud });
    } catch (e: any) {
      return err(`GitHub import confirm failed: ${e.message}`);
    }
  }

  // ── POST /api/registry/install ────────────────────────────────────────────
  if (url.pathname === "/api/registry/install" && req.method === "POST") {
    try {
      const body = await req.json() as { id: string; version?: string };

      // Step 1: Record install on remote, get download info
      const ddRaw = await remote.install(body.id, body.version) as DecisionDependency & {
        _download?: { url: string; sha256: string | null; size_bytes: number | null } | null;
      };
      const downloadInfo = ddRaw._download;
      const dd: DecisionDependency = { ...ddRaw };
      delete (dd as any)._download;

      cacheSetItem(dd);

      // Step 2: If zip is available, download + verify + extract to skillsDir
      if (downloadInfo?.url) {
        try {
          const { bytes, sha256: serverSha256 } = await remote.downloadPackage(dd.id, dd.version);

          // Verify checksum
          if (serverSha256) {
            const localHash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
            if (localHash !== serverSha256) {
              return err(`Integrity check failed for ${dd.id}: expected ${serverSha256}, got ${localHash}`, 500);
            }
          }

          // Extract zip to skillsDir
          const zipBuffer = Buffer.from(bytes);
          const zip = new AdmZip(zipBuffer);
          const destDir = join(skillsDir, dd.id);
          mkdirSync(destDir, { recursive: true });
          zip.extractAllTo(destDir, /* overwrite */ true);

          // Ensure manifest file is up-to-date
          const manifestPath = join(destDir, "decision-dependency.yaml");
          if (!existsSync(manifestPath)) {
            writeFileSync(manifestPath, yaml.dump({
              id: dd.id,
              name: dd.name,
              description: dd.description,
              version: dd.version,
              type: dd.type,
              modes: dd.modes,
              tags: dd.tags,
              domain: dd.domain,
              publisher: dd.publisher,
              visibility: dd.visibility,
              trust: dd.trust,
              maturity: dd.maturity,
            }), "utf-8");
          }

          // 断层1: create symlinks immediately so PhysMind CLI finds the skill on next load.
          // (Without this, symlinks only appear as a side-effect of GET /api/skills/tree.)
          try {
            syncSkillsToPhysmind(skillsDir);
            console.log(`[registry] symlink sync complete: ${dd.id}`);
          } catch (syncErr: any) {
            // Non-fatal: skill is on disk; symlinks will self-heal on next /api/skills/tree call.
            console.warn(`[registry] symlink sync warning for ${dd.id}:`, syncErr.message);
          }

          // 断层2: notify + restart running PTY sessions.
          // PhysMind memoizes its skill list per-process; only a fresh process reads new symlinks.
          // PhysMind persists transcripts to CLAW_CONFIG_HOME so the user can resume the session.
          hooks.onSkillInstalled?.(skillsDir, dd.name, dd.id);

          dd.installedAt = new Date().toISOString();
          return json({ ...dd, installed: true, extracted_to: destDir });
        } catch (extractErr: any) {
          // Download/extract failed — still return metadata so UI knows it's registered
          return json({ ...dd, installed: false, install_warning: extractErr.message });
        }
      }

      // No zip available — metadata-only install
      return json({ ...dd, installed: false, install_warning: "Package zip not yet available on registry" });
    } catch (e: any) {
      return err(`Install failed: ${e.message}`);
    }
  }

  // ── POST /api/registry/publish ────────────────────────────────────────────
  if (url.pathname === "/api/registry/publish" && req.method === "POST") {
    try {
      const dd = await req.json() as DecisionDependency;
      await remote.publish(dd);
      cacheInvalidateItem(dd.id);
      return json({ ok: true });
    } catch (e: any) {
      return err(`Publish failed: ${e.message}`);
    }
  }

  return null;
}

// ─── Shared Utilities ─────────────────────────────────────────────────────────

function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${url}`);
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
