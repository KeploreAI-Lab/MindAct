/**
 * skill_sync.ts — Shared utility for syncing local skill directories into the
 * paths that PhysMind CLI reads at skill-load time.
 *
 * Called from two places:
 *   1. server.ts  — after extractSkillZips() on GET /api/skills/tree (fallback/repair)
 *   2. registry.ts — immediately after POST /api/registry/install extracts a ZIP
 *
 * Also exports syncCloudSkillStubs() which is called at server startup to pull
 * published cloud skills as lightweight SKILL.md stubs into the local skills dir,
 * making them visible to the PhysMind agent without a full install.
 *
 * Writes symlinks to two locations to cover all physmind launch configurations:
 *   ~/.config/physmind/claw/skills/  — CLAW_CONFIG_HOME set by pty-worker (primary)
 *   ~/.physmind/skills/               — legacy path (backward compat)
 *
 * Idempotent: replaces stale symlinks, skips already-correct ones.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * Fetch published cloud skills and create lightweight SKILL.md stubs locally.
 *
 * For each cloud skill that isn't already installed, downloads the SKILL.md
 * content and writes it to `{skillsRoot}/{id}/SKILL.md` along with a
 * `.cloud-stub` marker. Then calls syncSkillsToPhysmind() so PhysMind
 * can read them immediately.
 *
 * Stubs are distinguishable from full installs by the presence of `.cloud-stub`.
 * When a full install arrives later, the stub is overwritten naturally.
 */
export async function syncCloudSkillStubs(
  registryUrl: string,
  skillsRoot: string,
  token?: string,
): Promise<void> {
  try {
    mkdirSync(skillsRoot, { recursive: true });

    // Fetch published skill list
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const listRes = await fetch(
      `${registryUrl.replace(/\/$/, "")}/registry/list?status=published&type=skill`,
      { headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!listRes.ok) {
      console.warn(`[skill_sync] cloud list failed: ${listRes.status}`);
      return;
    }
    const { items } = await listRes.json() as { items: Array<{ id: string; name: string; version?: string }> };
    if (!Array.isArray(items) || items.length === 0) return;

    let synced = 0;
    for (const item of items) {
      const skillDir = join(skillsRoot, item.id);
      const skillMdPath = join(skillDir, "SKILL.md");
      const stubMarker = join(skillDir, ".cloud-stub");

      // Skip if fully installed (no stub marker) or content already present
      if (existsSync(skillMdPath) && !existsSync(stubMarker)) continue;

      try {
        const version = item.version ? `?version=${encodeURIComponent(item.version)}` : "";
        const contentRes = await fetch(
          `${registryUrl.replace(/\/$/, "")}/registry/item/${encodeURIComponent(item.id)}/content${version}`,
          { headers, signal: AbortSignal.timeout(8_000) },
        );
        if (!contentRes.ok) continue;
        const content = await contentRes.text();
        if (!content.trim()) continue;

        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillMdPath, content, "utf-8");
        writeFileSync(stubMarker, item.version ?? "", "utf-8");
        synced++;
      } catch (e) {
        // Non-fatal — skip this skill
        console.warn(`[skill_sync] failed to stub ${item.id}:`, e instanceof Error ? e.message : e);
      }
    }

    if (synced > 0) {
      console.log(`[skill_sync] synced ${synced} cloud skill stubs`);
      syncSkillsToPhysmind(skillsRoot); // also calls writeSkillsIndex
    } else {
      // Even if no new stubs arrived, ensure the index file is up-to-date
      // (covers first-run case when all stubs already existed on disk).
      writeSkillsIndex(skillsRoot);
    }
  } catch (e) {
    // Network unavailable or registry down — silently skip
    console.warn("[skill_sync] cloud stub sync failed:", e instanceof Error ? e.message : e);
  }
}

// ─── Skills Index ─────────────────────────────────────────────────────────────

interface SkillIndexEntry {
  id: string;
  name: string;
  description: string;
  domain: string;
  tags: string[];
  /** true = fully installed; false = cloud stub only */
  installed: boolean;
  stub: boolean;
  path: string;
}

/**
 * Write ~/.physmind/installed-skills.json with metadata for every skill in skillsRoot.
 * Called after any skill change so the PhysMind agent can discover skills via its
 * file-reading tools without a terminal restart.
 */
export function writeSkillsIndex(skillsRoot: string): void {
  const indexPath = join(homedir(), ".physmind", "installed-skills.json");
  try {
    mkdirSync(join(homedir(), ".physmind"), { recursive: true });
    const skills: SkillIndexEntry[] = [];
    if (existsSync(skillsRoot)) {
      for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(skillsRoot, entry.name);
        const skillMdPath = join(skillDir, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;
        const raw = indexSafeRead(skillMdPath);
        const fm = indexParseFrontmatter(raw);
        const isStub = existsSync(join(skillDir, ".cloud-stub"));
        skills.push({
          id: entry.name,
          name: fm.name || entry.name,
          description: fm.description || "",
          domain: fm.domain || "",
          tags: fm.tags,
          installed: !isStub,
          stub: isStub,
          path: skillDir,
        });
      }
    }
    writeFileSync(
      indexPath,
      JSON.stringify({ updated: new Date().toISOString(), skills_dir: skillsRoot, skills }, null, 2),
      "utf-8",
    );
  } catch (e) {
    console.warn("[skill_sync] failed to write skills index:", e instanceof Error ? e.message : e);
  }
}

function indexSafeRead(p: string): string {
  try { return readFileSync(p, "utf-8"); } catch { return ""; }
}

function indexParseFrontmatter(raw: string): { name: string; description: string; domain: string; tags: string[] } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: "", description: "", domain: "", tags: [] };
  const fm = match[1];
  const get = (k: string) => {
    const r = fm.match(new RegExp(`^${k}:\\s*(.+)$`, "m"));
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const rawTags = get("tags");
  const tags = rawTags
    ? rawTags.replace(/^\[|\]$/g, "").split(",").map(t => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];
  return { name: get("name"), description: get("description"), domain: get("domain"), tags };
}

// ─── Symlink Sync ─────────────────────────────────────────────────────────────

export function syncSkillsToPhysmind(skillsRoot: string): void {
  // pty-worker sets: CLAW_CONFIG_HOME = ~/.config/physmind/claw
  // PhysMind reads skills from: getClaudeConfigHomeDir()/skills = CLAW_CONFIG_HOME/skills
  const targets = [
    join(homedir(), ".config", "physmind", "claw", "skills"), // primary: CLAW_CONFIG_HOME/skills
    join(homedir(), ".physmind", "skills"),                    // legacy fallback
  ];

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const targetDir of targets) {
    try { mkdirSync(targetDir, { recursive: true }); } catch {}

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(skillsRoot, entry.name);
      if (!existsSync(join(skillDir, "SKILL.md"))) continue;

      const linkPath = join(targetDir, entry.name);

      // Remove stale symlink or directory at that path
      let linkExists = false;
      try { lstatSync(linkPath); linkExists = true; } catch {}
      if (linkExists) {
        try { rmSync(linkPath, { recursive: true, force: true }); } catch {}
      }

      try {
        symlinkSync(skillDir, linkPath);
        console.log(`[skill_sync] linked ${entry.name} → ${linkPath}`);
      } catch (e) {
        console.warn(`[skill_sync] failed to link ${entry.name} in ${targetDir}:`, e);
      }
    }
  }

  // Keep the skills index up-to-date whenever symlinks are refreshed.
  writeSkillsIndex(skillsRoot);
}
