import React, { useEffect, useState } from "react";
import { getGovernance } from "../api";
import { Card, SectionTitle, Spinner, Btn } from "../ui";

type GovEvent = Awaited<ReturnType<typeof getGovernance>>["events"][number];

const eventColors: Record<string, string> = {
  submitted:    "#7dd3fc",
  approved:     "#4ec9b0",
  rejected:     "#e05555",
  revoked:      "#e05555",
  forked:       "#c8a45a",
  status_changed: "#888",
  reviewed:     "#4ec9b0",
};

export default function GovernancePage() {
  const [events, setEvents] = useState<GovEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ddFilter, setDdFilter] = useState("");

  const load = () => {
    setLoading(true);
    getGovernance(ddFilter || undefined, 200)
      .then(d => setEvents(d.events))
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <SectionTitle>Governance Log</SectionTitle>
        <input
          value={ddFilter}
          onChange={e => setDdFilter(e.target.value)}
          placeholder="Filter by DD ID…"
          style={{
            background: "#1a1a24", border: "1px solid #333", borderRadius: 4,
            color: "#d4d4d4", padding: "5px 10px", fontSize: 11, outline: "none", width: 220,
          }}
          onKeyDown={e => e.key === "Enter" && load()}
        />
        <Btn onClick={load} variant="ghost">Search</Btn>
      </div>

      {err && <div style={{ color: "#e05555", marginBottom: 12, fontSize: 11 }}>Error: {err}</div>}

      {loading ? <Spinner /> : events.length === 0 ? (
        <div style={{ color: "#555", padding: 24, textAlign: "center" }}>No governance events found.</div>
      ) : (
        <Card>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {events.map((ev, i) => (
              <div key={ev.id} style={{
                display: "flex", alignItems: "flex-start", gap: 12,
                padding: "8px 10px",
                borderBottom: i < events.length - 1 ? "1px solid #1a1a1a" : "none",
              }}>
                {/* Timeline dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 3,
                  background: eventColors[ev.event_type] ?? "#555",
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      color: eventColors[ev.event_type] ?? "#888",
                    }}>
                      {ev.event_type.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 11, color: "#ccc" }}>{ev.dd_id}</span>
                    {ev.version && <span style={{ fontSize: 10, color: "#555" }}>v{ev.version}</span>}
                    <span style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>
                      {new Date(ev.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, display: "flex", gap: 10 }}>
                    <span style={{ fontSize: 10, color: "#555" }}>by {ev.actor}</span>
                    {ev.note && <span style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>"{ev.note}"</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "6px 10px", fontSize: 10, color: "#444", borderTop: "1px solid #1a1a1a" }}>
            {events.length} event(s)
          </div>
        </Card>
      )}
    </div>
  );
}
