import React, { useState, useEffect } from "react";

interface AuthPageProps {
  registryUrl: string;
}

type Tab = "register" | "retrieve";

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0d0d14",
    padding: 24,
  } as React.CSSProperties,
  card: {
    background: "#111118",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    padding: "32px 36px",
    width: 420,
    maxWidth: "100%",
  } as React.CSSProperties,
  logo: {
    textAlign: "center" as const,
    marginBottom: 24,
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid #222",
    marginBottom: 24,
    gap: 0,
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "9px 0",
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? "#4ec9b0" : "transparent"}`,
    color: active ? "#4ec9b0" : "#555",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 400,
    transition: "all 0.1s",
  }),
  label: {
    fontSize: 10,
    color: "#555",
    display: "block",
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  input: {
    width: "100%",
    background: "#1a1a24",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#d4d4d4",
    padding: "8px 10px",
    fontSize: 12,
    outline: "none",
    boxSizing: "border-box" as const,
  },
  btn: (variant: "primary" | "secondary" = "primary"): React.CSSProperties => ({
    width: "100%",
    background: variant === "primary" ? "#0a2a20" : "#1a1a2a",
    border: `1px solid ${variant === "primary" ? "#4ec9b088" : "#333"}`,
    borderRadius: 4,
    color: variant === "primary" ? "#4ec9b0" : "#888",
    cursor: "pointer",
    fontSize: 12,
    padding: "9px 0",
    fontWeight: 700,
  }),
  error: {
    padding: "7px 12px",
    background: "#2a0808",
    border: "1px solid #e0555544",
    borderRadius: 4,
    fontSize: 11,
    color: "#e05555",
    marginBottom: 14,
  } as React.CSSProperties,
  success: {
    padding: "7px 12px",
    background: "#082a1a",
    border: "1px solid #4ec9b044",
    borderRadius: 4,
    fontSize: 11,
    color: "#4ec9b0",
    marginBottom: 14,
  } as React.CSSProperties,
  tokenBox: {
    background: "#0d0d14",
    border: "1px solid #4ec9b044",
    borderRadius: 6,
    padding: "14px 16px",
    marginBottom: 16,
    textAlign: "center" as const,
  },
  tokenText: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#4ec9b0",
    wordBreak: "break-all" as const,
    letterSpacing: "0.05em",
  },
  fieldRow: { marginBottom: 14 } as React.CSSProperties,
};

// ─── Register tab ─────────────────────────────────────────────────────────────

function RegisterTab({ registryUrl, redirectUrl }: { registryUrl: string; redirectUrl: string | null }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  const handleRegister = async () => {
    if (!email.trim()) { setError("Email is required"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${registryUrl.replace(/\/$/, "")}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), username: username.trim() || undefined }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setToken(data.token!);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReturn = () => {
    if (redirectUrl) {
      window.location.href = `${redirectUrl}?token=${encodeURIComponent(token)}`;
    }
  };

  if (token) {
    return (
      <div>
        <div style={{ fontSize: 11, color: "#4ec9b0", textAlign: "center", marginBottom: 12 }}>
          Account created! Save your token — it will not be shown again.
        </div>
        <div style={s.tokenBox}>
          <div style={{ fontSize: 9, color: "#444", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Your Account Token
          </div>
          <div style={s.tokenText}>{token}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={handleCopy} style={{ ...s.btn("primary"), flex: 1 }}>
            {copied ? "✓ Copied!" : "Copy Token"}
          </button>
          {redirectUrl && (
            <button onClick={handleReturn} style={{ ...s.btn("secondary"), flex: 1 }}>
              Return to MindAct →
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#444", textAlign: "center" }}>
          Store this token in a safe place. You can retrieve a new one at any time via email verification.
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div style={s.error}>{error}</div>}
      <div style={s.fieldRow}>
        <label style={s.label}>Email address</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleRegister()}
          placeholder="you@example.com"
          style={s.input}
        />
      </div>
      <div style={s.fieldRow}>
        <label style={s.label}>Username (optional)</label>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="your-handle"
          style={s.input}
        />
      </div>
      <button
        onClick={handleRegister}
        disabled={loading}
        style={{ ...s.btn("primary"), opacity: loading ? 0.7 : 1, cursor: loading ? "default" : "pointer" }}
      >
        {loading ? "Creating account…" : "Create Account & Get Token"}
      </button>
      <div style={{ marginTop: 12, fontSize: 10, color: "#444", textAlign: "center" }}>
        By registering you agree to use this service responsibly.
      </div>
    </div>
  );
}

// ─── Retrieve Token tab ───────────────────────────────────────────────────────

function RetrieveTab({ registryUrl, redirectUrl }: { registryUrl: string; redirectUrl: string | null }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"email" | "otp" | "done">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSendOtp = async () => {
    if (!email.trim()) { setError("Email is required"); return; }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch(`${registryUrl.replace(/\/$/, "")}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInfo(data.message ?? "Check your email for a 6-digit code.");
      setStage("otp");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!otp.trim()) { setError("Code is required"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${registryUrl.replace(/\/$/, "")}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setToken(data.token!);
      setStage("done");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReturn = () => {
    if (redirectUrl) {
      window.location.href = `${redirectUrl}?token=${encodeURIComponent(token)}`;
    }
  };

  if (stage === "done" && token) {
    return (
      <div>
        <div style={{ fontSize: 11, color: "#4ec9b0", textAlign: "center", marginBottom: 12 }}>
          Identity verified. Here is your new token:
        </div>
        <div style={s.tokenBox}>
          <div style={{ fontSize: 9, color: "#444", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Your Account Token (new)
          </div>
          <div style={s.tokenText}>{token}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleCopy} style={{ ...s.btn("primary"), flex: 1 }}>
            {copied ? "✓ Copied!" : "Copy Token"}
          </button>
          {redirectUrl && (
            <button onClick={handleReturn} style={{ ...s.btn("secondary"), flex: 1 }}>
              Return to MindAct →
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: "#555", textAlign: "center" }}>
          Your previous token has been invalidated.
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div style={s.error}>{error}</div>}
      {info && <div style={s.success}>{info}</div>}

      {stage === "email" && (
        <>
          <div style={s.fieldRow}>
            <label style={s.label}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSendOtp()}
              placeholder="you@example.com"
              style={s.input}
            />
          </div>
          <button
            onClick={handleSendOtp}
            disabled={loading}
            style={{ ...s.btn("primary"), opacity: loading ? 0.7 : 1, cursor: loading ? "default" : "pointer" }}
          >
            {loading ? "Sending code…" : "Send Verification Code"}
          </button>
        </>
      )}

      {stage === "otp" && (
        <>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 14 }}>
            A 6-digit code was sent to <strong style={{ color: "#ccc" }}>{email}</strong>. Enter it below.
          </div>
          <div style={s.fieldRow}>
            <label style={s.label}>Verification Code</label>
            <input
              type="text"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && handleVerify()}
              placeholder="123456"
              maxLength={6}
              style={{ ...s.input, letterSpacing: "0.3em", fontSize: 16, textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => { setStage("email"); setError(""); setInfo(""); setOtp(""); }}
              style={{ ...s.btn("secondary"), flex: "0 0 80px" }}
            >
              ← Back
            </button>
            <button
              onClick={handleVerify}
              disabled={loading || otp.length !== 6}
              style={{ ...s.btn("primary"), flex: 1, opacity: (loading || otp.length !== 6) ? 0.7 : 1, cursor: (loading || otp.length !== 6) ? "default" : "pointer" }}
            >
              {loading ? "Verifying…" : "Verify & Get Token"}
            </button>
          </div>
          <button
            onClick={handleSendOtp}
            disabled={loading}
            style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 10, marginTop: 10, width: "100%", textAlign: "center" }}
          >
            Resend code
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AuthPage({ registryUrl }: AuthPageProps) {
  const [tab, setTab] = useState<Tab>("register");

  // Parse redirect URL and registry override from query string (after #auth)
  // Hash format: #auth?redirect=xxx&registry=xxx
  const hashQuery = window.location.hash.includes("?")
    ? new URLSearchParams(window.location.hash.split("?")[1])
    : new URLSearchParams();

  const redirectUrl = hashQuery.get("redirect");
  const registryOverride = hashQuery.get("registry");
  const effectiveRegistry = registryOverride ?? registryUrl;

  useEffect(() => {
    // If there's a tab param, switch to it
    const tabParam = hashQuery.get("tab") as Tab | null;
    if (tabParam === "retrieve") setTab("retrieve");
  }, []);

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Logo */}
        <div style={s.logo}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🧠</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ccc" }}>MindAct Account</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>
            {effectiveRegistry.replace("https://", "").replace(/\/$/, "")}
          </div>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          <button style={s.tab(tab === "register")} onClick={() => setTab("register")}>
            Register
          </button>
          <button style={s.tab(tab === "retrieve")} onClick={() => setTab("retrieve")}>
            Retrieve Token
          </button>
        </div>

        {/* Content */}
        {tab === "register"
          ? <RegisterTab registryUrl={effectiveRegistry} redirectUrl={redirectUrl} />
          : <RetrieveTab registryUrl={effectiveRegistry} redirectUrl={redirectUrl} />
        }

        {/* Footer */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #1a1a1a", textAlign: "center" }}>
          <a
            href={window.location.origin}
            style={{ fontSize: 10, color: "#333", textDecoration: "none" }}
          >
            ← Back to Admin
          </a>
        </div>
      </div>
    </div>
  );
}
