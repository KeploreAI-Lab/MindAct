/**
 * Cloudflare Worker — MindAct Registry API
 *
 * Public routes (no auth):
 *   GET  /registry/health
 *   GET  /registry/list                           — user-aware: merges public + private + org
 *   GET  /registry/item/:id
 *   GET  /registry/item/:id/versions
 *   GET  /registry/item/:id/content?version=:ver
 *   GET  /registry/item/:id/download?version=:ver
 *   POST /registry/install                        — records user_id from X-User-Token
 *   POST /registry/fork
 *   POST /registry/approve                        — legacy compat
 *
 * User auth routes (mact_xxx token):
 *   POST /auth/register
 *   POST /auth/send-otp
 *   POST /auth/verify-otp
 *   GET  /auth/me
 *   PUT  /auth/me
 *
 * Org routes (mact_xxx token, org membership):
 *   POST   /orgs/create
 *   GET    /orgs/:id
 *   POST   /orgs/:id/invite
 *   DELETE /orgs/:id/members/:uid
 *
 * Publisher routes (admin_token with role=publisher or admin):
 *   POST /registry/publish
 *   POST /registry/upload-package
 *
 * Admin-only routes (admin_token with role=admin):
 *   GET  /registry/admin/stats
 *   GET  /registry/admin/list
 *   GET  /registry/admin/pending
 *   POST /registry/admin/approve
 *   POST /registry/admin/batch-approve
 *   POST /registry/admin/set-status
 *   GET  /registry/admin/analytics
 *   GET  /registry/admin/governance
 *   GET  /registry/admin/tokens
 *   POST /registry/admin/token
 *   GET  /registry/admin/users
 *   GET  /registry/admin/users/:id
 *   POST /registry/admin/users/:id/suspend
 *   GET  /registry/admin/orgs
 */

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  REGISTRY_KV: KVNamespace;
  REGISTRY_TOKEN?: string;
  RESEND_API_KEY?: string;      // wrangler secret put RESEND_API_KEY
  TURNSTILE_SECRET?: string;    // wrangler secret put TURNSTILE_SECRET
  TURNSTILE_SITE_KEY?: string;  // set in wrangler.toml [vars]
}

interface UserRow {
  id: string;
  email: string;
  username: string | null;
  is_active: number;
  token_prefix: string;
}

interface OtpSession {
  email: string;
  type: "register" | "retrieve";
  resend_count: number;
  last_resend_at: string | null;
}

// ─── KV Cache TTLs ─────────────────────────────────────────────────────────────
const LIST_TTL = 300;      // 5 minutes (public-only lists)
const ITEM_TTL = 3600;     // 1 hour
const CONTENT_TTL = 86400; // 24 hours

// ─── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      const response = await route(request, url, env);
      return cors(response);
    } catch (err: any) {
      return cors(jsonResponse({ error: err.message ?? String(err) }, 500));
    }
  },
};

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  // ── GET /register — public self-contained registration page ─────────────
  if (pathname === "/register" && method === "GET") {
    const redirect = url.searchParams.get("redirect") ?? "";
    const html = buildRegisterHtml(url.origin, redirect, env.TURNSTILE_SITE_KEY ?? "");
    return cors(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
  }

  // ── GET /registry/health ───────────────────────────────────────────────────
  if (pathname === "/registry/health" && method === "GET") {
    const [pkgResult, installResult, userResult] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as cnt FROM decision_dependencies").first<{ cnt: number }>(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM registry_installs").first<{ cnt: number }>(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE is_active = 1").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    ]);
    const lastUpdated = await env.DB.prepare(
      "SELECT MAX(updated_at) as ts FROM decision_dependencies"
    ).first<{ ts: string | null }>();
    return jsonResponse({
      status: "ok",
      stats: {
        total_packages: pkgResult?.cnt ?? 0,
        total_installs: installResult?.cnt ?? 0,
        total_users: (userResult as any)?.cnt ?? 0,
        last_updated: lastUpdated?.ts ?? null,
      },
      worker_version: "2.0.0",
    });
  }

  // ── GET /registry/list — user-aware ───────────────────────────────────────
  if (pathname === "/registry/list" && method === "GET") {
    const type = url.searchParams.get("type");
    const domain = url.searchParams.get("domain");
    const trust = url.searchParams.get("trust");
    const query = url.searchParams.get("query");
    const status = url.searchParams.get("status") ?? "published";

    // Resolve requesting user from X-User-Token (non-throwing)
    const user = await optionalUser(request, env);
    const orgIds = user ? await getUserOrgIds(user.id, env) : [];

    // For authenticated users we cannot cache as one user's private packages differ from another's.
    // Only cache the pure-public path.
    const isPublicOnly = !user;
    const cacheKey = isPublicOnly
      ? `list:public:${type}:${domain}:${trust}:${query}:${status}`
      : null;

    if (cacheKey) {
      const cached = await env.REGISTRY_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ items: cached });
    }

    // Build visibility WHERE clause
    let visibilitySql: string;
    const bindings: unknown[] = [];

    if (user && orgIds.length > 0) {
      const orgPlaceholders = orgIds.map(() => "?").join(", ");
      visibilitySql = `(d.visibility = 'public'
        OR (d.visibility = 'private' AND d.owner_user_id = ?)
        OR (d.visibility = 'org' AND d.owner_org_id IN (${orgPlaceholders})))`;
      bindings.push(user.id, ...orgIds);
    } else if (user) {
      visibilitySql = `(d.visibility = 'public' OR (d.visibility = 'private' AND d.owner_user_id = ?))`;
      bindings.push(user.id);
    } else {
      visibilitySql = `d.visibility = 'public'`;
    }

    let sql = `
      SELECT d.*, v.trust, v.maturity, v.version, v.manifest_json, v.r2_blob_key,
             v.r2_zip_key, v.zip_sha256, v.zip_size_bytes, v.status as pkg_status
      FROM decision_dependencies d
      JOIN dependency_versions v ON v.dd_id = d.id AND v.is_latest = 1
      WHERE ${visibilitySql}
    `;

    if (status !== "all") { sql += " AND v.status = ?"; bindings.push(status); }
    if (type) { sql += " AND d.type = ?"; bindings.push(type); }
    if (domain) { sql += " AND d.domain = ?"; bindings.push(domain); }
    if (trust) { sql += " AND v.trust = ?"; bindings.push(trust); }
    if (query) { sql += " AND (d.name LIKE ? OR d.description LIKE ?)"; bindings.push(`%${query}%`, `%${query}%`); }
    sql += " ORDER BY d.installed_count DESC LIMIT 200";

    const result = await env.DB.prepare(sql).bind(...bindings).all();
    const items = result.results.map(rowToDD);

    if (cacheKey) {
      await env.REGISTRY_KV.put(cacheKey, JSON.stringify(items), { expirationTtl: LIST_TTL });
    }
    return jsonResponse({ items });
  }

  // ── GET /registry/item/:id/content ─────────────────────────────────────────
  if (pathname.match(/^\/registry\/item\/[^/]+\/content$/) && method === "GET") {
    const id = decodeURIComponent(pathname.split("/")[3]);
    const version = url.searchParams.get("version") ?? await getLatestVersion(id, env);
    if (!version) return jsonResponse({ error: "Not found" }, 404);

    const cacheKey = `content:${id}:${version}`;
    const cached = await env.REGISTRY_KV.get(cacheKey);
    if (cached) return new Response(cached, { headers: { "Content-Type": "text/plain" } });

    const r2Key = `packages/${id}/v${version}/SKILL.md`;
    const obj = await env.BUCKET.get(r2Key);
    if (!obj) return jsonResponse({ error: "Content not found" }, 404);
    const text = await obj.text();

    await env.REGISTRY_KV.put(cacheKey, text, { expirationTtl: CONTENT_TTL });
    return new Response(text, { headers: { "Content-Type": "text/plain" } });
  }

  // ── GET /registry/item/:id/versions ────────────────────────────────────────
  if (pathname.match(/^\/registry\/item\/[^/]+\/versions$/) && method === "GET") {
    const id = decodeURIComponent(pathname.split("/")[3]);
    const result = await env.DB.prepare(
      `SELECT version, trust, maturity, status, published_at, is_latest,
              zip_sha256, zip_size_bytes, reviewed_by, reviewed_at
       FROM dependency_versions WHERE dd_id = ? ORDER BY published_at DESC`
    ).bind(id).all();
    return jsonResponse({ versions: result.results });
  }

  // ── GET /registry/item/:id ─────────────────────────────────────────────────
  if (pathname.match(/^\/registry\/item\/[^/]+$/) && method === "GET") {
    const id = decodeURIComponent(pathname.split("/")[3]);
    const version = url.searchParams.get("version");
    const cacheKey = `item:${id}:${version ?? "latest"}`;

    const cached = await env.REGISTRY_KV.get(cacheKey, "json");
    if (cached) return jsonResponse(cached);

    const versionClause = version ? "AND v.version = ?" : "AND v.is_latest = 1";
    const bindings = version ? [id, version] : [id];

    const row = await env.DB.prepare(`
      SELECT d.*, v.trust, v.maturity, v.version, v.manifest_json, v.r2_blob_key
      FROM decision_dependencies d
      JOIN dependency_versions v ON v.dd_id = d.id ${versionClause}
      WHERE d.id = ?
    `).bind(id, ...bindings.slice(1)).first();

    if (!row) return jsonResponse({ error: "Not found" }, 404);
    const dd = rowToDD(row);

    await env.REGISTRY_KV.put(cacheKey, JSON.stringify(dd), { expirationTtl: ITEM_TTL });
    return jsonResponse(dd);
  }

  // ── GET /registry/item/:id/download ───────────────────────────────────────
  if (pathname.match(/^\/registry\/item\/[^/]+\/download$/) && method === "GET") {
    const id = decodeURIComponent(pathname.split("/")[3]);
    const version = url.searchParams.get("version") ?? await getLatestVersion(id, env);
    if (!version) return jsonResponse({ error: "Not found" }, 404);

    const row = await env.DB.prepare(
      "SELECT r2_zip_key, zip_sha256, zip_size_bytes FROM dependency_versions WHERE dd_id = ? AND version = ?"
    ).bind(id, version).first<{ r2_zip_key: string | null; zip_sha256: string | null; zip_size_bytes: number | null }>();

    if (!row?.r2_zip_key) return jsonResponse({ error: "Package zip not available for this version" }, 404);

    const obj = await env.BUCKET.get(row.r2_zip_key);
    if (!obj) return jsonResponse({ error: "Package file not found in storage" }, 404);

    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${id}_v${version}.zip"`,
        ...(row.zip_size_bytes ? { "Content-Length": String(row.zip_size_bytes) } : {}),
        "X-Zip-SHA256": row.zip_sha256 ?? "",
      },
    });
  }

  // ── POST /registry/upload-package (auth required) ──────────────────────────
  if (pathname === "/registry/upload-package" && method === "POST") {
    // Accept both REGISTRY_TOKEN (admin) and mact_ user tokens
    const rawToken = request.headers.get("Authorization")?.replace("Bearer ", "");
    let uploadAuthorized = false;
    if (rawToken?.startsWith("mact_")) {
      const uploaderUser = await optionalUser(request, env);
      uploadAuthorized = uploaderUser != null;
    } else if (rawToken) {
      const tokenHash = await sha256hex(rawToken);
      const adminRow = await env.DB.prepare("SELECT 1 FROM admin_tokens WHERE token_hash = ?")
        .bind(tokenHash).first();
      uploadAuthorized = adminRow != null || (!!env.REGISTRY_TOKEN && rawToken === env.REGISTRY_TOKEN);
    } else {
      uploadAuthorized = !env.REGISTRY_TOKEN; // allow anonymous only if no token configured
    }
    if (!uploadAuthorized) return jsonResponse({ error: "Unauthorized" }, 401);
    const formData = await request.formData();
    const ddId = formData.get("dd_id") as string | null;
    const version = formData.get("version") as string | null;
    const packageFile = formData.get("package") as File | null;
    const skillmdFile = formData.get("skillmd") as File | null;

    if (!ddId || !version) return jsonResponse({ error: "dd_id and version are required" }, 400);
    if (!packageFile) return jsonResponse({ error: "package file is required" }, 400);

    const zipBytes = await packageFile.arrayBuffer();
    const zipSize = zipBytes.byteLength;

    const hashBuffer = await crypto.subtle.digest("SHA-256", zipBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const zipSha256 = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    const r2ZipKey = `packages/${ddId}/v${version}/package.zip`;
    await env.BUCKET.put(r2ZipKey, zipBytes, {
      httpMetadata: { contentType: "application/zip" },
      customMetadata: { dd_id: ddId, version, sha256: zipSha256 },
    });

    let r2SkillmdKey: string | null = null;
    if (skillmdFile) {
      r2SkillmdKey = `packages/${ddId}/v${version}/SKILL.md`;
      await env.BUCKET.put(r2SkillmdKey, await skillmdFile.arrayBuffer(), {
        httpMetadata: { contentType: "text/markdown" },
      });
    }

    await env.DB.prepare(`
      UPDATE dependency_versions
      SET r2_zip_key = ?, r2_skillmd_key = ?, zip_sha256 = ?, zip_size_bytes = ?
      WHERE dd_id = ? AND version = ?
    `).bind(r2ZipKey, r2SkillmdKey, zipSha256, zipSize, ddId, version).run();

    await invalidateKV(ddId, env);

    return jsonResponse({ ok: true, r2_zip_key: r2ZipKey, zip_sha256: zipSha256, zip_size_bytes: zipSize });
  }

  // ── POST /registry/install — records user from X-User-Token ───────────────
  if (pathname === "/registry/install" && method === "POST") {
    const body = await request.json() as {
      id: string; version?: string; user_id?: string; org_id?: string; client_version?: string;
    };
    const { id, client_version } = body;

    // Resolve user from X-User-Token if present (overrides body user_id)
    const user = await optionalUser(request, env);
    const resolvedUserId = user?.id ?? body.user_id ?? null;
    const resolvedOrgId = body.org_id ?? null;

    const resolvedVersion = body.version ?? await getLatestVersion(id, env);
    if (!resolvedVersion) return jsonResponse({ error: "Package not found" }, 404);

    const versionRow = await env.DB.prepare(
      "SELECT status, zip_sha256, r2_zip_key, zip_size_bytes FROM dependency_versions WHERE dd_id = ? AND version = ?"
    ).bind(id, resolvedVersion).first<{ status: string; zip_sha256: string | null; r2_zip_key: string | null; zip_size_bytes: number | null }>();

    if (!versionRow) return jsonResponse({ error: "Version not found" }, 404);
    if (versionRow.status === "yanked") return jsonResponse({ error: "This version has been yanked and cannot be installed" }, 410);

    await env.DB.prepare(
      "INSERT INTO registry_installs (dd_id, version, user_id, org_id, installed_at, source_type, client_version) VALUES (?, ?, ?, ?, ?, 'remote', ?)"
    ).bind(id, resolvedVersion, resolvedUserId, resolvedOrgId, new Date().toISOString(), client_version ?? null).run();

    await env.DB.prepare("UPDATE decision_dependencies SET installed_count = installed_count + 1, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id).run();

    const row = await env.DB.prepare(
      "SELECT d.*, v.trust, v.maturity, v.version, v.manifest_json, v.r2_zip_key, v.zip_sha256, v.zip_size_bytes, v.status as pkg_status FROM decision_dependencies d JOIN dependency_versions v ON v.dd_id = d.id AND v.version = ? WHERE d.id = ?"
    ).bind(resolvedVersion, id).first();

    const dd = rowToDD(row!);
    const downloadUrl = versionRow.r2_zip_key
      ? `${new URL(request.url).origin}/registry/item/${encodeURIComponent(id)}/download?version=${encodeURIComponent(resolvedVersion)}`
      : null;

    return jsonResponse({
      ...dd,
      _download: downloadUrl ? { url: downloadUrl, sha256: versionRow.zip_sha256, size_bytes: versionRow.zip_size_bytes } : null,
    });
  }

  // ── POST /registry/publish (publisher or admin token required) ────────────
  if (pathname === "/registry/publish" && method === "POST") {
    const raw = request.headers.get("Authorization")?.replace("Bearer ", "");
    let publisherActorId = "anonymous";
    let publisherRole = "anonymous";
    let publisherUserId: string | null = null;

    if (raw) {
      // Check if this is a user token (mact_xxx)
      if (raw.startsWith("mact_")) {
        const user = await optionalUser(request, env);
        if (!user) return jsonResponse({ error: "Unauthorized — invalid user token" }, 401);
        publisherActorId = user.email;
        publisherRole = "publisher";
        publisherUserId = user.id;
      } else {
        // Admin/publisher token
        const hash = await sha256hex(raw);
        const row = await env.DB.prepare("SELECT actor_id, role FROM admin_tokens WHERE token_hash = ?")
          .bind(hash).first<{ actor_id: string; role: string }>();
        if (row) {
          publisherActorId = row.actor_id;
          publisherRole = row.role;
        } else if (env.REGISTRY_TOKEN && raw === env.REGISTRY_TOKEN) {
          publisherActorId = "registry-master";
          publisherRole = "admin";
        } else if (env.REGISTRY_TOKEN) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
      }
    } else if (env.REGISTRY_TOKEN) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const dd = await request.json() as Record<string, unknown>;
    const now = new Date().toISOString();

    const publishStatus = publisherRole === "admin"
      ? ((dd._status as string) ?? "pending")
      : "pending";

    const resolvedTrust = publisherRole === "admin"
      ? ((dd.trust as string) ?? "reviewed")
      : "untrusted";

    // Ownership: user-published → owner_user_id; org publish → owner_org_id
    const ownerUserId = publisherUserId ?? null;
    const ownerOrgId = (dd.owner_org_id as string | undefined) ?? null;

    // Validate org membership if publishing under org
    if (ownerOrgId && publisherUserId) {
      const membership = await env.DB.prepare(
        "SELECT role FROM user_orgs WHERE user_id = ? AND org_id = ?"
      ).bind(publisherUserId, ownerOrgId).first<{ role: string }>();
      if (!membership) return jsonResponse({ error: "Forbidden — you are not a member of this organization" }, 403);
    }

    await env.DB.prepare(`
      INSERT INTO decision_dependencies (id, name, description, type, modes, tags, domain, publisher, visibility, owner_user_id, owner_org_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name          = CASE WHEN excluded.name != '' THEN excluded.name ELSE name END,
        description   = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
        tags          = CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE tags END,
        domain        = CASE WHEN excluded.domain != '' THEN excluded.domain ELSE domain END,
        publisher     = CASE WHEN excluded.publisher != '' THEN excluded.publisher ELSE publisher END,
        visibility    = excluded.visibility,
        owner_user_id = COALESCE(owner_user_id, excluded.owner_user_id),
        owner_org_id  = COALESCE(owner_org_id, excluded.owner_org_id),
        updated_at    = excluded.updated_at
    `).bind(
      dd.id, dd.name, dd.description, dd.type,
      JSON.stringify(dd.modes ?? []), JSON.stringify(dd.tags ?? []),
      dd.domain ?? "", dd.publisher ?? publisherActorId, dd.visibility ?? "public",
      ownerUserId, ownerOrgId, now, now
    ).run();

    const r2Key = `packages/${dd.id}/v${dd.version}/manifest.json`;
    await env.BUCKET.put(r2Key, JSON.stringify(dd));

    await env.DB.prepare(`
      INSERT INTO dependency_versions (dd_id, version, trust, maturity, manifest_json, r2_blob_key, status, published_at, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(dd_id, version) DO UPDATE SET
        trust        = excluded.trust,
        maturity     = excluded.maturity,
        manifest_json= excluded.manifest_json,
        r2_blob_key  = excluded.r2_blob_key,
        status       = excluded.status,
        is_latest    = 1
    `).bind(
      dd.id, dd.version, resolvedTrust, dd.maturity ?? "L1",
      JSON.stringify(dd), r2Key, publishStatus, now
    ).run();

    await env.DB.prepare("UPDATE dependency_versions SET is_latest = 0 WHERE dd_id = ? AND version != ?")
      .bind(dd.id, dd.version).run();

    await env.DB.prepare(`
      INSERT INTO governance_events (dd_id, version, event_type, actor, actor_user_id, actor_role, occurred_at)
      VALUES (?, ?, 'submitted', ?, ?, ?, ?)
    `).bind(dd.id, dd.version, publisherActorId, publisherUserId, publisherRole, now).run();

    await invalidateKV(String(dd.id), env);
    return jsonResponse({ ok: true });
  }

  // ── POST /registry/fork ────────────────────────────────────────────────────
  if (pathname === "/registry/fork" && method === "POST") {
    const { sourceId, newId, publisher } = await request.json() as { sourceId: string; newId: string; publisher: string };
    const source = await env.DB.prepare(
      "SELECT d.*, v.manifest_json FROM decision_dependencies d JOIN dependency_versions v ON v.dd_id = d.id AND v.is_latest = 1 WHERE d.id = ?"
    ).bind(sourceId).first();
    if (!source) return jsonResponse({ error: "Source not found" }, 404);

    const user = await optionalUser(request, env);
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO decision_dependencies (id, name, description, type, modes, tags, domain, publisher, visibility, owner_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?)
    `).bind(newId, `Fork of ${source.name}`, source.description, source.type, source.modes, source.tags, source.domain, publisher, user?.id ?? null, now, now).run();

    await env.DB.prepare(`
      INSERT INTO dependency_versions (dd_id, version, trust, maturity, manifest_json, published_at, is_latest)
      VALUES (?, '0.0.1', 'untrusted', ?, ?, ?, 1)
    `).bind(newId, source.maturity, source.manifest_json, now).run();

    await env.DB.prepare(`
      INSERT INTO governance_events (dd_id, event_type, actor, actor_user_id, actor_role, note, occurred_at)
      VALUES (?, 'forked', ?, ?, 'publisher', ?, ?)
    `).bind(newId, publisher, user?.id ?? null, `Forked from ${sourceId}`, now).run();

    return jsonResponse({ ok: true, newId });
  }

  // ── POST /registry/approve (legacy, kept for compat) ─────────────────────
  if (pathname === "/registry/approve" && method === "POST") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const { id, version, note } = await request.json() as { id: string; version: string; note?: string };
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE dependency_versions SET trust = 'reviewed', status = 'published', reviewed_by = ?, reviewed_at = ? WHERE dd_id = ? AND version = ?")
      .bind(authResult.actorId, now, id, version).run();
    await env.DB.prepare("INSERT INTO governance_events (dd_id, version, event_type, actor, actor_role, note, occurred_at) VALUES (?, ?, 'approved', ?, 'admin', ?, ?)")
      .bind(id, version, authResult.actorId, note ?? null, now).run();
    await invalidateKV(id, env);
    return jsonResponse({ ok: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER AUTH ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /auth/register ────────────────────────────────────────────────────
  if (pathname === "/auth/register" && method === "POST") {
    const { email, username } = await request.json() as { email: string; username?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Valid email is required" }, 400);
    }

    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first();
    if (existing) return jsonResponse({ error: "Email already registered. Use 'Retrieve Token' to get your token." }, 409);

    const rawToken = "mact_" + generateHex(32);
    const tokenHash = await sha256hex(rawToken);
    const tokenPrefix = rawToken.slice(0, 8);
    const userId = generateUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO users (id, email, token_hash, token_prefix, username, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, email.toLowerCase(), tokenHash, tokenPrefix, username ?? null, now, now).run();

    return jsonResponse({ token: rawToken, user_id: userId, email: email.toLowerCase() }, 201);
  }

  // ── POST /auth/register-otp-send — step 1: validate + send OTP ────────────
  if (pathname === "/auth/register-otp-send" && method === "POST") {
    const { email, username, cf_turnstile_response, is_resend, otp_session_id } =
      await request.json() as {
        email: string; username?: string; cf_turnstile_response?: string;
        is_resend?: boolean; otp_session_id?: string;
      };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Valid email is required" }, 400);
    }

    let sessionToUpdate: OtpSession | null = null;

    if (is_resend && otp_session_id) {
      // Resend path — validate session (proves this client passed Turnstile earlier)
      const check = await checkResendSession(env.REGISTRY_KV, otp_session_id, email);
      if (!check.ok) return jsonResponse({ error: check.error }, check.status);
      sessionToUpdate = check.session;
    } else {
      // Initial send — verify Turnstile
      if (env.TURNSTILE_SECRET) {
        if (!cf_turnstile_response)
          return jsonResponse({ error: "CAPTCHA verification required." }, 400);
        const tsOk = await verifyTurnstile(env.TURNSTILE_SECRET, cf_turnstile_response,
          request.headers.get("CF-Connecting-IP"));
        if (!tsOk) return jsonResponse({ error: "CAPTCHA verification failed. Please try again." }, 403);
      }
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(email.toLowerCase()).first();
      if (existing)
        return jsonResponse({ error: "Email already registered. Use 'Retrieve Token' to access your account." }, 409);
      await env.REGISTRY_KV.put(
        `pending_reg:${email.toLowerCase()}`,
        JSON.stringify({ username: username?.trim() || null }),
        { expirationTtl: 900 },
      );
    }

    // Generate OTP, invalidate old ones
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256hex(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpId = generateUUID();
    await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE email = ? AND used = 0")
      .bind(email.toLowerCase()).run();
    await env.DB.prepare("INSERT INTO email_otps (id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(otpId, email.toLowerCase(), otpHash, expiresAt).run();

    if (!env.RESEND_API_KEY)
      return jsonResponse({ error: "Email service not configured on the server." }, 503);
    const emailErr = await sendOtpEmail(env.RESEND_API_KEY, email, otp, "register");
    if (emailErr) return jsonResponse({ error: emailErr }, 503);

    // Upsert session in KV
    const newSessionId = (is_resend && otp_session_id) ? otp_session_id : generateUUID();
    await env.REGISTRY_KV.put(`otp_session:${newSessionId}`, JSON.stringify({
      email: email.toLowerCase(), type: "register",
      resend_count: sessionToUpdate ? sessionToUpdate.resend_count + 1 : 0,
      last_resend_at: is_resend ? new Date().toISOString() : null,
    } satisfies OtpSession), { expirationTtl: 600 });

    return jsonResponse({ ok: true, message: "Verification code sent. Check your email.", otp_session_id: newSessionId });
  }

  // ── POST /auth/register-verify — step 2: verify OTP + create account ───────
  if (pathname === "/auth/register-verify" && method === "POST") {
    const { email, otp } = await request.json() as { email: string; otp: string };
    if (!email || !otp) return jsonResponse({ error: "email and otp are required" }, 400);

    // Verify OTP
    const otpHash = await sha256hex(otp);
    const otpRow = await env.DB.prepare(`
      SELECT id, expires_at FROM email_otps
      WHERE email = ? AND otp_hash = ? AND used = 0
      ORDER BY created_at DESC LIMIT 1
    `).bind(email.toLowerCase(), otpHash).first<{ id: string; expires_at: string }>();

    if (!otpRow) return jsonResponse({ error: "Invalid or expired code" }, 401);
    if (new Date(otpRow.expires_at) < new Date()) {
      return jsonResponse({ error: "Code has expired. Request a new one." }, 401);
    }
    await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE id = ?").bind(otpRow.id).run();

    // Check email still not registered (race condition guard)
    const alreadyExists = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email.toLowerCase()).first();
    if (alreadyExists) {
      return jsonResponse({ error: "Email already registered. Use 'Retrieve Token' to access your account." }, 409);
    }

    // Retrieve pending username from KV
    const pendingJson = await env.REGISTRY_KV.get(`pending_reg:${email.toLowerCase()}`);
    const pending = pendingJson ? JSON.parse(pendingJson) as { username: string | null } : { username: null };
    await env.REGISTRY_KV.delete(`pending_reg:${email.toLowerCase()}`);

    // Create account
    const rawToken = "mact_" + generateHex(32);
    const tokenHash = await sha256hex(rawToken);
    const tokenPrefix = rawToken.slice(0, 8);
    const userId = generateUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO users (id, email, token_hash, token_prefix, username, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, email.toLowerCase(), tokenHash, tokenPrefix, pending.username ?? null, now, now).run();

    return jsonResponse({ token: rawToken, user_id: userId, email: email.toLowerCase() }, 201);
  }

  // ── POST /auth/send-otp ────────────────────────────────────────────────────
  if (pathname === "/auth/send-otp" && method === "POST") {
    const { email, cf_turnstile_response, is_resend, otp_session_id } =
      await request.json() as {
        email: string; cf_turnstile_response?: string;
        is_resend?: boolean; otp_session_id?: string;
      };
    if (!email) return jsonResponse({ error: "Email is required" }, 400);

    let sessionToUpdate: OtpSession | null = null;

    if (is_resend && otp_session_id) {
      // Resend path — validate session
      const check = await checkResendSession(env.REGISTRY_KV, otp_session_id, email);
      if (!check.ok) return jsonResponse({ error: check.error }, check.status);
      sessionToUpdate = check.session;
    } else {
      // Initial send — verify Turnstile (silently skip if not configured)
      if (env.TURNSTILE_SECRET) {
        if (!cf_turnstile_response)
          return jsonResponse({ error: "CAPTCHA verification required." }, 400);
        const tsOk = await verifyTurnstile(env.TURNSTILE_SECRET, cf_turnstile_response,
          request.headers.get("CF-Connecting-IP"));
        if (!tsOk) return jsonResponse({ error: "CAPTCHA verification failed. Please try again." }, 403);
      }
    }

    const newSessionId = (is_resend && otp_session_id) ? otp_session_id : generateUUID();

    const user = await env.DB.prepare("SELECT id, is_active FROM users WHERE email = ?")
      .bind(email.toLowerCase()).first<{ id: string; is_active: number }>();

    // Always return ok to prevent email enumeration — but still issue a session so resend works
    if (!user || !user.is_active) {
      if (!is_resend) {
        await env.REGISTRY_KV.put(`otp_session:${newSessionId}`, JSON.stringify({
          email: email.toLowerCase(), type: "retrieve",
          resend_count: 0, last_resend_at: null,
        } satisfies OtpSession), { expirationTtl: 600 });
      }
      return jsonResponse({ ok: true, message: "If this email is registered, a code has been sent.", otp_session_id: newSessionId });
    }

    // Generate OTP, invalidate old ones
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await sha256hex(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpId = generateUUID();
    await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE email = ? AND used = 0")
      .bind(email.toLowerCase()).run();
    await env.DB.prepare("INSERT INTO email_otps (id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(otpId, email.toLowerCase(), otpHash, expiresAt).run();

    if (env.RESEND_API_KEY) {
      const sendErr = await sendOtpEmail(env.RESEND_API_KEY, email, otp, "retrieve");
      if (sendErr) console.warn("[send-otp]", sendErr);
    }

    // Upsert session
    await env.REGISTRY_KV.put(`otp_session:${newSessionId}`, JSON.stringify({
      email: email.toLowerCase(), type: "retrieve",
      resend_count: sessionToUpdate ? sessionToUpdate.resend_count + 1 : 0,
      last_resend_at: is_resend ? new Date().toISOString() : null,
    } satisfies OtpSession), { expirationTtl: 600 });

    return jsonResponse({ ok: true, message: "If this email is registered, a code has been sent.", otp_session_id: newSessionId });
  }

  // ── POST /auth/verify-otp ──────────────────────────────────────────────────
  if (pathname === "/auth/verify-otp" && method === "POST") {
    const { email, otp } = await request.json() as { email: string; otp: string };
    if (!email || !otp) return jsonResponse({ error: "email and otp are required" }, 400);

    const otpHash = await sha256hex(otp);
    const otpRow = await env.DB.prepare(`
      SELECT id, expires_at FROM email_otps
      WHERE email = ? AND otp_hash = ? AND used = 0
      ORDER BY created_at DESC LIMIT 1
    `).bind(email.toLowerCase(), otpHash).first<{ id: string; expires_at: string }>();

    if (!otpRow) return jsonResponse({ error: "Invalid or expired code" }, 401);
    if (new Date(otpRow.expires_at) < new Date()) return jsonResponse({ error: "Code has expired. Request a new one." }, 401);

    // Mark OTP used
    await env.DB.prepare("UPDATE email_otps SET used = 1 WHERE id = ?").bind(otpRow.id).run();

    const user = await env.DB.prepare("SELECT id, token_hash, token_prefix, is_active FROM users WHERE email = ?")
      .bind(email.toLowerCase()).first<{ id: string; token_hash: string; token_prefix: string; is_active: number }>();

    if (!user || !user.is_active) return jsonResponse({ error: "Account not found or suspended" }, 403);

    // We cannot return the raw token (we only have the hash).
    // Generate a new token and update the hash — this is the "reset token" flow.
    const rawToken = "mact_" + generateHex(32);
    const newHash = await sha256hex(rawToken);
    const newPrefix = rawToken.slice(0, 8);
    const now = new Date().toISOString();

    await env.DB.prepare("UPDATE users SET token_hash = ?, token_prefix = ?, last_seen_at = ? WHERE id = ?")
      .bind(newHash, newPrefix, now, user.id).run();

    return jsonResponse({ token: rawToken, user_id: user.id });
  }

  // ── GET /auth/me ───────────────────────────────────────────────────────────
  if (pathname === "/auth/me" && method === "GET") {
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const orgs = await env.DB.prepare(`
      SELECT o.id, o.display_name, uo.role
      FROM organizations o
      JOIN user_orgs uo ON uo.org_id = o.id
      WHERE uo.user_id = ? AND o.is_active = 1
    `).bind(userResult.id).all();

    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM decision_dependencies WHERE owner_user_id = ?) as packages_published,
        (SELECT COUNT(*) FROM registry_installs WHERE user_id = ?) as installs_made
    `).bind(userResult.id, userResult.id).first();

    return jsonResponse({
      user_id: userResult.id,
      email: userResult.email,
      username: userResult.username,
      token_prefix: userResult.token_prefix,
      orgs: orgs.results,
      stats,
    });
  }

  // ── PUT /auth/me ───────────────────────────────────────────────────────────
  if (pathname === "/auth/me" && method === "PUT") {
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const { username } = await request.json() as { username?: string };
    if (username !== undefined) {
      await env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username || null, userResult.id).run();
    }
    return jsonResponse({ ok: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER API KEY SYNC ROUTES  (client-side zero-knowledge encryption)
  // The server only stores an opaque AES-256-GCM ciphertext blob.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GET /user/api-keys ────────────────────────────────────────────────────
  if (pathname === "/user/api-keys" && method === "GET") {
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const row = await env.DB.prepare(
      "SELECT encrypted, updated_at, provider_list FROM user_api_keys WHERE user_id = ?"
    ).bind(userResult.id).first<{ encrypted: string; updated_at: string; provider_list: string | null }>();

    if (!row) return jsonResponse({ encrypted: null, updated_at: null, provider_list: [] }, 200);
    return jsonResponse({
      encrypted: row.encrypted,
      updated_at: row.updated_at,
      provider_list: row.provider_list ? JSON.parse(row.provider_list) : [],
    });
  }

  // ── PUT /user/api-keys ────────────────────────────────────────────────────
  if (pathname === "/user/api-keys" && method === "PUT") {
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const body = await request.json() as { encrypted?: string; provider_list?: unknown };
    if (!body.encrypted || typeof body.encrypted !== "string") {
      return jsonResponse({ error: "encrypted field is required" }, 400);
    }

    // Sanitise provider_list: only accept an array of short strings, max 10 entries
    const providerListJson = Array.isArray(body.provider_list)
      ? JSON.stringify(
          (body.provider_list as unknown[])
            .filter((s): s is string => typeof s === "string" && s.length <= 50)
            .slice(0, 10)
        )
      : null;

    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO user_api_keys (user_id, encrypted, updated_at, provider_list)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        encrypted = excluded.encrypted,
        updated_at = excluded.updated_at,
        provider_list = excluded.provider_list
    `).bind(userResult.id, body.encrypted, now, providerListJson).run();

    return jsonResponse({ ok: true, updated_at: now });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORG ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /orgs/create ─────────────────────────────────────────────────────
  if (pathname === "/orgs/create" && method === "POST") {
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const { id: orgId, display_name } = await request.json() as { id: string; display_name: string };
    if (!orgId || !display_name) return jsonResponse({ error: "id and display_name are required" }, 400);
    if (!/^[a-z0-9-]{3,40}$/.test(orgId)) {
      return jsonResponse({ error: "org id must be 3-40 lowercase alphanumeric/hyphen characters" }, 400);
    }

    const existing = await env.DB.prepare("SELECT id FROM organizations WHERE id = ?").bind(orgId).first();
    if (existing) return jsonResponse({ error: "Organization ID already taken" }, 409);

    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO organizations (id, display_name, created_by, created_at) VALUES (?, ?, ?, ?)")
      .bind(orgId, display_name, userResult.id, now).run();
    await env.DB.prepare("INSERT INTO user_orgs (user_id, org_id, role, joined_at) VALUES (?, ?, 'admin', ?)")
      .bind(userResult.id, orgId, now).run();

    return jsonResponse({ ok: true, org_id: orgId }, 201);
  }

  // ── GET /orgs/:id ─────────────────────────────────────────────────────────
  if (pathname.match(/^\/orgs\/[^/]+$/) && method === "GET") {
    const orgId = pathname.split("/")[2];
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const membership = await env.DB.prepare("SELECT role FROM user_orgs WHERE user_id = ? AND org_id = ?")
      .bind(userResult.id, orgId).first();
    if (!membership) return jsonResponse({ error: "Not a member of this organization" }, 403);

    const org = await env.DB.prepare("SELECT id, display_name, created_at FROM organizations WHERE id = ? AND is_active = 1")
      .bind(orgId).first();
    if (!org) return jsonResponse({ error: "Organization not found" }, 404);

    const members = await env.DB.prepare(`
      SELECT u.id, u.email, u.username, uo.role, uo.joined_at
      FROM user_orgs uo JOIN users u ON u.id = uo.user_id
      WHERE uo.org_id = ?
    `).bind(orgId).all();

    return jsonResponse({ org, members: members.results });
  }

  // ── POST /orgs/:id/invite ─────────────────────────────────────────────────
  if (pathname.match(/^\/orgs\/[^/]+\/invite$/) && method === "POST") {
    const orgId = pathname.split("/")[2];
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    const membership = await env.DB.prepare("SELECT role FROM user_orgs WHERE user_id = ? AND org_id = ?")
      .bind(userResult.id, orgId).first<{ role: string }>();
    if (!membership || membership.role !== "admin") return jsonResponse({ error: "Forbidden — org admin role required" }, 403);

    const { email, role } = await request.json() as { email: string; role: "member" | "admin" };
    const invitee = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase()).first<{ id: string }>();
    if (!invitee) return jsonResponse({ error: "User not found — they must register first" }, 404);

    await env.DB.prepare(`
      INSERT INTO user_orgs (user_id, org_id, role, joined_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, org_id) DO UPDATE SET role = excluded.role
    `).bind(invitee.id, orgId, role, new Date().toISOString()).run();

    return jsonResponse({ ok: true });
  }

  // ── DELETE /orgs/:id/members/:uid ─────────────────────────────────────────
  if (pathname.match(/^\/orgs\/[^/]+\/members\/[^/]+$/) && method === "DELETE") {
    const parts = pathname.split("/");
    const orgId = parts[2];
    const targetUid = parts[4];
    const userResult = await requireUser(request, env);
    if (userResult instanceof Response) return userResult;

    // Allow self-removal or org admin removal
    if (userResult.id !== targetUid) {
      const membership = await env.DB.prepare("SELECT role FROM user_orgs WHERE user_id = ? AND org_id = ?")
        .bind(userResult.id, orgId).first<{ role: string }>();
      if (!membership || membership.role !== "admin") return jsonResponse({ error: "Forbidden" }, 403);
    }

    await env.DB.prepare("DELETE FROM user_orgs WHERE user_id = ? AND org_id = ?").bind(targetUid, orgId).run();
    return jsonResponse({ ok: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GET /registry/admin/pending ───────────────────────────────────────────
  if (pathname === "/registry/admin/pending" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const result = await env.DB.prepare(`
      SELECT d.id, d.name, d.type, d.publisher, d.owner_user_id, d.owner_org_id,
             COALESCE(NULLIF(d.description,''), json_extract(v.manifest_json,'$.description')) as description,
             COALESCE(NULLIF(d.domain,''), json_extract(v.manifest_json,'$.domain')) as domain,
             COALESCE(NULLIF(d.tags,'[]'), NULLIF(d.tags,''), json_extract(v.manifest_json,'$.tags')) as tags,
             v.version, v.trust, v.maturity, v.manifest_json,
             v.published_at, v.zip_size_bytes, v.r2_zip_key
      FROM decision_dependencies d
      JOIN dependency_versions v ON v.dd_id = d.id AND v.status = 'pending'
      ORDER BY v.published_at DESC
      LIMIT 100
    `).all();
    return jsonResponse({ items: result.results });
  }

  // ── POST /registry/admin/approve ──────────────────────────────────────────
  if (pathname === "/registry/admin/approve" && method === "POST") {
    // Allow both admin tokens AND org admins (via user token) to approve org packages
    const body = await request.json() as {
      dd_id: string; version: string;
      action: "approve" | "reject" | "yank";
      trust?: "reviewed" | "org-approved";
      note?: string;
    };
    const { dd_id, version, action, trust, note } = body;
    const now = new Date().toISOString();

    // Try admin token first
    const adminResult = await requireAdmin(request, env, "admin");
    let actorId: string;
    let actorUserId: string | null = null;
    let actorRole: string;

    if (!(adminResult instanceof Response)) {
      actorId = adminResult.actorId;
      actorRole = "admin";
    } else {
      // Try user token (org admin can approve packages in their org)
      const user = await optionalUser(request, env);
      if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

      const pkg = await env.DB.prepare("SELECT owner_org_id FROM decision_dependencies WHERE id = ?")
        .bind(dd_id).first<{ owner_org_id: string | null }>();

      if (!pkg?.owner_org_id) return jsonResponse({ error: "Forbidden — only admins can approve non-org packages" }, 403);

      const membership = await env.DB.prepare("SELECT role FROM user_orgs WHERE user_id = ? AND org_id = ?")
        .bind(user.id, pkg.owner_org_id).first<{ role: string }>();
      if (!membership || membership.role !== "admin") return jsonResponse({ error: "Forbidden — org admin role required" }, 403);

      actorId = user.email;
      actorUserId = user.id;
      actorRole = "org_admin";

      // Org admins can only set org-approved trust for org packages
      if (action === "approve" && trust && trust !== "org-approved") {
        return jsonResponse({ error: "Org admins can only set trust=org-approved" }, 403);
      }
    }

    let newStatus: string;
    let eventType: string;

    if (action === "approve") {
      newStatus = "published";
      eventType = "approved";
      const resolvedTrust = trust ?? (actorRole === "org_admin" ? "org-approved" : "reviewed");
      await env.DB.prepare(`
        UPDATE dependency_versions
        SET status = 'published', trust = ?, reviewed_by = ?, reviewed_at = ?
        WHERE dd_id = ? AND version = ?
      `).bind(resolvedTrust, actorId, now, dd_id, version).run();
    } else if (action === "reject") {
      newStatus = "yanked";
      eventType = "rejected";
      await env.DB.prepare("UPDATE dependency_versions SET status = 'yanked' WHERE dd_id = ? AND version = ?")
        .bind(dd_id, version).run();
    } else {
      newStatus = "yanked";
      eventType = "revoked";
      await env.DB.prepare("UPDATE dependency_versions SET status = 'yanked' WHERE dd_id = ? AND version = ?")
        .bind(dd_id, version).run();
    }

    await env.DB.prepare(`
      INSERT INTO governance_events (dd_id, version, event_type, actor, actor_user_id, actor_role, note, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(dd_id, version, eventType, actorId, actorUserId, actorRole, note ?? null, now).run();
    await invalidateKV(dd_id, env);
    return jsonResponse({ ok: true, status: newStatus });
  }

  // ── POST /registry/admin/batch-approve ────────────────────────────────────
  if (pathname === "/registry/admin/batch-approve" && method === "POST") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const { items, trust, note } = await request.json() as {
      items: Array<{ dd_id: string; version: string }>;
      trust?: "reviewed" | "org-approved";
      note?: string;
    };
    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse({ error: "items array is required" }, 400);
    }
    const now = new Date().toISOString();
    const resolvedTrust = trust ?? "reviewed";
    let approved = 0;
    for (const { dd_id, version } of items) {
      await env.DB.prepare(`
        UPDATE dependency_versions
        SET status = 'published', trust = ?, reviewed_by = ?, reviewed_at = ?
        WHERE dd_id = ? AND version = ?
      `).bind(resolvedTrust, authResult.actorId, now, dd_id, version).run();
      await env.DB.prepare(`
        INSERT INTO governance_events (dd_id, version, event_type, actor, actor_role, note, occurred_at)
        VALUES (?, ?, 'approved', ?, 'admin', ?, ?)
      `).bind(dd_id, version, authResult.actorId, note ?? null, now).run();
      await invalidateKV(dd_id, env);
      approved++;
    }
    const listKeys = await env.REGISTRY_KV.list({ prefix: "list:" });
    await Promise.all(listKeys.keys.map(k => env.REGISTRY_KV.delete(k.name)));
    return jsonResponse({ ok: true, approved });
  }

  // ── POST /registry/admin/trust-all-published ──────────────────────────────
  // Bulk-promote all published versions with trust='untrusted' to trust='reviewed'.
  // Useful after initial registry seeding to trust all official skills at once.
  if (pathname === "/registry/admin/trust-all-published" && method === "POST") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const { trust = "reviewed" } = await request.json() as { trust?: "reviewed" | "org-approved" };
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE dependency_versions
      SET trust = ?, reviewed_by = ?, reviewed_at = ?
      WHERE status = 'published' AND trust = 'untrusted'
    `).bind(trust, authResult.actorId, now).run();
    // Add governance events for each updated row
    const updatedRows = await env.DB.prepare(`
      SELECT dd_id, version FROM dependency_versions
      WHERE status = 'published' AND trust = ? AND reviewed_at = ?
    `).bind(trust, now).all();
    for (const row of (updatedRows.results ?? [])) {
      await env.DB.prepare(`
        INSERT INTO governance_events (dd_id, version, event_type, actor, actor_role, note, occurred_at)
        VALUES (?, ?, 'approved', ?, 'admin', 'bulk trust-all-published', ?)
      `).bind(row.dd_id, row.version, authResult.actorId, now).run();
    }
    // Invalidate all list caches
    const listKeys = await env.REGISTRY_KV.list({ prefix: "list:" });
    await Promise.all(listKeys.keys.map(k => env.REGISTRY_KV.delete(k.name)));
    return jsonResponse({ ok: true, updated: result.meta?.changes ?? 0 });
  }

  // ── POST /registry/admin/set-status ───────────────────────────────────────
  if (pathname === "/registry/admin/set-status" && method === "POST") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const { dd_id, version, status } = await request.json() as {
      dd_id: string; version: string;
      status: "published" | "deprecated" | "yanked" | "pending";
    };
    await env.DB.prepare("UPDATE dependency_versions SET status = ? WHERE dd_id = ? AND version = ?")
      .bind(status, dd_id, version).run();
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO governance_events (dd_id, version, event_type, actor, actor_role, note, occurred_at)
      VALUES (?, ?, 'status_changed', ?, 'admin', ?, ?)
    `).bind(dd_id, version, authResult.actorId, `status → ${status}`, now).run();
    await invalidateKV(dd_id, env);
    return jsonResponse({ ok: true, status });
  }

  // ── GET /registry/admin/list ───────────────────────────────────────────────
  if (pathname === "/registry/admin/list" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const status = url.searchParams.get("status");
    let sql = `
      SELECT d.id, d.name, d.type, d.publisher, d.visibility, d.installed_count,
             d.owner_user_id, d.owner_org_id,
             COALESCE(NULLIF(d.description,''), json_extract(v.manifest_json,'$.description')) as description,
             COALESCE(NULLIF(d.domain,''), json_extract(v.manifest_json,'$.domain')) as domain,
             COALESCE(NULLIF(d.tags,'[]'), NULLIF(d.tags,''), json_extract(v.manifest_json,'$.tags')) as tags,
             v.version, v.trust, v.maturity, v.status as pkg_status,
             v.published_at, v.zip_sha256, v.zip_size_bytes
      FROM decision_dependencies d
      JOIN dependency_versions v ON v.dd_id = d.id AND v.is_latest = 1
    `;
    const bindings: unknown[] = [];
    if (status) { sql += " WHERE v.status = ?"; bindings.push(status); }
    sql += " ORDER BY v.published_at DESC LIMIT 200";
    const result = await env.DB.prepare(sql).bind(...bindings).all();
    return jsonResponse({ items: result.results });
  }

  // ── GET /registry/admin/stats ──────────────────────────────────────────────
  if (pathname === "/registry/admin/stats" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const [total, byStatus, installs, govEvents, userCount] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as cnt FROM decision_dependencies").first<{ cnt: number }>(),
      env.DB.prepare("SELECT status, COUNT(*) as cnt FROM dependency_versions GROUP BY status").all(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM registry_installs").first<{ cnt: number }>(),
      env.DB.prepare("SELECT event_type, COUNT(*) as cnt FROM governance_events GROUP BY event_type").all(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE is_active = 1").first<{ cnt: number }>().catch(() => ({ cnt: 0 })),
    ]);
    return jsonResponse({
      total_packages: total?.cnt ?? 0,
      total_installs: installs?.cnt ?? 0,
      total_users: (userCount as any)?.cnt ?? 0,
      by_status: byStatus.results,
      governance: govEvents.results,
    });
  }

  // ── POST /registry/admin/token ─────────────────────────────────────────────
  if (pathname === "/registry/admin/token" && method === "POST") {
    const authErr = requireAuth(request, env);
    if (authErr) return authErr;
    const { raw_token, actor_id, role, expires_at, note } = await request.json() as {
      raw_token: string; actor_id: string; role: "admin" | "publisher";
      expires_at?: string; note?: string;
    };
    if (!raw_token || raw_token.length < 32) {
      return jsonResponse({ error: "raw_token must be at least 32 characters" }, 400);
    }
    const hash = await sha256hex(raw_token);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO admin_tokens (token_hash, actor_id, role, created_at, expires_at, note)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET actor_id=excluded.actor_id, role=excluded.role, note=excluded.note
    `).bind(hash, actor_id, role, now, expires_at ?? null, note ?? null).run();
    return jsonResponse({ ok: true, actor_id, role, hash_prefix: hash.slice(0, 8) + "…" });
  }

  // ── GET /registry/admin/analytics ────────────────────────────────────────
  if (pathname === "/registry/admin/analytics" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;

    const [dailyInstalls, topPackages, packageBreakdown] = await Promise.all([
      env.DB.prepare(`
        SELECT date(installed_at) as day, COUNT(*) as cnt
        FROM registry_installs
        WHERE installed_at >= date('now', '-30 days')
        GROUP BY date(installed_at)
        ORDER BY day ASC
      `).all(),
      env.DB.prepare(`
        SELECT ri.dd_id, d.name, COUNT(*) as cnt
        FROM registry_installs ri
        LEFT JOIN decision_dependencies d ON d.id = ri.dd_id
        GROUP BY ri.dd_id
        ORDER BY cnt DESC
        LIMIT 10
      `).all(),
      env.DB.prepare(`
        SELECT date(installed_at) as day, dd_id, version, COUNT(*) as cnt
        FROM registry_installs
        WHERE installed_at >= date('now', '-7 days')
        GROUP BY date(installed_at), dd_id, version
        ORDER BY day DESC, cnt DESC
        LIMIT 100
      `).all(),
    ]);

    return jsonResponse({
      daily_installs: dailyInstalls.results,
      top_packages: topPackages.results,
      package_breakdown: packageBreakdown.results,
    });
  }

  // ── GET /registry/admin/tokens ────────────────────────────────────────────
  if (pathname === "/registry/admin/tokens" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const result = await env.DB.prepare(
      `SELECT token_hash, actor_id, role, created_at, expires_at, note FROM admin_tokens ORDER BY created_at DESC`
    ).all();
    const tokens = result.results.map((r: any) => ({
      ...r,
      token_hash: String(r.token_hash ?? "").slice(0, 8) + "…",
    }));
    return jsonResponse({ tokens });
  }

  // ── GET /registry/admin/governance ───────────────────────────────────────
  if (pathname === "/registry/admin/governance" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const ddId = url.searchParams.get("dd_id");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
    let sql = `SELECT id, dd_id, version, event_type, actor, actor_user_id, actor_role, note, occurred_at FROM governance_events`;
    const bindings: unknown[] = [];
    if (ddId) { sql += " WHERE dd_id = ?"; bindings.push(ddId); }
    sql += " ORDER BY occurred_at DESC LIMIT ?";
    bindings.push(limit);
    const result = await env.DB.prepare(sql).bind(...bindings).all();
    return jsonResponse({ events: result.results });
  }

  // ── GET /registry/admin/users ─────────────────────────────────────────────
  if (pathname === "/registry/admin/users" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const search = url.searchParams.get("search");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

    let sql = `
      SELECT
        u.id, u.email, u.username, u.created_at, u.last_seen_at, u.is_active, u.token_prefix,
        COUNT(DISTINCT d.id) as packages_published,
        COUNT(DISTINCT ri.id) as installs_made,
        COUNT(DISTINCT uo.org_id) as org_count
      FROM users u
      LEFT JOIN decision_dependencies d ON d.owner_user_id = u.id
      LEFT JOIN registry_installs ri ON ri.user_id = u.id
      LEFT JOIN user_orgs uo ON uo.user_id = u.id
    `;
    const bindings: unknown[] = [];
    if (search) {
      sql += " WHERE (u.email LIKE ? OR u.username LIKE ?)";
      bindings.push(`%${search}%`, `%${search}%`);
    }
    sql += " GROUP BY u.id ORDER BY u.created_at DESC LIMIT ?";
    bindings.push(limit);

    const result = await env.DB.prepare(sql).bind(...bindings).all();
    return jsonResponse({ users: result.results });
  }

  // ── GET /registry/admin/users/:id ─────────────────────────────────────────
  if (pathname.match(/^\/registry\/admin\/users\/[^/]+$/) && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const userId = pathname.split("/")[4];

    const user = await env.DB.prepare(
      "SELECT id, email, username, created_at, last_seen_at, is_active, token_prefix FROM users WHERE id = ?"
    ).bind(userId).first();
    if (!user) return jsonResponse({ error: "User not found" }, 404);

    const [packages, orgs, installs, apiKeyRow] = await Promise.all([
      env.DB.prepare(`
        SELECT d.id, d.name, d.type, d.visibility, v.status as pkg_status, v.version, v.published_at
        FROM decision_dependencies d
        JOIN dependency_versions v ON v.dd_id = d.id AND v.is_latest = 1
        WHERE d.owner_user_id = ?
        ORDER BY v.published_at DESC LIMIT 50
      `).bind(userId).all(),
      env.DB.prepare(`
        SELECT o.id, o.display_name, uo.role, uo.joined_at
        FROM user_orgs uo JOIN organizations o ON o.id = uo.org_id
        WHERE uo.user_id = ?
      `).bind(userId).all(),
      env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM registry_installs WHERE user_id = ?"
      ).bind(userId).first<{ cnt: number }>(),
      // Only return sync status + provider names; encrypted blob is NOT returned to admin
      env.DB.prepare(
        "SELECT updated_at, provider_list FROM user_api_keys WHERE user_id = ?"
      ).bind(userId).first<{ updated_at: string; provider_list: string | null }>().catch(() => null),
    ]);

    return jsonResponse({
      user,
      packages: packages.results,
      orgs: orgs.results,
      installs_count: installs?.cnt ?? 0,
      api_keys_synced: !!apiKeyRow,
      api_keys_updated_at: apiKeyRow?.updated_at ?? null,
      api_keys_provider_list: apiKeyRow?.provider_list ? JSON.parse(apiKeyRow.provider_list) : [],
    });
  }

  // ── POST /registry/admin/users/:id/suspend ────────────────────────────────
  if (pathname.match(/^\/registry\/admin\/users\/[^/]+\/suspend$/) && method === "POST") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;
    const userId = pathname.split("/")[4];
    const { suspend } = await request.json() as { suspend: boolean };

    await env.DB.prepare("UPDATE users SET is_active = ? WHERE id = ?")
      .bind(suspend ? 0 : 1, userId).run();
    return jsonResponse({ ok: true, is_active: !suspend });
  }

  // ── GET /registry/admin/orgs ──────────────────────────────────────────────
  if (pathname === "/registry/admin/orgs" && method === "GET") {
    const authResult = await requireAdmin(request, env, "admin");
    if (authResult instanceof Response) return authResult;

    const result = await env.DB.prepare(`
      SELECT o.id, o.display_name, o.created_by, o.created_at, o.is_active,
             COUNT(DISTINCT uo.user_id) as member_count,
             COUNT(DISTINCT d.id) as package_count
      FROM organizations o
      LEFT JOIN user_orgs uo ON uo.org_id = o.id
      LEFT JOIN decision_dependencies d ON d.owner_org_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 200
    `).all();
    return jsonResponse({ orgs: result.results });
  }

  // ── GET / — browser gateway or JSON API info ──────────────────────────────
  if (pathname === "/" && method === "GET") {
    const accept = request.headers.get("Accept") ?? "";
    if (accept.includes("text/html")) {
      return new Response(buildGatewayHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return jsonResponse({
      name: "MindAct Registry",
      version: "2.0.0",
      description: "DecisionDependency package registry API for the MindAct client",
      docs: "https://download.physical-mind.ai",
      endpoints: {
        health:   "GET /registry/health",
        list:     "GET /registry/list",
        item:     "GET /registry/item/:id",
        content:  "GET /registry/item/:id/content",
        download: "GET /registry/item/:id/download",
        install:  "POST /registry/install",
        publish:  "POST /registry/publish",
      },
    });
  }

  // ── GET /releases/list ────────────────────────────────────────────────────
  // Public endpoint returning all releases (sorted newest first). Used by the
  // download page to display multi-version listing.
  if (pathname === "/releases/list" && method === "GET") {
    const rows = await env.DB.prepare(`
      SELECT r.id, r.version, r.channel, r.release_notes, r.published_at, r.is_latest,
             json_group_array(json_object(
               'platform', a.platform,
               'filename', a.filename,
               'size_bytes', a.size_bytes,
               'sha256', a.sha256,
               'download_url', COALESCE(a.download_url, '/releases/download/' || r.version || '/' || a.platform)
             )) as assets_json
      FROM releases r
      LEFT JOIN release_assets a ON a.release_id = r.id
      WHERE COALESCE(r.status, 'active') = 'active'
      GROUP BY r.id
      ORDER BY r.published_at DESC
      LIMIT 50
    `).all<{ id: string; version: string; channel: string; release_notes: string; published_at: string; is_latest: number; assets_json: string }>();

    const releases = rows.results.map(r => ({
      id: r.id,
      version: r.version,
      channel: r.channel,
      release_notes: r.release_notes,
      published_at: r.published_at,
      is_latest: Boolean(r.is_latest),
      assets: (JSON.parse(r.assets_json ?? "[]") as any[])
        .filter(a => a.platform !== null)
        .map(a => ({
          ...a,
          // Leave external (absolute) URLs as-is; prefix R2 proxy paths with origin
          download_url: a.download_url.startsWith("/")
            ? `${url.origin}${a.download_url}`
            : a.download_url,
        })),
    }));

    return jsonResponse({ releases });
  }

  // ── GET /releases/latest ───────────────────────────────────────────────────
  if (pathname === "/releases/latest" && method === "GET") {
    const release = await env.DB.prepare(`
      SELECT r.id, r.version, r.channel, r.release_notes, r.published_at,
             json_group_array(json_object(
               'platform', a.platform,
               'filename', a.filename,
               'size_bytes', a.size_bytes,
               'sha256', a.sha256,
               'download_url', COALESCE(a.download_url, '/releases/download/' || r.version || '/' || a.platform)
             )) as assets_json
      FROM releases r
      LEFT JOIN release_assets a ON a.release_id = r.id
      WHERE r.is_latest = 1 AND r.channel = 'stable' AND COALESCE(r.status, 'active') = 'active'
      GROUP BY r.id
      LIMIT 1
    `).first<{ id: string; version: string; channel: string; release_notes: string; published_at: string; assets_json: string }>();

    if (!release) return jsonResponse({ error: "No release available" }, 404);

    const assets = (JSON.parse(release.assets_json ?? "[]") as any[])
      .filter(a => a.platform !== null)
      .map(a => ({
        ...a,
        download_url: a.download_url.startsWith("/")
          ? `${url.origin}${a.download_url}`
          : a.download_url,
      }));

    return jsonResponse({
      version: release.version,
      channel: release.channel,
      release_notes: release.release_notes,
      published_at: release.published_at,
      assets,
    });
  }

  // ── GET /releases/electron/latest-{platform}.yml ─────────────────────────
  // electron-updater 用的 update manifest，格式见：
  //   https://www.electron.build/auto-update#generic-server-support
  //
  // 文件名映射：
  //   latest-mac.yml   → platform = "mac"
  //   latest.yml       → platform = "windows"
  //   latest-linux.yml → platform = "linux"
  if (pathname.match(/^\/releases\/electron\/latest(-\w+)?\.yml$/) && method === "GET") {
    const stem = pathname.replace("/releases/electron/", "").replace(".yml", ""); // "latest" | "latest-mac" | "latest-linux"
    const platformMap: Record<string, string> = {
      "latest": "windows",
      "latest-mac": "mac",
      "latest-linux": "linux",
    };
    const dbPlatform = platformMap[stem];
    if (!dbPlatform) return new Response("Not found", { status: 404 });

    const row = await env.DB.prepare(`
      SELECT r.version, r.published_at,
             a.filename, a.sha512, a.size_bytes,
             COALESCE(a.download_url, ? || '/releases/download/' || r.version || '/' || a.platform) as asset_url
      FROM releases r
      JOIN release_assets a ON a.release_id = r.id
      WHERE r.is_latest = 1 AND r.channel = 'stable'
        AND COALESCE(r.status, 'active') = 'active'
        AND a.platform = ?
        AND a.sha512 IS NOT NULL
      LIMIT 1
    `).bind(url.origin, dbPlatform).first<{
      version: string; published_at: string;
      filename: string; sha512: string; size_bytes: number | null; asset_url: string;
    }>();

    if (!row) return new Response("No update available for this platform", { status: 404 });

    const assetUrl = row.asset_url.startsWith("/") ? `${url.origin}${row.asset_url}` : row.asset_url;
    const releaseDate = new Date(row.published_at).toISOString();

    const yaml = `version: ${row.version}
files:
  - url: ${assetUrl}
    sha512: ${row.sha512}
    size: ${row.size_bytes ?? 0}
path: ${assetUrl}
sha512: ${row.sha512}
releaseDate: '${releaseDate}'
`;
    return new Response(yaml, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ── GET /releases/all ─────────────────────────────────────────────────────
  if (pathname === "/releases/all" && method === "GET") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const rows = await env.DB.prepare(`
      SELECT r.id, r.version, r.channel, r.release_notes, r.published_at, r.is_latest,
             COALESCE(r.status, 'active') as status,
             json_group_array(json_object(
               'id', a.id,
               'platform', a.platform,
               'filename', a.filename,
               'size_bytes', a.size_bytes,
               'sha256', a.sha256,
               'r2_key', a.r2_key,
               'download_url', a.download_url
             )) as assets_json
      FROM releases r
      LEFT JOIN release_assets a ON a.release_id = r.id
      GROUP BY r.id
      ORDER BY r.published_at DESC
      LIMIT 100
    `).all<{ id: string; version: string; channel: string; release_notes: string; published_at: string; is_latest: number; status: string; assets_json: string }>();

    const releases = rows.results.map(r => ({
      ...r,
      is_latest: Boolean(r.is_latest),
      assets: (JSON.parse(r.assets_json ?? "[]") as any[]).filter(a => a.platform !== null),
      assets_json: undefined,
    }));

    return jsonResponse({ releases });
  }

  // ── GET /releases/download/:version/:platform ──────────────────────────────
  if (pathname.match(/^\/releases\/download\/[^/]+\/[^/]+$/) && method === "GET") {
    const parts = pathname.split("/");
    const version = decodeURIComponent(parts[3]);
    const platform = decodeURIComponent(parts[4]);

    const asset = await env.DB.prepare(`
      SELECT a.r2_key, a.filename, a.download_url FROM release_assets a
      JOIN releases r ON r.id = a.release_id
      WHERE r.version = ? AND a.platform = ?
    `).bind(version, platform).first<{ r2_key: string; filename: string; download_url: string | null }>();

    if (!asset) return jsonResponse({ error: "Asset not found" }, 404);

    // If an external download URL is configured, redirect directly to it
    if (asset.download_url) {
      return Response.redirect(asset.download_url, 302);
    }

    const obj = await env.BUCKET.get(asset.r2_key);
    if (!obj) return jsonResponse({ error: "File not found in storage" }, 404);

    const ext = asset.filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      dmg: "application/x-apple-diskimage",
      exe: "application/x-msdownload",
      appimage: "application/octet-stream",
      gz: "application/gzip",
    };

    return new Response(obj.body, {
      headers: {
        "Content-Type": mimeMap[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${asset.filename}"`,
        ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
      },
    });
  }

  // ── POST /releases/upload ──────────────────────────────────────────────────
  if (pathname === "/releases/upload" && method === "POST") {
    const auth = await requireAdmin(request, env, "publisher");
    if (auth instanceof Response) return auth;

    const ct = request.headers.get("Content-Type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return jsonResponse({ error: "Expected multipart/form-data" }, 400);
    }

    const form = await request.formData();
    const metaRaw = form.get("metadata");
    if (!metaRaw) return jsonResponse({ error: "Missing metadata field" }, 400);

    let meta: { version: string; platform: string; channel?: string; release_notes?: string; download_url?: string; sha512?: string; sha256?: string; size_bytes?: number };
    try { meta = JSON.parse(String(metaRaw)); } catch { return jsonResponse({ error: "Invalid metadata JSON" }, 400); }

    const { version, platform, channel = "stable", release_notes = "", download_url, sha512: metaSha512, sha256: metaSha256, size_bytes: metaSizeBytes } = meta;
    if (!version || !platform) return jsonResponse({ error: "version and platform required in metadata" }, 400);

    const file = form.get("file") as File | null;

    // Require either a binary file OR an external download_url
    if (!file && !download_url) {
      return jsonResponse({ error: "Provide either a binary file (file field) or a download_url in metadata" }, 400);
    }
    // When using external URL, sha512 must be pre-computed by the caller (needed for electron-updater YAML)
    if (!file && download_url && !metaSha512) {
      return jsonResponse({ error: "sha512 (base64-encoded) is required in metadata when using download_url" }, 400);
    }

    const now = new Date().toISOString();
    let r2Key = download_url ? "external" : "";
    let sha256 = metaSha256 ?? "";          // caller-provided for external URL; overwritten if file uploaded
    let sha512 = metaSha512 ?? "";          // caller-provided for external URL; overwritten if file uploaded
    let sizeBytes: number | null = metaSizeBytes ?? null;  // caller-provided for external URL; overwritten if file uploaded
    let fileName = download_url ? `${platform}-external` : file!.name;

    if (file) {
      const bytes = await file.arrayBuffer();
      // SHA-256 (hex) — for display / legacy compatibility
      const hashBuf256 = await crypto.subtle.digest("SHA-256", bytes);
      sha256 = Array.from(new Uint8Array(hashBuf256)).map(b => b.toString(16).padStart(2, "0")).join("");
      // SHA-512 (base64) — required by electron-updater for update verification
      const hashBuf512 = await crypto.subtle.digest("SHA-512", bytes);
      sha512 = btoa(String.fromCharCode(...new Uint8Array(hashBuf512)));
      r2Key = `releases/${version}/${platform}/${file.name}`;
      fileName = file.name;
      sizeBytes = bytes.byteLength;
      await env.BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
        customMetadata: { version, platform, sha256, sha512 },
      });
    }

    // Upsert release row (one row per version)
    await env.DB.prepare(`
      INSERT INTO releases (id, version, channel, release_notes, published_at, published_by, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(version) DO UPDATE SET
        release_notes = COALESCE(excluded.release_notes, release_notes),
        channel = excluded.channel
    `).bind(version, version, channel, release_notes, now, auth.actorId).run();

    // Upsert asset row (one row per version+platform)
    const assetId = generateUUID();
    await env.DB.prepare(`
      INSERT INTO release_assets (id, release_id, platform, filename, r2_key, size_bytes, sha256, sha512, created_at, download_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id, platform) DO UPDATE SET
        filename = excluded.filename, r2_key = excluded.r2_key,
        size_bytes = excluded.size_bytes, sha256 = excluded.sha256, sha512 = excluded.sha512,
        created_at = excluded.created_at, download_url = excluded.download_url
    `).bind(assetId, version, platform, fileName, r2Key, sizeBytes, sha256 || null, sha512 || null, now, download_url ?? null).run();

    return jsonResponse({ success: true, asset_id: assetId, r2_key: r2Key || null, sha256: sha256 || null, sha512: sha512 || null, size_bytes: sizeBytes, download_url: download_url ?? null });
  }

  // ── POST /releases/upload-init — register metadata, get streaming upload slot ─
  // Accepts JSON (no file). Client provides pre-computed sha256/sha512.
  // Returns { upload_id } to be used with PUT /releases/upload-stream/{id}.
  // This avoids the 100 MB multipart-body-buffering limit in Cloudflare Workers.
  if (pathname === "/releases/upload-init" && method === "POST") {
    const auth = await requireAdmin(request, env, "publisher");
    if (auth instanceof Response) return auth;

    let body: {
      version: string; platform: string; channel?: string; release_notes?: string;
      sha256: string; sha512: string; size_bytes: number; filename: string;
      download_url?: string;
    };
    try { body = await request.json() as typeof body; } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { version, platform, channel = "stable", release_notes = "", sha256, sha512, size_bytes, filename, download_url } = body;
    if (!version || !platform) return jsonResponse({ error: "version and platform required" }, 400);
    if (!download_url && (!sha256 || !sha512 || !size_bytes || !filename)) {
      return jsonResponse({ error: "sha256, sha512, size_bytes, filename required for file upload" }, 400);
    }

    const uploadId = generateUUID();
    const r2Key = download_url ? "external" : `releases/${version}/${platform}/${filename}`;
    const now = new Date().toISOString();

    // Persist the upload slot in KV with 2-hour TTL
    await env.REGISTRY_KV.put(
      `upload_slot:${uploadId}`,
      JSON.stringify({ version, platform, channel, release_notes, sha256, sha512, size_bytes, filename, r2Key, actorId: auth.actorId, download_url: download_url ?? null }),
      { expirationTtl: 7200 },
    );

    if (download_url) {
      // External URL — no binary upload needed; finalize immediately
      const assetId = generateUUID();
      await env.DB.prepare(`
        INSERT INTO releases (id, version, channel, release_notes, published_at, published_by, is_latest)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(version) DO UPDATE SET
          release_notes = COALESCE(excluded.release_notes, release_notes),
          channel = excluded.channel
      `).bind(version, version, channel, release_notes, now, auth.actorId).run();
      await env.DB.prepare(`
        INSERT INTO release_assets (id, release_id, platform, filename, r2_key, size_bytes, sha256, sha512, created_at, download_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(release_id, platform) DO UPDATE SET
          filename = excluded.filename, r2_key = excluded.r2_key,
          size_bytes = excluded.size_bytes, sha256 = excluded.sha256, sha512 = excluded.sha512,
          created_at = excluded.created_at, download_url = excluded.download_url
      `).bind(assetId, version, platform, `${platform}-external`, "external", size_bytes ?? null, sha256 ?? null, sha512 ?? null, now, download_url).run();
      return jsonResponse({ upload_id: uploadId, file_upload_needed: false, asset_id: assetId });
    }

    return jsonResponse({ upload_id: uploadId, file_upload_needed: true, r2_key: r2Key });
  }

  // ── PUT /releases/upload-stream/{upload_id} — stream raw binary to R2 ───────
  // Body is the raw binary file (not multipart). Streams directly to R2 — no
  // 100 MB buffering limit. Must be called after POST /releases/upload-init.
  if (pathname.startsWith("/releases/upload-stream/") && method === "PUT") {
    const uploadId = pathname.slice("/releases/upload-stream/".length);
    if (!uploadId) return jsonResponse({ error: "Missing upload_id" }, 400);

    const auth = await requireAdmin(request, env, "publisher");
    if (auth instanceof Response) return auth;

    const slotRaw = await env.REGISTRY_KV.get(`upload_slot:${uploadId}`);
    if (!slotRaw) return jsonResponse({ error: "Upload slot not found or expired" }, 404);

    let slot: {
      version: string; platform: string; channel: string; release_notes: string;
      sha256: string; sha512: string; size_bytes: number; filename: string;
      r2Key: string; actorId: string; download_url: string | null;
    };
    try { slot = JSON.parse(slotRaw); } catch {
      return jsonResponse({ error: "Corrupt upload slot" }, 500);
    }

    if (!request.body) return jsonResponse({ error: "Empty request body" }, 400);

    // Stream directly to R2 — no arrayBuffer() call, no memory buffering
    await env.BUCKET.put(slot.r2Key, request.body, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { version: slot.version, platform: slot.platform, sha256: slot.sha256, sha512: slot.sha512 },
    });

    // Finalize DB records
    const now = new Date().toISOString();
    const assetId = generateUUID();
    await env.DB.prepare(`
      INSERT INTO releases (id, version, channel, release_notes, published_at, published_by, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(version) DO UPDATE SET
        release_notes = COALESCE(excluded.release_notes, release_notes),
        channel = excluded.channel
    `).bind(slot.version, slot.version, slot.channel, slot.release_notes, now, slot.actorId).run();
    await env.DB.prepare(`
      INSERT INTO release_assets (id, release_id, platform, filename, r2_key, size_bytes, sha256, sha512, created_at, download_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id, platform) DO UPDATE SET
        filename = excluded.filename, r2_key = excluded.r2_key,
        size_bytes = excluded.size_bytes, sha256 = excluded.sha256, sha512 = excluded.sha512,
        created_at = excluded.created_at, download_url = excluded.download_url
    `).bind(assetId, slot.version, slot.platform, slot.filename, slot.r2Key, slot.size_bytes, slot.sha256, slot.sha512, now, slot.download_url).run();

    // Clean up upload slot
    await env.REGISTRY_KV.delete(`upload_slot:${uploadId}`);

    return jsonResponse({ success: true, asset_id: assetId, sha256: slot.sha256, size_bytes: slot.size_bytes });
  }

  // ── POST /releases/promote ─────────────────────────────────────────────────
  if (pathname === "/releases/promote" && method === "POST") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const { version } = await request.json() as { version: string };
    if (!version) return jsonResponse({ error: "version required" }, 400);

    const exists = await env.DB.prepare("SELECT id, channel FROM releases WHERE version = ?").bind(version).first<{ id: string; channel: string }>();
    if (!exists) return jsonResponse({ error: "Release version not found" }, 404);

    // Clear is_latest only within the same channel, then promote target version
    await env.DB.batch([
      env.DB.prepare("UPDATE releases SET is_latest = 0 WHERE channel = ?").bind(exists.channel),
      env.DB.prepare("UPDATE releases SET is_latest = 1 WHERE version = ?").bind(version),
    ]);

    return jsonResponse({ success: true, latest: version, channel: exists.channel });
  }

  // ── POST /releases/revoke ─────────────────────────────────────────────────
  // Mark a release as revoked — hides from public endpoints, clears is_latest.
  if (pathname === "/releases/revoke" && method === "POST") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const { version } = await request.json() as { version: string };
    if (!version) return jsonResponse({ error: "version required" }, 400);

    const exists = await env.DB.prepare("SELECT id FROM releases WHERE version = ?").bind(version).first();
    if (!exists) return jsonResponse({ error: "Release version not found" }, 404);

    await env.DB.prepare("UPDATE releases SET status = 'revoked', is_latest = 0 WHERE version = ?").bind(version).run();

    return jsonResponse({ success: true, version, status: "revoked" });
  }

  // ── POST /releases/restore ────────────────────────────────────────────────
  // Restore a previously revoked release to active status (does not re-promote to latest).
  if (pathname === "/releases/restore" && method === "POST") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const { version } = await request.json() as { version: string };
    if (!version) return jsonResponse({ error: "version required" }, 400);

    const exists = await env.DB.prepare("SELECT id FROM releases WHERE version = ?").bind(version).first();
    if (!exists) return jsonResponse({ error: "Release version not found" }, 404);

    await env.DB.prepare("UPDATE releases SET status = 'active' WHERE version = ?").bind(version).run();

    return jsonResponse({ success: true, version, status: "active" });
  }

  // ── POST /releases/delete ─────────────────────────────────────────────────
  // Permanently delete a release + all assets. Optionally also purge R2 files.
  if (pathname === "/releases/delete" && method === "POST") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const { version, delete_files = false } = await request.json() as { version: string; delete_files?: boolean };
    if (!version) return jsonResponse({ error: "version required" }, 400);

    const exists = await env.DB.prepare("SELECT id FROM releases WHERE version = ?").bind(version).first();
    if (!exists) return jsonResponse({ error: "Release version not found" }, 404);

    // If delete_files requested, gather r2_keys and purge from R2
    let filesDeleted = 0;
    if (delete_files) {
      const assets = await env.DB.prepare("SELECT r2_key FROM release_assets WHERE release_id = ? AND r2_key != ''").bind(version).all<{ r2_key: string }>();
      for (const asset of assets.results) {
        if (asset.r2_key) {
          try { await env.BUCKET.delete(asset.r2_key); filesDeleted++; } catch {}
        }
      }
    }

    // Delete release row — cascades to release_assets via ON DELETE CASCADE
    await env.DB.prepare("DELETE FROM releases WHERE version = ?").bind(version).run();

    return jsonResponse({ success: true, version, files_deleted: filesDeleted });
  }

  // ── POST /releases/delete-asset ───────────────────────────────────────────
  // Delete a single platform asset from a release. Optionally purge the R2 file.
  if (pathname === "/releases/delete-asset" && method === "POST") {
    const auth = await requireAdmin(request, env, "admin");
    if (auth instanceof Response) return auth;

    const { version, platform, delete_file = false } = await request.json() as { version: string; platform: string; delete_file?: boolean };
    if (!version || !platform) return jsonResponse({ error: "version and platform required" }, 400);

    const asset = await env.DB.prepare(
      "SELECT id, r2_key FROM release_assets WHERE release_id = ? AND platform = ?"
    ).bind(version, platform).first<{ id: string; r2_key: string }>();
    if (!asset) return jsonResponse({ error: "Asset not found" }, 404);

    if (delete_file && asset.r2_key) {
      try { await env.BUCKET.delete(asset.r2_key); } catch {}
    }

    await env.DB.prepare("DELETE FROM release_assets WHERE id = ?").bind(asset.id).run();

    return jsonResponse({ success: true, version, platform, file_deleted: delete_file && Boolean(asset.r2_key) });
  }

  return jsonResponse({ error: "Not found" }, 404);
}

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

/** Require a user token (Authorization: Bearer mact_xxx). Returns UserRow or 401 Response. */
async function requireUser(request: Request, env: Env): Promise<UserRow | Response> {
  const raw = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!raw || !raw.startsWith("mact_")) {
    return jsonResponse({ error: "Unauthorized — user token required (mact_xxx)" }, 401);
  }
  const hash = await sha256hex(raw);
  const row = await env.DB.prepare(
    "SELECT id, email, username, is_active, token_prefix FROM users WHERE token_hash = ?"
  ).bind(hash).first<UserRow>();
  if (!row) return jsonResponse({ error: "Unauthorized — invalid token" }, 401);
  if (!row.is_active) return jsonResponse({ error: "Forbidden — account suspended" }, 403);

  // Update last_seen (fire-and-forget)
  env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id).run();

  return row;
}

/** Extract user from X-User-Token header (non-throwing, returns null if absent/invalid). */
async function optionalUser(request: Request, env: Env): Promise<UserRow | null> {
  const raw = request.headers.get("X-User-Token") ?? request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!raw || !raw.startsWith("mact_")) return null;
  const hash = await sha256hex(raw);
  const row = await env.DB.prepare(
    "SELECT id, email, username, is_active, token_prefix FROM users WHERE token_hash = ?"
  ).bind(hash).first<UserRow>().catch(() => null);
  if (!row || !row.is_active) return null;
  return row;
}

/** Return all org IDs for a given user. */
async function getUserOrgIds(userId: string, env: Env): Promise<string[]> {
  const result = await env.DB.prepare("SELECT org_id FROM user_orgs WHERE user_id = ?")
    .bind(userId).all<{ org_id: string }>();
  return result.results.map(r => r.org_id);
}

// ─── Turnstile & OTP Session ─────────────────────────────────────────────────

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  // Turnstile siteverify requires application/x-www-form-urlencoded, NOT JSON.
  const params = new URLSearchParams({ secret, response: token });
  if (ip) params.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }).catch(() => null);
  if (!res || !res.ok) return false;
  const data = await res.json() as { success: boolean };
  return data.success;
}

async function checkResendSession(
  kv: Env["REGISTRY_KV"],
  sessionId: string,
  email: string,
): Promise<{ ok: true; session: OtpSession } | { ok: false; error: string; status: number }> {
  const raw = await kv.get(`otp_session:${sessionId}`);
  if (!raw) return { ok: false, error: "Session expired. Please start over.", status: 410 };
  const session = JSON.parse(raw) as OtpSession;
  if (session.email !== email.toLowerCase()) return { ok: false, error: "Session mismatch.", status: 403 };
  if (session.resend_count >= 3)
    return { ok: false, error: "Max resends reached. Please start over.", status: 429 };
  if (session.last_resend_at) {
    const waited = Date.now() - new Date(session.last_resend_at).getTime();
    if (waited < 60_000)
      return { ok: false, error: `Please wait ${Math.ceil((60_000 - waited) / 1000)}s before resending.`, status: 429 };
  }
  return { ok: true, session };
}

// ─── Email ────────────────────────────────────────────────────────────────────

// Sends OTP email via Resend transactional API.
// purpose: "register" = email verification for new account; "retrieve" = token retrieval for existing account.
// HTML supports both light and dark mode via @media (prefers-color-scheme: dark).
// Returns null on success, or an error message string on failure.
async function sendOtpEmail(
  apiKey: string,
  toEmail: string,
  otp: string,
  purpose: "register" | "retrieve" = "retrieve",
): Promise<string | null> {
  const isRegister = purpose === "register";
  const eyebrow    = isRegister ? "Account Verification" : "Token Retrieval";
  const headline   = isRegister ? "Verify your email address." : "Your verification code is here.";
  const bodyLine   = isRegister
    ? `We received a request to create a MindAct account for <strong style="color:#333">${toEmail}</strong>. Enter the code below to verify your email and complete registration.`
    : `We received a request to retrieve the token for <strong style="color:#333">${toEmail}</strong>. Enter the code below to verify your identity.`;
  const ignoreNote = isRegister
    ? "If you didn't request this, you can safely ignore this email. No account will be created."
    : "If you didn't request this, you can safely ignore this email. Your account remains secure.";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>MindAct Verification</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { -webkit-font-smoothing:antialiased; }

  /* ── Light (default) ── */
  .outer     { background-color:#f7f6f2; }
  .card      { background-color:#ffffff; border-color:rgba(0,0,0,0.06); }
  .wordmark  { color:#0d0d0d; }
  .tag-lbl   { color:#aaa9a2; }
  .eyebrow   { color:#b5b0a8; }
  .headline  { color:#0d0d0d; }
  .body-text { color:#7a7a72; }
  .sep       { border-color:#eceae5; }
  .otp-wrap  { background-color:#f7f6f2; border-color:#e5e1db; }
  .otp-val   { color:#0d0d0d; }
  .notice    { color:#b5b2ac; }
  .notice-em { color:#8a8880; }
  .foot      { color:#c5c2bc; }

  /* ── Dark ── */
  @media (prefers-color-scheme:dark) {
    .outer    { background-color:#0f0f11 !important; }
    .card     { background-color:#18181c !important; border-color:rgba(255,255,255,0.07) !important; }
    .wordmark { color:#f0f0ec !important; }
    .tag-lbl  { color:#38383e !important; }
    .eyebrow  { color:#46464e !important; }
    .headline { color:#f0f0ec !important; }
    .body-text{ color:#888892 !important; }
    .sep      { border-color:rgba(255,255,255,0.06) !important; }
    .otp-wrap { background-color:#111115 !important; border-color:rgba(52,211,153,0.22) !important; }
    .otp-val  { color:#34d399 !important; letter-spacing:14px !important; }
    .notice   { color:#3c3c42 !important; }
    .notice-em{ color:#565660 !important; }
    .foot     { color:#2c2c30 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f7f6f2;">
<div class="outer" style="background-color:#f7f6f2;padding:52px 16px 44px;">

  <!-- Wordmark row -->
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;margin:0 auto 28px;">
    <tr>
      <td>
        <span class="wordmark" style="font-size:15px;font-weight:600;letter-spacing:-0.3px;color:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">MindAct</span>
      </td>
      <td align="right">
        <span class="tag-lbl" style="font-size:10px;font-weight:500;letter-spacing:1.6px;text-transform:uppercase;color:#aaa9a2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Verification</span>
      </td>
    </tr>
  </table>

  <!-- Card -->
  <table class="card" width="100%" cellpadding="0" cellspacing="0"
    style="max-width:540px;margin:0 auto;background-color:#ffffff;border-radius:16px;
           border:1px solid rgba(0,0,0,0.06);overflow:hidden;
           box-shadow:0 2px 4px rgba(0,0,0,0.03),0 8px 28px rgba(0,0,0,0.05);">

    <!-- Content -->
    <tr>
      <td style="padding:44px 44px 36px;">
        <p class="eyebrow" style="font-size:10px;font-weight:500;letter-spacing:1.9px;text-transform:uppercase;color:#b5b0a8;margin-bottom:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${eyebrow}</p>
        <h1 class="headline" style="font-size:27px;font-weight:400;color:#0d0d0d;line-height:1.22;letter-spacing:-0.4px;margin-bottom:16px;font-family:Georgia,'Times New Roman',Times,serif;">${headline}</h1>
        <p class="body-text" style="font-size:14px;font-weight:400;color:#7a7a72;line-height:1.8;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${bodyLine}</p>
      </td>
    </tr>

    <!-- Divider -->
    <tr><td style="padding:0 44px;"><hr class="sep" style="border:none;border-top:1px solid #eceae5;margin:0;"></td></tr>

    <!-- OTP -->
    <tr>
      <td style="padding:32px 44px 30px;">
        <p class="eyebrow" style="font-size:10px;font-weight:500;letter-spacing:1.9px;text-transform:uppercase;color:#b5b0a8;margin-bottom:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Your code</p>
        <table class="otp-wrap" cellpadding="0" cellspacing="0" width="100%"
          style="background-color:#f7f6f2;border:1px solid #e5e1db;border-radius:10px;">
          <tr>
            <td style="padding:26px 20px;text-align:center;">
              <span class="otp-val"
                style="font-family:'Courier New',Courier,monospace;font-size:42px;font-weight:400;
                       color:#0d0d0d;letter-spacing:14px;text-indent:14px;line-height:1;display:block;">
                ${otp}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Divider -->
    <tr><td style="padding:0 44px;"><hr class="sep" style="border:none;border-top:1px solid #eceae5;margin:0;"></td></tr>

    <!-- Notice -->
    <tr>
      <td style="padding:22px 44px 36px;">
        <p class="notice" style="font-size:12px;font-weight:400;color:#b5b2ac;line-height:2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
          Expires in <span class="notice-em" style="color:#8a8880;">10 minutes</span>&ensp;·&ensp;${ignoreNote}&ensp;·&ensp;Never share this code.
        </p>
      </td>
    </tr>

  </table>

  <!-- Footer -->
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;margin:24px auto 0;padding:0 4px;">
    <tr>
      <td>
        <span class="foot" style="font-size:11px;font-weight:400;color:#c5c2bc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">© 2026 KeploreAI</span>
      </td>
      <td align="right">
        <span class="foot" style="font-size:11px;font-weight:400;color:#c5c2bc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">physmind.ai</span>
      </td>
    </tr>
  </table>

</div>
</body>
</html>`;

  const subject = isRegister
    ? "Verify your email — MindAct"
    : "Your MindAct verification code";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MindAct <Retrieval@noreply.physmind.ai>",
      to: [toEmail],
      subject,
      html,
    }),
  }).catch((err: unknown) => {
    console.error("[sendOtpEmail] fetch failed:", err);
    return null;
  });

  if (!res) return "Email service unreachable — please try again later.";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[sendOtpEmail] Resend error ${res.status}: ${body}`);
    return `Email delivery failed (${res.status}). Please try again.`;
  }
  return null; // success
}

// ─── Utility Helpers ──────────────────────────────────────────────────────────

function rowToDD(row: Record<string, unknown>) {
  const manifest = row.manifest_json ? JSON.parse(String(row.manifest_json)) : {};
  return {
    id: row.id,
    version: row.version,
    type: row.type,
    modes: JSON.parse(String(row.modes ?? "[]")),
    name: row.name,
    description: row.description,
    tags: JSON.parse(String(row.tags ?? "[]")),
    domain: row.domain ?? "",
    source: { type: "remote", registryUrl: "", id: String(row.id) },
    publisher: row.publisher ?? "",
    visibility: row.visibility ?? "public",
    owner_user_id: row.owner_user_id ?? null,
    owner_org_id: row.owner_org_id ?? null,
    trust: row.trust ?? "untrusted",
    maturity: row.maturity ?? "L0",
    pkg_status: row.pkg_status ?? row.status ?? "published",
    has_package: !!(row.r2_zip_key),
    ...(manifest.trigger ? { trigger: manifest.trigger } : {}),
    ...(manifest.executionPolicy ? { executionPolicy: manifest.executionPolicy } : {}),
  };
}

async function getLatestVersion(id: string, env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT version FROM dependency_versions WHERE dd_id = ? AND is_latest = 1"
  ).bind(id).first();
  return row ? String(row.version) : null;
}

async function invalidateKV(id: string, env: Env): Promise<void> {
  const keys = await env.REGISTRY_KV.list({ prefix: `item:${id}` });
  await Promise.all(keys.keys.map(k => env.REGISTRY_KV.delete(k.name)));
  const listKeys = await env.REGISTRY_KV.list({ prefix: "list:" });
  await Promise.all(listKeys.keys.map(k => env.REGISTRY_KV.delete(k.name)));
}

function requireAuth(request: Request, env: Env): Response | null {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (env.REGISTRY_TOKEN && token !== env.REGISTRY_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(request: Request, env: Env, requiredRole: "admin" | "publisher" = "admin"): Promise<{ role: string; actorId: string } | Response> {
  const raw = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!raw) return jsonResponse({ error: "Unauthorized — no token" }, 401);
  // Reject user tokens early (they start with mact_)
  if (raw.startsWith("mact_")) return jsonResponse({ error: "Unauthorized — admin token required" }, 401);

  const hash = await sha256hex(raw);
  const row = await env.DB.prepare(
    "SELECT actor_id, role, expires_at FROM admin_tokens WHERE token_hash = ?"
  ).bind(hash).first<{ actor_id: string; role: string; expires_at: string | null }>();

  if (row) {
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return jsonResponse({ error: "Unauthorized — token expired" }, 401);
    }
    if (requiredRole === "admin" && row.role !== "admin") {
      return jsonResponse({ error: "Forbidden — admin role required" }, 403);
    }
    return { role: row.role, actorId: row.actor_id };
  }

  if (env.REGISTRY_TOKEN && raw === env.REGISTRY_TOKEN) {
    return { role: "admin", actorId: "registry-master" };
  }

  return jsonResponse({ error: "Unauthorized — token not found" }, 401);
}

/** Generate a cryptographically random hex string of `byteLen` bytes. */
function generateHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a UUID v4. */
function generateUUID(): string {
  const hex = generateHex(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cors(response: Response): Response {
  const res = new Response(response.body, response);
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Token");
  return res;
}

// ─── Shared nav snippet ──────────────────────────────────────────────────────

function sharedNavHtml(activePage: "home" | "download" | "signin" | ""): string {
  const link = (href: string, label: string, page: string) => {
    const isActive = activePage === page;
    return `<a href="${href}" style="font-size:12px;color:${isActive ? "#4ec9b0" : "#888"};text-decoration:none;transition:color .15s" onmouseover="this.style.color='${isActive ? "#4ec9b0" : "#ccc"}'" onmouseout="this.style.color='${isActive ? "#4ec9b0" : "#888"}'">${label}</a>`;
  };
  return `
<nav style="display:flex;align-items:center;justify-content:space-between;padding:14px 32px;border-bottom:1px solid rgba(255,255,255,.07);width:100%;box-sizing:border-box">
  <a href="https://physical-mind.ai/" style="font-size:14px;font-weight:700;color:#fff;text-decoration:none;opacity:.92;letter-spacing:-.02em">MindAct</a>
  <div style="display:flex;gap:24px;align-items:center">
    ${link("https://physical-mind.ai/", "Home", "home")}
    ${link("https://download.physical-mind.ai", "Download", "download")}
    ${link("https://registry.physical-mind.ai/register", "Sign In", "signin")}
  </div>
</nav>`;
}

function sharedFooterHtml(): string {
  return `
<footer style="margin-top:auto;padding:32px;text-align:center;border-top:1px solid rgba(255,255,255,.06)">
  <div style="display:flex;justify-content:center;gap:20px;margin-bottom:10px">
    <a href="https://physical-mind.ai/" style="font-size:11px;color:#555;text-decoration:none">physical-mind.ai</a>
    <a href="https://registry.physical-mind.ai/" style="font-size:11px;color:#555;text-decoration:none">Registry</a>
    <a href="https://download.physical-mind.ai" style="font-size:11px;color:#555;text-decoration:none">Download</a>
  </div>
  <div style="font-size:10px;color:#333">&copy; 2026 Physical Mind AI</div>
</footer>`;
}

// ─── Gateway HTML ─────────────────────────────────────────────────────────────

function buildGatewayHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>MindAct Registry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0f;color:#ccc;
  display:flex;flex-direction:column;min-height:100vh}
.main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:48px 24px;text-align:center}
.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(78,201,176,.08);
  border:1px solid rgba(78,201,176,.2);border-radius:999px;padding:4px 12px;
  font-size:11px;color:#4ec9b0;letter-spacing:.04em;margin-bottom:28px}
.badge-dot{width:6px;height:6px;border-radius:50%;background:#4ec9b0}
h1{font-size:clamp(28px,5vw,48px);font-weight:700;color:#fff;letter-spacing:-.03em;
  line-height:1.1;margin-bottom:16px}
.sub{font-size:15px;color:#666;max-width:440px;line-height:1.7;margin-bottom:36px}
.sub strong{color:#999;font-weight:500}
.btn-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn-primary{display:inline-flex;align-items:center;gap:8px;padding:11px 24px;
  background:#0a2a20;border:1px solid rgba(78,201,176,.4);border-radius:8px;
  color:#4ec9b0;font-size:13px;font-weight:600;text-decoration:none;transition:all .15s}
.btn-primary:hover{background:rgba(78,201,176,.12);border-color:#4ec9b0}
.btn-sec{display:inline-flex;align-items:center;gap:8px;padding:11px 24px;
  background:transparent;border:1px solid #2a2a2a;border-radius:8px;
  color:#777;font-size:13px;font-weight:500;text-decoration:none;transition:all .15s}
.btn-sec:hover{border-color:#444;color:#aaa}
</style>
</head>
<body>
${sharedNavHtml("")}
<div class="main">
  <div class="badge"><span class="badge-dot"></span>API Registry</div>
  <h1>This registry is designed<br>to be used with MindAct.</h1>
  <p class="sub">
    The MindAct Registry is a secure package repository for <strong>AI skills</strong>,
    knowledge bases, and decision pipelines. It is accessed programmatically
    by the MindAct desktop client — not through a browser.
  </p>
  <div class="btn-row">
    <a href="https://download.physical-mind.ai" class="btn-primary">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12L3 7h3V2h4v5h3L8 12zm-5 2h10v1.5H3V14z"/></svg>
      Download MindAct
    </a>
    <a href="/register" class="btn-sec">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3.5 3.5 0 1 0 0 7A3.5 3.5 0 0 0 8 1zm-5 10.5C3 9.6 5.2 8 8 8s5 1.6 5 3.5V13H3v-1.5z"/></svg>
      Sign In to Registry
    </a>
  </div>
</div>
${sharedFooterHtml()}
</body>
</html>`;
}

// ─── Register HTML ────────────────────────────────────────────────────────────

function buildRegisterHtml(origin: string, callbackUrl: string, turnstileSiteKey = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>MindAct — Sign In</title>
${turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad" async defer></script>' : ""}
<style>
*{box-sizing:border-box;margin:0;padding:0}

/* ── Dark base (default) ── */
:root{
  --bg:#0d0d14;--card-bg:#111118;--card-border:#2a2a2a;--text:#ccc;--text-dim:#888;
  --text-faint:#444;--input-bg:#1a1a24;--input-border:#333;--input-text:#d4d4d4;
  --tab-active:#4ec9b0;--btn-bg:#0a2a20;--btn-border:#4ec9b088;--btn-text:#4ec9b0;
  --btn-sec-bg:#1a1a2a;--err-bg:#2a0808;--err-border:#e0555544;--err-text:#e05555;
  --ok-bg:#082a1a;--ok-border:#4ec9b044;--ok-text:#4ec9b0;
  --token-bg:#0d0d14;--token-border:#4ec9b044;--token-text:#4ec9b0;
  --hr:#1a1a1a;--close:#333;
}
/* ── Light mode override ── */
@media(prefers-color-scheme:light){
  :root{
    --bg:#f5f4f0;--card-bg:#ffffff;--card-border:rgba(0,0,0,0.08);--text:#111;--text-dim:#666;
    --text-faint:#999;--input-bg:#f0f0f0;--input-border:#d0d0d0;--input-text:#111;
    --tab-active:#0a7c5c;--btn-bg:#0a7c5c;--btn-border:#0a7c5c;--btn-text:#fff;
    --btn-sec-bg:#e8e8e8;--err-bg:#fef2f2;--err-border:#fca5a544;--err-text:#dc2626;
    --ok-bg:#f0fdf4;--ok-border:#86efac44;--ok-text:#166534;
    --token-bg:#f0fdf4;--token-border:#86efac88;--token-text:#0a7c5c;
    --hr:#e5e7eb;--close:#9ca3af;
  }
}

html,body{height:100%}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);
  display:flex;flex-direction:column;min-height:100vh}
.page-content{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 24px}
.card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:12px;
  padding:32px 36px;width:420px;max-width:100%;box-shadow:0 4px 24px rgba(0,0,0,.15)}
.logo{text-align:center;margin-bottom:24px}
.logo-icon{font-size:30px;margin-bottom:6px}
.logo-title{font-size:16px;font-weight:700;color:var(--text)}
.logo-sub{font-size:11px;color:var(--text-faint);margin-top:4px}
.tabs{display:flex;border-bottom:1px solid var(--hr);margin-bottom:24px}
.tab{flex:1;padding:9px 0;background:none;border:none;border-bottom:2px solid transparent;
  color:var(--text-faint);cursor:pointer;font-size:12px;font-weight:400;transition:all .1s}
.tab.active{border-bottom-color:var(--tab-active);color:var(--tab-active);font-weight:700}
label{font-size:10px;color:var(--text-dim);display:block;margin-bottom:4px;
  text-transform:uppercase;letter-spacing:.5px}
input{width:100%;background:var(--input-bg);border:1px solid var(--input-border);border-radius:6px;
  color:var(--input-text);padding:9px 11px;font-size:13px;outline:none;margin-bottom:12px;transition:border-color .15s}
input:focus{border-color:var(--tab-active)}
.btn{width:100%;background:var(--btn-bg);border:1px solid var(--btn-border);border-radius:6px;
  color:var(--btn-text);cursor:pointer;font-size:12px;padding:10px 0;font-weight:700;margin-top:4px;transition:opacity .15s}
.btn:disabled{opacity:.5;cursor:default}
.btn:not(:disabled):hover{opacity:.85}
.btn-sec{background:var(--btn-sec-bg);border-color:var(--input-border);color:var(--text-dim)}
.err{padding:8px 12px;background:var(--err-bg);border:1px solid var(--err-border);border-radius:6px;
  font-size:11px;color:var(--err-text);margin-bottom:12px}
.ok{padding:8px 12px;background:var(--ok-bg);border:1px solid var(--ok-border);border-radius:6px;
  font-size:11px;color:var(--ok-text);margin-bottom:12px}
.token-box{background:var(--token-bg);border:1px solid var(--token-border);border-radius:8px;
  padding:16px;margin-bottom:14px}
.token-label{font-size:9px;color:var(--text-faint);margin-bottom:8px;text-transform:uppercase;letter-spacing:.8px}
.token-text{font-family:monospace;font-size:11px;color:var(--token-text);word-break:break-all;
  letter-spacing:.05em;line-height:1.6;user-select:all;cursor:text}
.row{display:flex;gap:8px}
.note{font-size:10px;color:var(--text-faint);text-align:center;margin-top:10px;line-height:1.6}
.otp-hint{font-size:11px;color:var(--text-dim);margin-bottom:10px;line-height:1.6}
.otp-input{letter-spacing:.4em;font-size:22px;text-align:center;font-family:monospace;
  padding:12px 11px !important;font-weight:600}
hr{border:none;border-top:1px solid var(--hr);margin:20px 0}
.card a{font-size:10px;color:var(--close);display:block;text-align:center;text-decoration:none}
.card a:hover{opacity:.7}
.step-indicator{font-size:10px;color:var(--text-faint);text-align:center;margin-bottom:16px;
  letter-spacing:.5px;text-transform:uppercase}
</style>
</head>
<body>
${sharedNavHtml("signin")}
<div class="page-content">
<div class="card">
  <div class="logo">
    <div class="logo-title">MindAct Account</div>
    <div class="logo-sub">Register an account to sync your data.</div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="showTab('register',this)">Register</button>
    <button class="tab" onclick="showTab('retrieve',this)">Retrieve Token</button>
  </div>

  <!-- ── Register tab ── -->
  <div id="tab-register">
    <div id="reg-err" class="err" style="display:none"></div>
    <div id="reg-info" class="ok" style="display:none"></div>

    <!-- Step 1: Email + Username -->
    <div id="reg-step1">
      <div class="step-indicator">Step 1 of 2 — Enter your details</div>
      <label>Email address</label>
      <input id="reg-email" type="email" placeholder="you@example.com"
        onkeydown="if(event.key==='Enter')doRegSendOtp()">
      <label>Username (optional)</label>
      <input id="reg-username" type="text" placeholder="your-handle"
        onkeydown="if(event.key==='Enter')doRegSendOtp()">
      ${turnstileSiteKey ? `<div id="reg-turnstile-widget" style="margin:4px 0 10px"></div>` : ""}
      <button class="btn" onclick="doRegSendOtp()" id="reg-send-btn">Send Verification Code</button>
    </div>

    <!-- Step 2: OTP -->
    <div id="reg-step2" style="display:none">
      <div class="step-indicator">Step 2 of 2 — Verify your email</div>
      <p class="otp-hint">A 6-digit code was sent to <strong id="reg-email-display" style="color:var(--text)"></strong>.</p>
      <label>Verification Code</label>
      <input id="reg-otp" type="text" inputmode="numeric" autocomplete="one-time-code"
        class="otp-input" placeholder="123456" maxlength="6"
        oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)"
        onkeydown="if(event.key==='Enter')doRegVerify()">
      <div class="row" style="margin-bottom:0">
        <button class="btn btn-sec" style="flex:0 0 72px" onclick="backToRegStep1()">← Back</button>
        <button class="btn" style="flex:1" onclick="doRegVerify()" id="reg-verify-btn">Verify & Create Account</button>
      </div>
      <button onclick="doRegSendOtp(true)" style="background:none;border:none;color:var(--text-faint);
        cursor:pointer;font-size:10px;margin-top:10px;width:100%;text-align:center">Resend code</button>
    </div>

    <!-- Step 3: Token -->
    <div id="reg-done" style="display:none">
      <div class="token-box">
        <div class="token-label">Your Account Token — save it now</div>
        <div class="token-text" id="reg-token"></div>
      </div>
      <div class="row">
        <button class="btn" style="flex:1" onclick="copyText('reg-token',this,'Copy Token')">Copy Token</button>
        <button class="btn btn-sec" style="flex:1" id="reg-return" onclick="returnToApp()">Return to MindAct →</button>
      </div>
      <div class="note">Store this token safely — it won't be shown again. You can always retrieve a new one via email verification.</div>
    </div>
  </div>

  <!-- ── Retrieve tab ── -->
  <div id="tab-retrieve" style="display:none">
    <div id="ret-err" class="err" style="display:none"></div>
    <div id="ret-info" class="ok" style="display:none"></div>
    <div id="ret-done" style="display:none">
      <div class="token-box">
        <div class="token-label">Your New Account Token</div>
        <div class="token-text" id="ret-token"></div>
      </div>
      <div class="row">
        <button class="btn" style="flex:1" onclick="copyText('ret-token',this,'Copy Token')">Copy Token</button>
        <button class="btn btn-sec" style="flex:1" onclick="returnToApp()">Return to MindAct →</button>
      </div>
      <div class="note">Your previous token has been invalidated.</div>
    </div>
    <div id="ret-email-form">
      <label>Email address</label>
      <input id="ret-email" type="email" placeholder="you@example.com"
        onkeydown="if(event.key==='Enter')doSendOtp()">
      ${turnstileSiteKey ? `<div id="ret-turnstile-widget" style="margin:4px 0 10px"></div>` : ""}
      <button class="btn" onclick="doSendOtp()" id="otp-btn">Send Verification Code</button>
    </div>
    <div id="ret-otp-form" style="display:none">
      <p class="otp-hint">A 6-digit code was sent to <strong id="ret-email-display" style="color:var(--text)"></strong>.</p>
      <label>Verification Code</label>
      <input id="ret-otp" type="text" inputmode="numeric" autocomplete="one-time-code"
        class="otp-input" placeholder="123456" maxlength="6"
        oninput="this.value=this.value.replace(/\\D/g,'').slice(0,6)"
        onkeydown="if(event.key==='Enter')doVerifyOtp()">
      <div class="row" style="margin-bottom:0">
        <button class="btn btn-sec" style="flex:0 0 72px" onclick="showOtpEmailForm()">← Back</button>
        <button class="btn" style="flex:1" onclick="doVerifyOtp()" id="verify-btn">Verify & Get Token</button>
      </div>
      <button onclick="doSendOtp(true)" style="background:none;border:none;color:var(--text-faint);
        cursor:pointer;font-size:10px;margin-top:10px;width:100%;text-align:center">Resend code</button>
    </div>
  </div>

  <hr>
  <a href="javascript:window.close()">You may close this window after saving your personal token key.</a>
</div>

<script>
const REGISTRY = ${JSON.stringify(origin)};
const CALLBACK = ${JSON.stringify(callbackUrl)};
const TURNSTILE_SITE_KEY = ${JSON.stringify(turnstileSiteKey)};
let _token = null;
let _cfToken = '';        // Turnstile token from active widget
let _regEmail = '';
let _regSessionId = '';   // otp_session_id for register resend
let _retSessionId = '';   // otp_session_id for retrieve resend
let _regWidgetId = null;  // explicit Turnstile widget ID for register tab
let _retWidgetId = null;  // explicit Turnstile widget ID for retrieve tab

function _turnstileOpts(errId) {
  return { sitekey: TURNSTILE_SITE_KEY, theme: 'auto', size: 'flexible',
    callback: (t) => { _cfToken = t; if (errId) setErr(errId, ''); },
    'expired-callback': () => { _cfToken = ''; } };
}

// Called by Turnstile once api.js is ready (render=explicit&onload=onTurnstileLoad)
function onTurnstileLoad() {
  if (!TURNSTILE_SITE_KEY) return;
  // Only render widget for the initially visible tab (register)
  _regWidgetId = window.turnstile.render('#reg-turnstile-widget', _turnstileOpts('reg-err'));
}

// Show/hide "Return" button based on whether a callback is configured
if (!CALLBACK) {
  const r = document.getElementById('reg-return');
  if(r) r.style.display='none';
}

function showTab(name, el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['register','retrieve'].forEach(t=>{
    document.getElementById('tab-'+t).style.display = t===name?'block':'none';
  });
  // Lazily render Turnstile for the newly visible tab (ensures only one widget at a time)
  if (TURNSTILE_SITE_KEY && window.turnstile) {
    if (name === 'retrieve' && _retWidgetId === null) {
      _retWidgetId = window.turnstile.render('#ret-turnstile-widget', _turnstileOpts('ret-err'));
    }
    _cfToken = '';
  }
}

function setErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.style.display = msg?'block':'none';
}
function setInfo(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.style.display = msg?'block':'none';
}

function copyText(elId, btn, label) {
  const text = document.getElementById(elId).textContent.trim();
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    btn.textContent = '\\u2713 Copied!';
    setTimeout(()=>{ btn.textContent = label; }, 2000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(()=>{
      btn.textContent = '\\u2713 Copied!';
      setTimeout(()=>{ btn.textContent = label; }, 2000);
    }).catch(fallback);
  } else { fallback(); }
}

function returnToApp() {
  if (_token && CALLBACK) {
    window.location.href = CALLBACK + '?token=' + encodeURIComponent(_token);
  }
}

// ── Register: Step 1 → send OTP ──
async function doRegSendOtp(resend) {
  const email = resend ? _regEmail : document.getElementById('reg-email').value.trim().toLowerCase();
  const username = resend ? '' : document.getElementById('reg-username').value.trim();
  if (!email) { setErr('reg-err','Email is required'); return; }

  // Initial send requires Turnstile; resend uses session ID
  if (!resend && TURNSTILE_SITE_KEY && !_cfToken) {
    setErr('reg-err','Please complete the verification.'); return;
  }

  const btn = document.getElementById('reg-send-btn');
  if (btn) { btn.disabled=true; btn.textContent='Sending code\\u2026'; }
  setErr('reg-err',''); setInfo('reg-info','');
  try {
    const body = resend
      ? { email, is_resend: true, otp_session_id: _regSessionId }
      : { email, username: username||undefined, cf_turnstile_response: _cfToken||undefined };
    const res = await fetch(REGISTRY+'/auth/register-otp-send',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    _regEmail = email;
    if (data.otp_session_id) _regSessionId = data.otp_session_id;
    // Consume the Turnstile token (used once per initial send)
    if (!resend && TURNSTILE_SITE_KEY) { window.turnstile?.reset(_regWidgetId); _cfToken = ''; }
    document.getElementById('reg-email-display').textContent = email;
    document.getElementById('reg-step1').style.display='none';
    document.getElementById('reg-step2').style.display='block';
    setInfo('reg-info', resend ? 'New code sent!' : 'Code sent! Check your inbox.');
  } catch(e) {
    setErr('reg-err', e.message);
    if (btn) { btn.disabled=false; btn.textContent='Send Verification Code'; }
    // If session expired, guide user back to start over
    if (resend && (e.message.includes('Session expired') || e.message.includes('Max resends'))) {
      setTimeout(() => {
        document.getElementById('reg-step2').style.display='none';
        document.getElementById('reg-step1').style.display='block';
        _regSessionId = '';
        if (TURNSTILE_SITE_KEY) { window.turnstile?.reset(_regWidgetId); _cfToken = ''; }
      }, 2000);
    } else if (!resend && TURNSTILE_SITE_KEY) {
      window.turnstile?.reset(_regWidgetId); _cfToken = '';
    }
  }
}

function backToRegStep1() {
  document.getElementById('reg-step2').style.display='none';
  document.getElementById('reg-step1').style.display='block';
  document.getElementById('reg-otp').value='';
  setErr('reg-err',''); setInfo('reg-info','');
  const btn = document.getElementById('reg-send-btn');
  if (btn) { btn.disabled=false; btn.textContent='Send Verification Code'; }
}

// ── Register: Step 2 → verify OTP + create account ──
async function doRegVerify() {
  const otp = document.getElementById('reg-otp').value.trim();
  if (otp.length!==6) { setErr('reg-err','Enter the 6-digit code'); return; }
  const btn = document.getElementById('reg-verify-btn');
  btn.disabled=true; btn.textContent='Verifying\\u2026';
  setErr('reg-err','');
  try {
    const res = await fetch(REGISTRY+'/auth/register-verify',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email: _regEmail, otp})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    _token = data.token;
    document.getElementById('reg-token').textContent = data.token;
    document.getElementById('reg-step2').style.display='none';
    setInfo('reg-info','');
    document.getElementById('reg-done').style.display='block';
    if (CALLBACK) {
      document.getElementById('reg-return').style.display='inline-flex';
      setTimeout(returnToApp, 600);
    }
  } catch(e) {
    setErr('reg-err', e.message);
    btn.disabled=false; btn.textContent='Verify & Create Account';
  }
}

// ── Retrieve: send OTP ──
async function doSendOtp(resend) {
  const email = document.getElementById('ret-email').value.trim().toLowerCase();
  if (!email) { setErr('ret-err','Email is required'); return; }

  // Initial send requires Turnstile; resend uses session ID
  if (!resend && TURNSTILE_SITE_KEY && !_cfToken) {
    setErr('ret-err','Please complete the verification.'); return;
  }

  const btn = document.getElementById('otp-btn');
  btn.disabled=true; btn.textContent='Sending code\\u2026';
  setErr('ret-err',''); setInfo('ret-info','');
  try {
    const body = resend
      ? { email, is_resend: true, otp_session_id: _retSessionId }
      : { email, cf_turnstile_response: _cfToken||undefined };
    const res = await fetch(REGISTRY+'/auth/send-otp',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    if (data.otp_session_id) _retSessionId = data.otp_session_id;
    if (!resend && TURNSTILE_SITE_KEY) { window.turnstile?.reset(_retWidgetId); _cfToken = ''; }
    document.getElementById('ret-email-display').textContent = email;
    document.getElementById('ret-email-form').style.display='none';
    document.getElementById('ret-otp-form').style.display='block';
    setInfo('ret-info', resend ? 'New code sent!' : 'Code sent! Check your inbox.');
  } catch(e) {
    setErr('ret-err', e.message);
    btn.disabled=false; btn.textContent='Send Verification Code';
    if (resend && (e.message.includes('Session expired') || e.message.includes('Max resends'))) {
      setTimeout(() => {
        document.getElementById('ret-otp-form').style.display='none';
        document.getElementById('ret-email-form').style.display='block';
        _retSessionId = '';
        if (TURNSTILE_SITE_KEY) { window.turnstile?.reset(_retWidgetId); _cfToken = ''; }
      }, 2000);
    } else if (!resend && TURNSTILE_SITE_KEY) {
      window.turnstile?.reset(_retWidgetId); _cfToken = '';
    }
  }
}

function showOtpEmailForm() {
  document.getElementById('ret-email-form').style.display='block';
  document.getElementById('ret-otp-form').style.display='none';
  document.getElementById('ret-otp').value='';
  setErr('ret-err',''); setInfo('ret-info','');
  const btn = document.getElementById('otp-btn');
  if (btn) { btn.disabled=false; btn.textContent='Send Verification Code'; }
}

// ── Retrieve: verify OTP ──
async function doVerifyOtp() {
  const email = document.getElementById('ret-email').value.trim().toLowerCase();
  const otp = document.getElementById('ret-otp').value.trim();
  if (otp.length!==6) { setErr('ret-err','Enter the 6-digit code'); return; }
  const btn = document.getElementById('verify-btn');
  btn.disabled=true; btn.textContent='Verifying\\u2026';
  setErr('ret-err','');
  try {
    const res = await fetch(REGISTRY+'/auth/verify-otp',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, otp})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'HTTP '+res.status);
    _token = data.token;
    document.getElementById('ret-token').textContent = data.token;
    document.getElementById('ret-otp-form').style.display='none';
    setInfo('ret-info','');
    document.getElementById('ret-done').style.display='block';
    if (CALLBACK) setTimeout(returnToApp, 600);
  } catch(e) {
    setErr('ret-err',e.message);
    btn.disabled=false; btn.textContent='Verify & Get Token';
  }
}
</script>
</div><!-- .page-content -->
${sharedFooterHtml()}
</body>
</html>`;
}
