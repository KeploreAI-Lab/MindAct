declare const __REGISTRY_URL__: string;

export const DEFAULT_REGISTRY_URL = __REGISTRY_URL__;

export function getSession(): { token: string; url: string } | null {
  const token = sessionStorage.getItem("admin_token");
  const url = sessionStorage.getItem("registry_url") ?? DEFAULT_REGISTRY_URL;
  if (!token) return null;
  return { token, url };
}

export function saveSession(token: string, url: string) {
  sessionStorage.setItem("admin_token", token);
  sessionStorage.setItem("registry_url", url);
}

export function clearSession() {
  sessionStorage.removeItem("admin_token");
  sessionStorage.removeItem("registry_url");
}

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const session = getSession();
  if (!session) throw new Error("Not authenticated");
  const url = session.url.replace(/\/$/, "") + path;
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${session.token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const data = await res.json() as T;
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json() as T;
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data;
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Not authenticated");
  const url = session.url.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${session.token}` },
    body: formData,
  });
  const data = await res.json() as T;
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data;
}

export interface UploadProgress {
  loaded: number;   // bytes sent so far
  total: number;    // total bytes (0 if unknown)
  speedBps: number; // bytes per second (rolling)
}

/** Upload with real progress events via XMLHttpRequest. */
export function apiUploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (p: UploadProgress) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const session = getSession();
    if (!session) { reject(new Error("Not authenticated")); return; }

    const url = session.url.replace(/\/$/, "") + path;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);

    let lastLoaded = 0;
    let lastTime = Date.now();

    xhr.upload.onprogress = (e) => {
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      const delta = e.loaded - lastLoaded;
      const speedBps = elapsed > 0.05 ? delta / elapsed : 0;
      lastLoaded = e.loaded;
      lastTime = now;
      onProgress({ loaded: e.loaded, total: e.total, speedBps });
    };

    xhr.onload = () => {
      let data: unknown;
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        reject(new Error((data as any)?.error ?? `HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

// ─── API helpers ───────────────────────────────────────────────────────────────

export async function getStats() {
  return apiGet<{
    total_packages: number;
    total_installs: number;
    by_status: Array<{ status: string; cnt: number }>;
    governance: Array<{ event_type: string; cnt: number }>;
  }>("/registry/admin/stats");
}

export async function listPackages(status?: string) {
  const qs = status ? `?status=${status}` : "";
  return apiGet<{
    items: Array<{
      id: string; name: string; description: string; type: string; publisher: string;
      domain: string; tags: string; visibility: string;
      installed_count: number; version: string; trust: string; maturity: string;
      pkg_status: string; published_at: string; zip_sha256: string | null; zip_size_bytes: number | null;
    }>;
  }>(`/registry/admin/list${qs}`);
}

export async function listPending() {
  return apiGet<{
    items: Array<{
      id: string; name: string; description: string; type: string; publisher: string;
      domain: string; tags: string; version: string;
      trust: string; maturity: string; published_at: string;
      zip_size_bytes: number | null; r2_zip_key: string | null;
    }>;
  }>("/registry/admin/pending");
}

export async function approvePackage(ddId: string, version: string, action: "approve" | "reject" | "yank", trust?: string, note?: string) {
  return apiPost<{ ok: boolean; status: string }>("/registry/admin/approve", {
    dd_id: ddId, version, action, trust: trust ?? "reviewed", note,
  });
}

export async function setStatus(ddId: string, version: string, status: string) {
  return apiPost<{ ok: boolean }>("/registry/admin/set-status", { dd_id: ddId, version, status });
}

export async function publishMetadata(manifest: Record<string, unknown>, forcePublish: boolean) {
  return apiPost<{ ok: boolean }>("/registry/publish", {
    ...manifest,
    _status: forcePublish ? "published" : "pending",
  });
}

export async function uploadPackage(ddId: string, version: string, zipFile: File, skillmdFile?: File) {
  const form = new FormData();
  form.append("dd_id", ddId);
  form.append("version", version);
  form.append("package", zipFile, zipFile.name);
  if (skillmdFile) form.append("skillmd", skillmdFile, "SKILL.md");
  return apiUpload<{ ok: boolean; zip_sha256: string; zip_size_bytes: number }>("/registry/upload-package", form);
}

export async function getGovernance(ddId?: string, limit = 100) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (ddId) qs.set("dd_id", ddId);
  return apiGet<{
    events: Array<{
      id: number; dd_id: string; version: string | null;
      event_type: string; actor: string; note: string | null; occurred_at: string;
    }>;
  }>(`/registry/admin/governance?${qs}`);
}

export async function getAnalytics() {
  return apiGet<{
    daily_installs: Array<{ day: string; cnt: number }>;
    top_packages: Array<{ dd_id: string; name: string | null; cnt: number }>;
    package_breakdown: Array<{ day: string; dd_id: string; version: string; cnt: number }>;
  }>("/registry/admin/analytics");
}

export async function listVersions(ddId: string) {
  const session = getSession();
  if (!session) throw new Error("Not authenticated");
  const url = session.url.replace(/\/$/, "") + `/registry/item/${encodeURIComponent(ddId)}/versions`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${session.token}` } });
  const data = await res.json() as {
    versions: Array<{
      version: string; trust: string; maturity: string; status: string;
      published_at: string; is_latest: number;
      zip_sha256: string | null; zip_size_bytes: number | null;
      reviewed_by: string | null; reviewed_at: string | null;
    }>;
  };
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data;
}

/** Fetch full manifest for a package — reads description/domain/tags from manifest_json fallback */
export async function getItemManifest(ddId: string) {
  const session = getSession();
  if (!session) throw new Error("Not authenticated");
  const url = session.url.replace(/\/$/, "") + `/registry/item/${encodeURIComponent(ddId)}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${session.token}` } });
  if (!res.ok) return null;
  const row = await res.json() as Record<string, unknown>;
  // manifest_json column may contain richer metadata than the identity columns
  let extra: Record<string, unknown> = {};
  if (typeof row.manifest_json === "string") {
    try { extra = JSON.parse(row.manifest_json); } catch { /* ignore */ }
  }
  return {
    description: (row.description as string | null) || (extra.description as string | null) || "",
    domain: (row.domain as string | null) || (extra.domain as string | null) || "",
    tags: (row.tags as string | null) || (
      Array.isArray(extra.tags) ? JSON.stringify(extra.tags) : (extra.tags as string | null) ?? ""
    ),
  };
}

export async function batchApprove(items: Array<{ dd_id: string; version: string }>, trust = "reviewed", note?: string) {
  return apiPost<{ ok: boolean; approved: number }>("/registry/admin/batch-approve", {
    items, trust, note,
  });
}

/** Mark every published-but-untrusted skill/package as 'reviewed' in one shot. */
export async function trustAllPublished(trust: "reviewed" | "org-approved" = "reviewed") {
  return apiPost<{ ok: boolean; updated: number }>("/registry/admin/trust-all-published", { trust });
}

export async function downloadPackageZip(ddId: string, version: string): Promise<ArrayBuffer> {
  const session = getSession();
  if (!session) throw new Error("Not authenticated");
  const url = session.url.replace(/\/$/, "") + `/registry/item/${encodeURIComponent(ddId)}/download?version=${encodeURIComponent(version)}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${session.token}` } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json() as any; msg = d.error ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.arrayBuffer();
}

export async function listTokens() {
  return apiGet<{
    tokens: Array<{
      token_hash: string; actor_id: string; role: string;
      created_at: string; expires_at: string | null; note: string | null;
    }>;
  }>("/registry/admin/tokens");
}

export async function addToken(rawToken: string, actorId: string, role: string, expiresAt?: string, note?: string) {
  return apiPost<{ ok: boolean; actor_id: string; role: string; hash_prefix: string }>("/registry/admin/token", {
    raw_token: rawToken, actor_id: actorId, role, expires_at: expiresAt, note,
  });
}

// ─── User management ───────────────────────────────────────────────────────────

export interface UserListItem {
  id: string;
  email: string;
  username: string | null;
  created_at: string;
  last_seen_at: string | null;
  is_active: number;
  token_prefix: string;
  packages_published: number;
  installs_made: number;
  org_count: number;
}

export async function listUsers(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return apiGet<{ users: UserListItem[] }>(`/registry/admin/users${qs}`);
}

export async function getUserDetail(userId: string) {
  return apiGet<{
    user: {
      id: string; email: string; username: string | null;
      created_at: string; last_seen_at: string | null;
      is_active: number; token_prefix: string;
    };
    packages: Array<{
      id: string; name: string; type: string; visibility: string;
      pkg_status: string; version: string; published_at: string;
    }>;
    orgs: Array<{ id: string; display_name: string; role: string; joined_at: string }>;
    installs_count: number;
    api_keys_synced: boolean;
    api_keys_updated_at: string | null;
  }>(`/registry/admin/users/${encodeURIComponent(userId)}`);
}

export async function suspendUser(userId: string, suspend: boolean) {
  return apiPost<{ ok: boolean; is_active: boolean }>(
    `/registry/admin/users/${encodeURIComponent(userId)}/suspend`,
    { suspend }
  );
}

// ─── Release management ────────────────────────────────────────────────────────

export interface ReleaseAsset {
  id?: string;
  platform: string;
  filename: string;
  size_bytes: number | null;
  sha256: string | null;
  r2_key?: string | null;
  download_url?: string | null;
}

export interface Release {
  id: string;
  version: string;
  channel: string;
  release_notes: string | null;
  published_at: string;
  is_latest: boolean;
  status: string;  // 'active' | 'revoked'
  assets: ReleaseAsset[];
}

export async function listReleases() {
  return apiGet<{ releases: Release[] }>("/releases/all");
}

export type UploadReleaseResult = { success: boolean; asset_id: string; r2_key: string | null; sha256: string | null; size_bytes: number | null; download_url: string | null };

/** Compute SHA-256 (hex) and SHA-512 (base64) for a file using the Web Crypto API. */
async function computeHashes(file: File): Promise<{ sha256: string; sha512: string }> {
  const buf = await file.arrayBuffer();
  const [h256, h512] = await Promise.all([
    crypto.subtle.digest("SHA-256", buf),
    crypto.subtle.digest("SHA-512", buf),
  ]);
  const sha256 = Array.from(new Uint8Array(h256)).map(b => b.toString(16).padStart(2, "0")).join("");
  const sha512 = btoa(String.fromCharCode(...new Uint8Array(h512)));
  return { sha256, sha512 };
}

/**
 * Two-step streaming upload (avoids Cloudflare 100 MB multipart-body limit):
 *   1. POST /releases/upload-init — send JSON metadata + pre-computed hashes → get upload_id
 *   2. PUT  /releases/upload-stream/{id} — stream raw binary to R2
 *
 * onProgress phases:
 *   phase="hashing"   — computing SHA hashes (loaded = bytes hashed, total = file.size)
 *   phase="uploading" — streaming to R2    (loaded = bytes sent,   total = file.size)
 */
export function uploadReleaseWithProgress(
  file: File | null,
  meta: { version: string; platform: string; channel: string; release_notes: string; download_url?: string },
  onProgress: (p: UploadProgress & { phase?: string }) => void,
): Promise<UploadReleaseResult> {
  return (async () => {
    const session = getSession();
    if (!session) throw new Error("Not authenticated");
    const base = session.url.replace(/\/$/, "");

    // ── External URL path (no file to upload) ──────────────────────────────────
    if (!file) {
      if (!meta.download_url?.trim()) throw new Error("File or download URL required");
      const res = await fetch(base + "/releases/upload-init", {
        method: "POST",
        headers: { "Authorization": `Bearer ${session.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          version: meta.version, platform: meta.platform, channel: meta.channel,
          release_notes: meta.release_notes, download_url: meta.download_url,
          // hashes not required for external URL
          sha256: "", sha512: "", size_bytes: 0, filename: "",
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onProgress({ loaded: 1, total: 1, speedBps: 0, phase: "done" });
      return { success: true, asset_id: data.asset_id, r2_key: null, sha256: null, size_bytes: null, download_url: meta.download_url ?? null };
    }

    // ── Step 1: compute hashes (client-side) ───────────────────────────────────
    onProgress({ loaded: 0, total: file.size, speedBps: 0, phase: "hashing" });
    const { sha256, sha512 } = await computeHashes(file);
    onProgress({ loaded: file.size, total: file.size, speedBps: 0, phase: "hashing" });

    // ── Step 2: register metadata → get upload_id ──────────────────────────────
    const initRes = await fetch(base + "/releases/upload-init", {
      method: "POST",
      headers: { "Authorization": `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: meta.version, platform: meta.platform, channel: meta.channel,
        release_notes: meta.release_notes,
        sha256, sha512, size_bytes: file.size, filename: file.name,
      }),
    });
    const initData = await initRes.json() as { upload_id: string; file_upload_needed: boolean; error?: string };
    if (!initRes.ok) throw new Error(initData?.error ?? `HTTP ${initRes.status}`);

    if (!initData.file_upload_needed) {
      onProgress({ loaded: file.size, total: file.size, speedBps: 0, phase: "done" });
      return { success: true, asset_id: initData.upload_id, r2_key: null, sha256, size_bytes: file.size, download_url: null };
    }

    // ── Step 3: stream binary directly to R2 (with XHR for progress) ───────────
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${base}/releases/upload-stream/${initData.upload_id}`);
      xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      let lastLoaded = 0;
      let lastTime = Date.now();

      xhr.upload.onprogress = (e) => {
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        const delta = e.loaded - lastLoaded;
        const speedBps = elapsed > 0.05 ? delta / elapsed : 0;
        lastLoaded = e.loaded;
        lastTime = now;
        onProgress({ loaded: e.loaded, total: e.total || file.size, speedBps, phase: "uploading" });
      };

      xhr.onload = () => {
        let data: any;
        try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true, asset_id: data.asset_id, r2_key: null, sha256, size_bytes: file.size, download_url: null });
        } else {
          reject(new Error(data?.error ?? `HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error(
        "Network error during upload. If the file is very large (>500 MB), use the Download URL field instead."
      ));
      xhr.send(file);
    });
  })();
}

export async function promoteRelease(version: string) {
  return apiPost<{ success: boolean; latest: string; channel: string }>("/releases/promote", { version });
}

export async function revokeRelease(version: string) {
  return apiPost<{ success: boolean; version: string; status: string }>("/releases/revoke", { version });
}

export async function restoreRelease(version: string) {
  return apiPost<{ success: boolean; version: string; status: string }>("/releases/restore", { version });
}

export async function deleteRelease(version: string, deleteFiles = false) {
  return apiPost<{ success: boolean; version: string; files_deleted: number }>("/releases/delete", { version, delete_files: deleteFiles });
}

export async function deleteReleaseAsset(version: string, platform: string, deleteFile = false) {
  return apiPost<{ success: boolean; version: string; platform: string; file_deleted: boolean }>("/releases/delete-asset", { version, platform, delete_file: deleteFile });
}

export async function listOrgs() {
  return apiGet<{
    orgs: Array<{
      id: string; display_name: string; created_by: string; created_at: string;
      is_active: number; member_count: number; package_count: number;
    }>;
  }>("/registry/admin/orgs");
}
