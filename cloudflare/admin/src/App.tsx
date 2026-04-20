import React, { useState, useEffect } from "react";
import { getSession, saveSession, clearSession, DEFAULT_REGISTRY_URL, addToken, listTokens } from "./api";
import StatsPage from "./pages/StatsPage";
import PackagesPage from "./pages/PackagesPage";
import PendingPage from "./pages/PendingPage";
import UploadPage from "./pages/UploadPage";
import GovernancePage from "./pages/GovernancePage";
import AuthPage from "./pages/AuthPage";
import UsersPage from "./pages/UsersPage";
import ReleasesPage from "./pages/ReleasesPage";

type Page = "stats" | "packages" | "pending" | "upload" | "releases" | "governance" | "tokens" | "users";

const NAV_ITEMS: Array<{ id: Page; label: string; icon: string }> = [
  { id: "stats",      label: "Stats",          icon: "📊" },
  { id: "pending",    label: "Pending Review",  icon: "⏳" },
  { id: "packages",   label: "Packages",        icon: "📦" },
  { id: "upload",     label: "Upload",          icon: "⬆" },
  { id: "releases",   label: "Releases",        icon: "🚀" },
  { id: "governance", label: "Governance Log",  icon: "📋" },
  { id: "tokens",     label: "Tokens",          icon: "🔑" },
  { id: "users",      label: "Users & Orgs",    icon: "👥" },
];

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [url, setUrl] = useState(DEFAULT_REGISTRY_URL);
  const [err, setErr] = useState("");
  const [testing, setTesting] = useState(false);

  const handleLogin = async () => {
    if (!token.trim()) { setErr("Admin token is required"); return; }
    setTesting(true);
    setErr("");
    try {
      // Verify token works by hitting /registry/admin/stats
      const base = url.replace(/\/$/, "");
      const res = await fetch(`${base}/registry/admin/stats`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      saveSession(token, url);
      onLogin();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d0d14",
    }}>
      <div style={{
        background: "#111118", border: "1px solid #2a2a2a", borderRadius: 10,
        padding: "32px 36px", width: 380,
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🛡</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ccc" }}>MindAct Registry Admin</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Administrator access only</div>
        </div>

        {err && (
          <div style={{ padding: "7px 12px", background: "#2a0808", border: "1px solid #e0555544", borderRadius: 4, fontSize: 11, color: "#e05555", marginBottom: 14 }}>
            {err}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>Registry URL</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            style={{ width: "100%", background: "#1a1a24", border: "1px solid #333", borderRadius: 4, color: "#d4d4d4", padding: "8px 10px", fontSize: 12, outline: "none" }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4 }}>Admin Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            placeholder="Your admin token…"
            style={{ width: "100%", background: "#1a1a24", border: "1px solid #333", borderRadius: 4, color: "#d4d4d4", padding: "8px 10px", fontSize: 12, outline: "none" }}
          />
        </div>

        <button
          onClick={handleLogin}
          disabled={testing}
          style={{
            width: "100%", background: "#0a2a20", border: "1px solid #4ec9b088", borderRadius: 4,
            color: "#4ec9b0", cursor: testing ? "default" : "pointer",
            fontSize: 12, padding: "9px 0", fontWeight: 700,
            opacity: testing ? 0.7 : 1,
          }}
        >
          {testing ? "Verifying…" : "Sign In"}
        </button>
      </div>
    </div>
  );
}

// ─── Tokens page ──────────────────────────────────────────────────────────────

type TokenRow = { token_hash: string; actor_id: string; role: string; created_at: string; expires_at: string | null; note: string | null };

function TokensPage() {
  const [rawToken, setRawToken] = useState("");
  const [actorId, setActorId] = useState("");
  const [role, setRole] = useState("publisher");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [err, setErr] = useState("");
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

  const loadTokens = () => {
    setLoadingTokens(true);
    listTokens()
      .then(d => setTokens(d.tokens))
      .catch(() => {})
      .finally(() => setLoadingTokens(false));
  };
  useEffect(loadTokens, []);

  const handleAdd = async () => {
    setErr(""); setResult("");
    try {
      const res = await addToken(rawToken, actorId, role, expiresAt || undefined, note || undefined);
      setResult(`✓ Token registered — actor: ${res.actor_id}, role: ${res.role}, prefix: ${res.hash_prefix}`);
      setRawToken(""); setActorId(""); setNote("");
      loadTokens();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const roleColor = (r: string) => r === "admin" ? "#e05555" : r === "publisher" ? "#4ec9b0" : "#888";

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#ccc", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 16 }}>
        Access Tokens
      </div>

      {/* Token list */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Registered tokens ({tokens.length})
        </div>
        {loadingTokens ? (
          <div style={{ color: "#444", fontSize: 11 }}>Loading…</div>
        ) : tokens.length === 0 ? (
          <div style={{ color: "#444", fontSize: 11 }}>No tokens registered yet.</div>
        ) : (
          <div style={{ background: "#111118", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
            {tokens.map((t, i) => (
              <div key={t.token_hash} style={{
                padding: "8px 14px", display: "flex", alignItems: "center", gap: 10,
                borderBottom: i < tokens.length - 1 ? "1px solid #1a1a1a" : undefined,
              }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "#444", width: 76 }}>{t.token_hash}</span>
                <span style={{ flex: 1, color: "#ccc", fontSize: 11 }}>{t.actor_id}</span>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: `1px solid ${roleColor(t.role)}55`, color: roleColor(t.role) }}>{t.role}</span>
                <span style={{ fontSize: 9, color: "#444" }}>{new Date(t.created_at).toLocaleDateString()}</span>
                {t.expires_at && <span style={{ fontSize: 9, color: "#c8a45a" }}>exp {new Date(t.expires_at).toLocaleDateString()}</span>}
                {t.note && <span style={{ fontSize: 9, color: "#555", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add token form */}
      <div style={{ fontSize: 10, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Add Token
      </div>
      {err && <div style={{ color: "#e05555", fontSize: 11, marginBottom: 12 }}>{err}</div>}
      {result && <div style={{ color: "#4ec9b0", fontSize: 11, marginBottom: 12 }}>{result}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#111118", border: "1px solid #222", borderRadius: 6, padding: 16 }}>
        {[
          { key: "rawToken", label: "Raw Token (min 32 chars)", value: rawToken, set: setRawToken, type: "password" as const },
          { key: "actorId", label: "Actor ID / Email", value: actorId, set: setActorId },
          { key: "note", label: "Note (optional)", value: note, set: setNote },
          { key: "expiresAt", label: "Expires At (ISO8601, optional)", value: expiresAt, set: setExpiresAt },
        ].map(f => (
          <div key={f.key}>
            <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 3 }}>{f.label}</label>
            <input
              type={f.type ?? "text"}
              value={f.value}
              onChange={e => f.set(e.target.value)}
              style={{ width: "100%", background: "#1a1a24", border: "1px solid #333", borderRadius: 4, color: "#d4d4d4", padding: "6px 8px", fontSize: 11, outline: "none" }}
            />
          </div>
        ))}
        <div>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 3 }}>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            style={{ background: "#1a1a24", border: "1px solid #333", borderRadius: 4, color: "#d4d4d4", padding: "6px 8px", fontSize: 11 }}>
            <option value="publisher">publisher</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div style={{ fontSize: 9, color: "#444", background: "#0d0d14", borderRadius: 4, padding: "8px 10px" }}>
          <strong style={{ color: "#555" }}>publisher</strong>: can submit packages (status=pending, trust=untrusted, requires admin approval)<br />
          <strong style={{ color: "#e0555588" }}>admin</strong>: can publish directly, approve/reject, manage tokens
        </div>
        <button onClick={handleAdd} style={{
          background: "#0a2a20", border: "1px solid #4ec9b088", borderRadius: 4,
          color: "#4ec9b0", cursor: "pointer", fontSize: 11, padding: "7px 0", fontWeight: 600,
        }}>
          Register Token
        </button>
      </div>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

// Wrapper that routes between the public auth page and the admin shell.
// Must be a separate component so hooks inside AdminShell are always called
// unconditionally (React Rules of Hooks).
export default function App() {
  const isAuthRoute = window.location.hash.startsWith("#auth");
  if (isAuthRoute) {
    return <AuthPage registryUrl={DEFAULT_REGISTRY_URL} />;
  }
  return <AdminShell />;
}

function AdminShell() {
  const [auth, setAuth] = useState(!!getSession());
  const [page, setPage] = useState<Page>("pending");

  useEffect(() => {
    setAuth(!!getSession());
  }, []);

  if (!auth) {
    return <LoginScreen onLogin={() => setAuth(true)} />;
  }

  const session = getSession()!;

  const renderPage = () => {
    switch (page) {
      case "stats":      return <StatsPage />;
      case "packages":   return <PackagesPage />;
      case "pending":    return <PendingPage />;
      case "upload":     return <UploadPage />;
      case "releases":   return <ReleasesPage />;
      case "governance": return <GovernancePage />;
      case "tokens":     return <TokensPage />;
      case "users":      return <UsersPage />;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{
        width: 200, flexShrink: 0, background: "#0a0a10",
        borderRight: "1px solid #1a1a2a", display: "flex", flexDirection: "column",
      }}>
        {/* Logo */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #1a1a2a" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#4ec9b0" }}>🛡 MINDACT ADMIN</div>
          <div style={{ fontSize: 9, color: "#333", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session.url.replace("https://", "")}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "8px 0" }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 16px", background: page === item.id ? "#1a1a2a" : "none",
                border: "none", borderLeft: `2px solid ${page === item.id ? "#4ec9b0" : "transparent"}`,
                color: page === item.id ? "#4ec9b0" : "#555",
                cursor: "pointer", fontSize: 11, textAlign: "left",
                transition: "all 0.1s",
              }}
            >
              <span style={{ fontSize: 12 }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Sign out */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a2a" }}>
          <button
            onClick={() => { clearSession(); setAuth(false); }}
            style={{
              background: "none", border: "none", color: "#444", cursor: "pointer",
              fontSize: 10, padding: 0, display: "flex", alignItems: "center", gap: 4,
            }}
          >
            ← Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: "auto", background: "#0d0d14" }}>
        {renderPage()}
      </div>
    </div>
  );
}
