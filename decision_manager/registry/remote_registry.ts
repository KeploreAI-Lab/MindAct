/**
 * remote_registry.ts — Cloudflare Workers API client stub.
 *
 * Connects to a registry_url configured in ~/.physmind/config.json.
 * When registry_url is absent, the system falls back to local-only mode.
 */

import type { DecisionDependency } from "../types.ts";
import type { DecisionDependencyRegistry, RegistryFilter } from "./types.ts";

export class RemoteRegistry implements DecisionDependencyRegistry {
  constructor(
    private baseUrl: string,
    private token?: string,
    private userToken?: string,   // mact_xxx — sent as X-User-Token for user-scoped visibility
  ) {}

  async list(filter?: RegistryFilter): Promise<DecisionDependency[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set("type", filter.type);
    if (filter?.domain) params.set("domain", filter.domain);
    if (filter?.visibility) params.set("visibility", filter.visibility);
    if (filter?.trust) params.set("trust", filter.trust);
    if (filter?.query) params.set("query", filter.query);
    if (filter?.tags?.length) params.set("tags", filter.tags.join(","));

    const res = await this._fetch(`/registry/list?${params}`);
    if (!res.ok) throw new Error(`RemoteRegistry.list failed: ${res.status}`);
    const json = await res.json() as { items: DecisionDependency[] };
    return json.items ?? [];
  }

  async get(id: string, version?: string): Promise<DecisionDependency | null> {
    const params = version ? `?version=${encodeURIComponent(version)}` : "";
    const res = await this._fetch(`/registry/item/${encodeURIComponent(id)}${params}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RemoteRegistry.get failed: ${res.status}`);
    return res.json() as Promise<DecisionDependency>;
  }

  async getContent(dd: DecisionDependency): Promise<string> {
    const params = dd.version ? `?version=${encodeURIComponent(dd.version)}` : "";
    const res = await this._fetch(`/registry/item/${encodeURIComponent(dd.id)}/content${params}`);
    if (!res.ok) throw new Error(`RemoteRegistry.getContent failed: ${res.status}`);
    return res.text();
  }

  async install(id: string, version?: string): Promise<DecisionDependency> {
    const res = await this._fetch("/registry/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, version }),
    });
    if (!res.ok) throw new Error(`RemoteRegistry.install failed: ${res.status}`);
    return res.json() as Promise<DecisionDependency>;
  }

  async publish(dd: DecisionDependency): Promise<void> {
    const res = await this._fetch("/registry/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dd),
    });
    if (!res.ok) throw new Error(`RemoteRegistry.publish failed: ${res.status}`);
  }

  /**
   * Download the full package zip for a DD version.
   * Returns the zip bytes and the sha256 checksum from the response header.
   */
  async downloadPackage(id: string, version?: string): Promise<{ bytes: ArrayBuffer; sha256: string | null; sizeBytes: number }> {
    const params = version ? `?version=${encodeURIComponent(version)}` : "";
    const res = await this._fetch(`/registry/item/${encodeURIComponent(id)}/download${params}`);
    if (res.status === 404) throw new Error(`Package zip not available for ${id}`);
    if (!res.ok) throw new Error(`RemoteRegistry.downloadPackage failed: ${res.status}`);
    const bytes = await res.arrayBuffer();
    const sha256 = res.headers.get("X-Zip-SHA256");
    return { bytes, sha256, sizeBytes: bytes.byteLength };
  }

  /**
   * Upload a complete package zip (admin/publisher use only).
   */
  async uploadPackage(ddId: string, version: string, zipBytes: ArrayBuffer, skillmdText?: string): Promise<{ zip_sha256: string }> {
    const formData = new FormData();
    formData.append("dd_id", ddId);
    formData.append("version", version);
    formData.append("package", new Blob([zipBytes], { type: "application/zip" }), `${ddId}_v${version}.zip`);
    if (skillmdText) {
      formData.append("skillmd", new Blob([skillmdText], { type: "text/markdown" }), "SKILL.md");
    }
    const res = await this._fetch("/registry/upload-package", { method: "POST", body: formData });
    if (!res.ok) throw new Error(`RemoteRegistry.uploadPackage failed: ${res.status}`);
    const data = await res.json() as { zip_sha256: string };
    return data;
  }

  private _fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (this.userToken) headers["X-User-Token"] = this.userToken;
    return fetch(url, { ...init, headers });
  }
}
