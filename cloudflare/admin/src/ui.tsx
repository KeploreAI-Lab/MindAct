import React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "14px 16px" }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <div style={{
      fontSize: small ? 10 : 12, fontWeight: 700, color: small ? "#666" : "#ccc",
      textTransform: "uppercase", letterSpacing: 0.8,
      marginBottom: small ? 0 : 4,
    }}>
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div style={{ color: "#555", padding: 32, textAlign: "center", fontSize: 11 }}>
      Loading…
    </div>
  );
}

export function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: "4px 10px", borderRadius: 4, background: "#2a2a2a",
      display: "inline-flex", gap: 6, alignItems: "center",
    }}>
      <span style={{ fontSize: 10, color: "#888" }}>{label}</span>
      <span style={{ fontSize: 10, color: "#ccc", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  published: "#4ec9b0", pending: "#c8a45a", deprecated: "#888", yanked: "#e05555",
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#555";
  return (
    <span style={{ fontSize: 9, color, border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 6px" }}>
      {status}
    </span>
  );
}

const TRUST_COLORS: Record<string, string> = {
  "org-approved": "#4ec9b0", "reviewed": "#7dd3fc", "untrusted": "#c8a45a",
};

export function TrustBadge({ trust }: { trust: string }) {
  const color = TRUST_COLORS[trust] ?? "#555";
  return (
    <span style={{ fontSize: 9, color, border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 6px" }}>
      {trust}
    </span>
  );
}

type BtnVariant = "primary" | "ghost" | "success" | "danger" | "warn";
type BtnSize = "xs" | "sm" | "md";

const BTN_STYLES: Record<BtnVariant, { bg: string; border: string; color: string }> = {
  primary: { bg: "#0a2a20", border: "#4ec9b088", color: "#4ec9b0" },
  ghost:   { bg: "transparent", border: "#333", color: "#666" },
  success: { bg: "#0a2a14", border: "#4ec9b088", color: "#4ec9b0" },
  danger:  { bg: "#2a0808", border: "#e0555544", color: "#e05555" },
  warn:    { bg: "#2a1a00", border: "#c8a45a44", color: "#c8a45a" },
};

const BTN_SIZES: Record<BtnSize, { fontSize: number; padding: string }> = {
  xs: { fontSize: 9, padding: "2px 8px" },
  sm: { fontSize: 10, padding: "4px 10px" },
  md: { fontSize: 11, padding: "6px 14px" },
};

export function Btn({
  children, onClick, variant = "primary", size = "md", disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
}) {
  const vs = BTN_STYLES[variant];
  const ss = BTN_SIZES[size];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: vs.bg, border: `1px solid ${vs.border}`, borderRadius: 4,
        color: disabled ? "#444" : vs.color, cursor: disabled ? "default" : "pointer",
        fontSize: ss.fontSize, padding: ss.padding, fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Select({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: "#1a1a24", border: "1px solid #333", borderRadius: 4,
        color: "#d4d4d4", padding: "5px 8px", fontSize: 11,
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
