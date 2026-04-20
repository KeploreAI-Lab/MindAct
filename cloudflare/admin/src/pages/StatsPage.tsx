import React, { useEffect, useState } from "react";
import { getStats, getAnalytics } from "../api";
import { Card, Pill, SectionTitle, Spinner } from "../ui";

type StatsData = Awaited<ReturnType<typeof getStats>>;
type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    getStats().then(setData).catch(e => setErr(e.message));
    getAnalytics().then(setAnalytics).catch(() => {}); // analytics failure is non-fatal
  }, []);

  if (err) return <div style={{ color: "#e05555", padding: 24 }}>Error: {err}</div>;
  if (!data) return <Spinner />;

  const statusColors: Record<string, string> = {
    published: "#4ec9b0", pending: "#c8a45a", deprecated: "#888", yanked: "#e05555",
  };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionTitle>Registry Stats</SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <StatCard label="Total Packages" value={data.total_packages} color="#4ec9b0" />
        <StatCard label="Total Installs" value={data.total_installs} color="#7dd3fc" />
      </div>

      <Card>
        <SectionTitle small>By Status</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {data.by_status.map(s => (
            <div key={s.status} style={{
              padding: "6px 14px", borderRadius: 4,
              border: `1px solid ${statusColors[s.status] ?? "#555"}44`,
              background: `${statusColors[s.status] ?? "#555"}11`,
            }}>
              <span style={{ color: statusColors[s.status] ?? "#888", fontSize: 11, fontWeight: 600 }}>{s.status}</span>
              <span style={{ color: "#888", fontSize: 11, marginLeft: 8 }}>{s.cnt}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle small>Governance Events</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {data.governance.map(g => (
            <Pill key={g.event_type} label={g.event_type} value={String(g.cnt)} />
          ))}
        </div>
      </Card>

      {analytics && (
        <>
          {/* Install trend chart */}
          <Card>
            <SectionTitle small>Install Trend (Last 30 Days)</SectionTitle>
            <InstallTrendChart data={analytics.daily_installs} />
          </Card>

          {/* Top packages */}
          {analytics.top_packages.length > 0 && (
            <Card>
              <SectionTitle small>Top Packages by Installs</SectionTitle>
              <TopPackagesChart data={analytics.top_packages} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function InstallTrendChart({ data }: { data: Array<{ day: string; cnt: number }> }) {
  if (data.length === 0) {
    return <div style={{ color: "#444", fontSize: 11, padding: "12px 0" }}>No install data yet.</div>;
  }

  const maxVal = Math.max(...data.map(d => d.cnt), 1);
  const chartHeight = 60;

  // Fill in missing days for the last 30 days
  const filled: Array<{ day: string; cnt: number }> = [];
  const now = new Date();
  const dataMap = new Map(data.map(d => [d.day, d.cnt]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    filled.push({ day: key, cnt: dataMap.get(key) ?? 0 });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: chartHeight + 4 }}>
        {filled.map(d => {
          const h = d.cnt === 0 ? 2 : Math.max(4, Math.round((d.cnt / maxVal) * chartHeight));
          return (
            <div key={d.day} title={`${d.day}: ${d.cnt}`}
              style={{
                flex: 1, height: h, minWidth: 4,
                background: d.cnt > 0 ? "#4ec9b0" : "#1a1a2a",
                borderRadius: "2px 2px 0 0",
                transition: "height 0.2s",
              }} />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#444" }}>
        <span>{filled[0]?.day.slice(5)}</span>
        <span>today</span>
      </div>
      <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>
        Total in range: <strong style={{ color: "#ccc" }}>{data.reduce((s, d) => s + d.cnt, 0)}</strong> installs
        &nbsp;·&nbsp; Peak: <strong style={{ color: "#4ec9b0" }}>{maxVal}</strong> on {data.reduce((a, b) => b.cnt > a.cnt ? b : a, data[0])?.day}
      </div>
    </div>
  );
}

function TopPackagesChart({ data }: { data: Array<{ dd_id: string; name: string | null; cnt: number }> }) {
  const maxVal = Math.max(...data.map(d => d.cnt), 1);
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map(d => (
        <div key={d.dd_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 160, fontSize: 10, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}
            title={d.dd_id}>
            {d.name ?? d.dd_id}
          </div>
          <div style={{ flex: 1, height: 10, background: "#1a1a2a", borderRadius: 5, overflow: "hidden" }}>
            <div style={{
              width: `${(d.cnt / maxVal) * 100}%`,
              height: "100%",
              background: "#4ec9b066",
              borderRadius: 5,
              transition: "width 0.3s",
            }} />
          </div>
          <div style={{ width: 32, fontSize: 10, color: "#4ec9b0", textAlign: "right", flexShrink: 0 }}>{d.cnt}</div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: "16px 20px", background: "#111118",
      border: `1px solid ${color}33`, borderRadius: 8,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{label}</div>
    </div>
  );
}
