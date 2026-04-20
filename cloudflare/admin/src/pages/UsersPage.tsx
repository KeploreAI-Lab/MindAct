import React, { useState, useEffect } from "react";
import { listUsers, getUserDetail, suspendUser, listOrgs } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
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

interface UserDetail {
  user: {
    id: string;
    email: string;
    username: string | null;
    created_at: string;
    last_seen_at: string | null;
    is_active: number;
    token_prefix: string;
  };
  packages: Array<{
    id: string;
    name: string;
    type: string;
    visibility: string;
    pkg_status: string;
    version: string;
    published_at: string;
  }>;
  orgs: Array<{
    id: string;
    display_name: string;
    role: string;
    joined_at: string;
  }>;
  installs_count: number;
  api_keys_synced: boolean;
  api_keys_updated_at: string | null;
  api_keys_provider_list: string[];
}

interface OrgRow {
  id: string;
  display_name: string;
  created_by: string;
  created_at: string;
  is_active: number;
  member_count: number;
  package_count: number;
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

const cell: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 11,
  borderBottom: "1px solid #1a1a1a",
  color: "#ccc",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 200,
};

const th: React.CSSProperties = {
  ...cell,
  color: "#555",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  background: "#0d0d14",
  fontWeight: 600,
};

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 6px", borderRadius: 3,
      border: `1px solid ${color}55`, color,
      display: "inline-block",
    }}>
      {text}
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── User Detail Panel ────────────────────────────────────────────────────────

function UserDetailPanel({ userId, onClose, onSuspendChange }: {
  userId: string;
  onClose: () => void;
  onSuspendChange: (userId: string, isActive: boolean) => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [suspending, setSuspending] = useState(false);

  useEffect(() => {
    setLoading(true);
    getUserDetail(userId)
      .then(d => setDetail(d as UserDetail))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSuspend = async (suspend: boolean) => {
    if (!detail) return;
    setSuspending(true);
    try {
      await suspendUser(userId, suspend);
      setDetail(d => d ? { ...d, user: { ...d.user, is_active: suspend ? 0 : 1 } } : d);
      onSuspendChange(userId, !suspend);
    } catch {}
    setSuspending(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }} onClick={onClose}>
      <div style={{
        background: "#111118", border: "1px solid #2a2a2a", borderRadius: 10,
        padding: 28, width: 560, maxWidth: "90vw", maxHeight: "80vh",
        overflow: "auto",
      }} onClick={e => e.stopPropagation()}>
        {loading ? (
          <div style={{ color: "#444", fontSize: 12, textAlign: "center", padding: 32 }}>Loading…</div>
        ) : !detail ? (
          <div style={{ color: "#e05555", fontSize: 12 }}>Failed to load user details.</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#ccc" }}>
                  {detail.user.email}
                </div>
                {detail.user.username && (
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>@{detail.user.username}</div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Badge
                    text={detail.user.is_active ? "Active" : "Suspended"}
                    color={detail.user.is_active ? "#4ec9b0" : "#e05555"}
                  />
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: "#444", padding: "2px 0" }}>
                    {detail.user.token_prefix}…
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleSuspend(!!detail.user.is_active)}
                disabled={suspending}
                style={{
                  background: detail.user.is_active ? "#2a0808" : "#0a2a1a",
                  border: `1px solid ${detail.user.is_active ? "#e0555544" : "#4ec9b044"}`,
                  borderRadius: 4, color: detail.user.is_active ? "#e05555" : "#4ec9b0",
                  cursor: suspending ? "default" : "pointer", fontSize: 10,
                  padding: "5px 12px", fontWeight: 600,
                }}
              >
                {suspending ? "…" : detail.user.is_active ? "Suspend" : "Reactivate"}
              </button>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                { label: "Packages", value: detail.packages.length },
                { label: "Installs", value: detail.installs_count },
                { label: "Orgs", value: detail.orgs.length },
                { label: "Joined", value: relativeTime(detail.user.created_at) },
                { label: "Last seen", value: relativeTime(detail.user.last_seen_at) },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, minWidth: 70, background: "#0d0d14", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#ccc" }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
              {/* API key sync status — encrypted blob NOT exposed to admin; only provider names shown */}
              <div style={{ flex: 2, minWidth: 120, background: "#0d0d14", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: detail.api_keys_synced ? "#4ec9b0" : "#555" }}>
                    {detail.api_keys_synced ? `${detail.api_keys_provider_list.length} Provider${detail.api_keys_provider_list.length !== 1 ? "s" : ""}` : "None"}
                  </div>
                  <div style={{ fontSize: 9, color: "#444" }}>API Keys</div>
                </div>
                {detail.api_keys_provider_list.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {detail.api_keys_provider_list.map(p => (
                      <Badge key={p} text={p} color="#7dd3fc" />
                    ))}
                  </div>
                )}
                {detail.api_keys_synced && detail.api_keys_updated_at && (
                  <div style={{ fontSize: 8, color: "#333", marginTop: 4 }}>
                    {relativeTime(detail.api_keys_updated_at)}
                  </div>
                )}
              </div>
            </div>

            {/* Packages */}
            {detail.packages.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Published Packages ({detail.packages.length})
                </div>
                <div style={{ background: "#0d0d14", borderRadius: 6, border: "1px solid #1a1a1a", overflow: "hidden" }}>
                  {detail.packages.map((pkg, i) => (
                    <div key={pkg.id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 12px",
                      borderBottom: i < detail.packages.length - 1 ? "1px solid #1a1a1a" : undefined,
                    }}>
                      <span style={{ flex: 1, fontSize: 11, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {pkg.name}
                        <span style={{ marginLeft: 6, fontSize: 9, color: "#444" }}>{pkg.id}</span>
                      </span>
                      <Badge text={pkg.type} color="#888" />
                      <Badge text={pkg.visibility} color={pkg.visibility === "public" ? "#4ec9b0" : pkg.visibility === "org" ? "#c8a45a" : "#888"} />
                      <Badge text={pkg.pkg_status} color={pkg.pkg_status === "published" ? "#4ec9b0" : pkg.pkg_status === "pending" ? "#c8a45a" : "#e05555"} />
                      <span style={{ fontSize: 9, color: "#444" }}>v{pkg.version}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Orgs */}
            {detail.orgs.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Organizations
                </div>
                <div style={{ background: "#0d0d14", borderRadius: 6, border: "1px solid #1a1a1a", overflow: "hidden" }}>
                  {detail.orgs.map((org, i) => (
                    <div key={org.id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 12px",
                      borderBottom: i < detail.orgs.length - 1 ? "1px solid #1a1a1a" : undefined,
                    }}>
                      <span style={{ flex: 1, fontSize: 11, color: "#ccc" }}>{org.display_name}</span>
                      <span style={{ fontSize: 9, color: "#444" }}>{org.id}</span>
                      <Badge text={org.role} color={org.role === "admin" ? "#e05555" : "#888"} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 20, background: "none", border: "1px solid #222", borderRadius: 4,
            color: "#555", cursor: "pointer", fontSize: 10, padding: "6px 16px",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Users Table ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = (s?: string) => {
    setLoading(true);
    listUsers(s)
      .then(d => setUsers((d as any).users ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load(search || undefined);
  };

  const handleSuspendChange = (userId: string, isActive: boolean) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: isActive ? 1 : 0 } : u));
  };

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email or username…"
          style={{
            flex: 1, background: "#1a1a24", border: "1px solid #333", borderRadius: 4,
            color: "#d4d4d4", padding: "7px 10px", fontSize: 11, outline: "none",
          }}
        />
        <button type="submit" style={{
          background: "#1a1a2a", border: "1px solid #333", borderRadius: 4,
          color: "#888", cursor: "pointer", fontSize: 11, padding: "7px 14px",
        }}>
          Search
        </button>
        {search && (
          <button type="button" onClick={() => { setSearch(""); load(); }} style={{
            background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 11,
          }}>
            Clear
          </button>
        )}
      </form>

      {/* Table */}
      {loading ? (
        <div style={{ color: "#444", fontSize: 12, padding: 20 }}>Loading users…</div>
      ) : users.length === 0 ? (
        <div style={{ color: "#444", fontSize: 12, padding: 20 }}>No users found.</div>
      ) : (
        <div style={{ background: "#111118", border: "1px solid #1a1a1a", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Email</th>
                <th style={th}>Username</th>
                <th style={th}>Status</th>
                <th style={th}>Packages</th>
                <th style={th}>Installs</th>
                <th style={th}>Orgs</th>
                <th style={th}>Joined</th>
                <th style={th}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#161620")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                >
                  <td style={cell}>
                    <span title={u.email}>
                      {u.email.replace(/^(.{3}).*(@.*)$/, "$1…$2")}
                    </span>
                  </td>
                  <td style={cell}>{u.username ?? <span style={{ color: "#333" }}>—</span>}</td>
                  <td style={cell}>
                    <Badge text={u.is_active ? "Active" : "Suspended"} color={u.is_active ? "#4ec9b0" : "#e05555"} />
                  </td>
                  <td style={{ ...cell, textAlign: "center" }}>{u.packages_published}</td>
                  <td style={{ ...cell, textAlign: "center" }}>{u.installs_made}</td>
                  <td style={{ ...cell, textAlign: "center" }}>{u.org_count}</td>
                  <td style={cell}>{relativeTime(u.created_at)}</td>
                  <td style={cell}>{relativeTime(u.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 12px", fontSize: 10, color: "#333" }}>
            {users.length} user{users.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          onSuspendChange={handleSuspendChange}
        />
      )}
    </div>
  );
}

// ─── Orgs Table ───────────────────────────────────────────────────────────────

function OrgsTab() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listOrgs()
      .then(d => setOrgs((d as any).orgs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {loading ? (
        <div style={{ color: "#444", fontSize: 12, padding: 20 }}>Loading organizations…</div>
      ) : orgs.length === 0 ? (
        <div style={{ color: "#444", fontSize: 12, padding: 20 }}>No organizations yet.</div>
      ) : (
        <div style={{ background: "#111118", border: "1px solid #1a1a1a", borderRadius: 6, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>Display Name</th>
                <th style={th}>Status</th>
                <th style={th}>Members</th>
                <th style={th}>Packages</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o, i) => (
                <tr key={o.id} style={{ background: i % 2 === 0 ? "transparent" : "#0a0a12" }}>
                  <td style={{ ...cell, fontFamily: "monospace", fontSize: 10, color: "#888" }}>{o.id}</td>
                  <td style={cell}>{o.display_name}</td>
                  <td style={cell}>
                    <Badge text={o.is_active ? "Active" : "Inactive"} color={o.is_active ? "#4ec9b0" : "#e05555"} />
                  </td>
                  <td style={{ ...cell, textAlign: "center" }}>{o.member_count}</td>
                  <td style={{ ...cell, textAlign: "center" }}>{o.package_count}</td>
                  <td style={cell}>{relativeTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 12px", fontSize: 10, color: "#333" }}>
            {orgs.length} organization{orgs.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [tab, setTab] = useState<"users" | "orgs">("users");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    background: active ? "#1a1a2a" : "none",
    border: "none",
    borderBottom: `2px solid ${active ? "#4ec9b0" : "transparent"}`,
    color: active ? "#4ec9b0" : "#555",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 16 }}>
        Users & Organizations
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #222", marginBottom: 20, gap: 0 }}>
        <button style={tabStyle(tab === "users")} onClick={() => setTab("users")}>
          Users
        </button>
        <button style={tabStyle(tab === "orgs")} onClick={() => setTab("orgs")}>
          Organizations
        </button>
      </div>

      {tab === "users" ? <UsersTab /> : <OrgsTab />}
    </div>
  );
}
