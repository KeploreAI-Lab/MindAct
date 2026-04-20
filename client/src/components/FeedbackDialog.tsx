import React, { useState } from "react";
import { useStore } from "../store";
import { t } from "../i18n";

const inputStyle: React.CSSProperties = {
  background: "#1e1e1e",
  border: "1px solid #444",
  borderRadius: 4,
  color: "#d4d4d4",
  padding: "8px 10px",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [feedbackType, setFeedbackType] = useState<"bug" | "feature" | "general">("general");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<null | "sending" | "sent" | "error">(null);

  const send = async () => {
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: feedbackType,
          message: message.trim(),
          email: email.trim() || undefined,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error("Send failed");
      setStatus("sent");
      setTimeout(onClose, 1800);
    } catch {
      setStatus("error");
    }
  };

  const typeOptions: { id: "bug" | "feature" | "general"; label: string }[] = [
    { id: "bug",     label: t(uiLanguage, "feedback_type_bug") },
    { id: "feature", label: t(uiLanguage, "feedback_type_feature") },
    { id: "general", label: t(uiLanguage, "feedback_type_general") },
  ];

  return (
    <div style={{
      background: "#252526",
      border: "1px solid #3a3a3a",
      borderRadius: 8,
      width: 440,
      maxWidth: "96vw",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px", borderBottom: "1px solid #333" }}>
        <span style={{ color: "#d4d4d4", fontWeight: 700, fontSize: 14 }}>{t(uiLanguage, "feedback_title")}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "2px 6px" }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {status === "sent" ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#4ec9b0", fontSize: 14 }}>
            ✓ {t(uiLanguage, "feedback_sent")}
          </div>
        ) : (
          <>
            {/* Type selector */}
            <div>
              <label style={{ color: "#888", fontSize: 11, fontWeight: 600, display: "block", marginBottom: 6 }}>
                {t(uiLanguage, "feedback_type")}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {typeOptions.map(opt => {
                  const active = feedbackType === opt.id;
                  return (
                    <button key={opt.id} onClick={() => setFeedbackType(opt.id)} style={{
                      flex: 1, padding: "6px 8px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                      border: active ? "1px solid #007acc" : "1px solid #444",
                      background: active ? "#1e3a4f" : "#1e1e1e",
                      color: active ? "#007acc" : "#888",
                      fontWeight: active ? 600 : 400,
                    }}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email */}
            <div>
              <label style={{ color: "#888", fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>
                {t(uiLanguage, "feedback_email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={inputStyle}
              />
            </div>

            {/* Message */}
            <div>
              <label style={{ color: "#888", fontSize: 11, fontWeight: 600, display: "block", marginBottom: 4 }}>
                {t(uiLanguage, "feedback_message")}
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={uiLanguage === "zh" ? "请描述您遇到的问题或建议..." : "Describe the issue or suggestion..."}
                rows={5}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </div>

            {status === "error" && (
              <div style={{ color: "#e05555", fontSize: 11 }}>{t(uiLanguage, "feedback_error")}</div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {status !== "sent" && (
        <div style={{ borderTop: "1px solid #333", padding: "12px 20px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "#2a2a2a", border: "1px solid #444", borderRadius: 4, color: "#888", cursor: "pointer", fontSize: 12, padding: "6px 18px" }}>
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!message.trim() || status === "sending"}
            style={{
              background: !message.trim() || status === "sending" ? "#2a2a2a" : "#007acc",
              border: "1px solid " + (!message.trim() ? "#444" : "#007acc"),
              borderRadius: 4, color: !message.trim() || status === "sending" ? "#444" : "#fff",
              cursor: !message.trim() || status === "sending" ? "not-allowed" : "pointer",
              fontSize: 12, padding: "6px 20px", fontWeight: 600,
            }}
          >
            {status === "sending" ? (uiLanguage === "zh" ? "发送中…" : "Sending…") : t(uiLanguage, "feedback_submit")}
          </button>
        </div>
      )}
    </div>
  );
}
