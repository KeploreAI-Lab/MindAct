import React, { useState } from "react";
import { Config, useStore } from "../store";
import { t } from "../i18n";

interface Props {
  onSave: (config: Config) => void;
}

export default function SetupDialog({ onSave }: Props) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [vault, setVault] = useState("");
  const [project, setProject] = useState("");
  const [skills, setSkills] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!vault || !project || !skills) { setError(t(uiLanguage, "setup_required")); return; }
    setSaving(true);
    const config: Config = { vault_path: vault, project_path: project, skills_path: skills, panel_ratio: 0.45 };
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      onSave(config);
    } catch {
      setError("Failed to save config.");
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#1e1e1e",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#252526",
        border: "1px solid #007acc",
        borderRadius: 10,
        padding: 40,
        width: 480,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ marginBottom: 8, color: "#007acc", fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>
          {t(uiLanguage, "setup_title")}
        </div>
        <div style={{ color: "#888", marginBottom: 28, fontSize: 13 }}>
          {t(uiLanguage, "setup_subtitle")}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 6 }}>
              {t(uiLanguage, "setup_vault")}
            </label>
            <input
              value={vault}
              onChange={e => setVault(e.target.value)}
              placeholder="/Users/you/my-vault"
              style={inputStyle}
              autoFocus
            />
          </div>
          <div>
            <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 6 }}>
              {t(uiLanguage, "setup_project")}
            </label>
            <input
              value={project}
              onChange={e => setProject(e.target.value)}
              placeholder="/Users/you/my-project"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ color: "#aaa", fontSize: 11, display: "block", marginBottom: 6 }}>
              {t(uiLanguage, "setup_skills")}
            </label>
            <input
              value={skills}
              onChange={e => setSkills(e.target.value)}
              placeholder="/Users/you/MindAct/skills-test"
              style={inputStyle}
            />
          </div>
          {error && <div style={{ color: "#f44", fontSize: 12 }}>{error}</div>}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              marginTop: 8,
              padding: "10px 0",
              background: "#007acc",
              border: "none",
              borderRadius: 5,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? t(uiLanguage, "saving") : t(uiLanguage, "get_started")}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1e1e1e",
  border: "1px solid #555",
  borderRadius: 5,
  color: "#d4d4d4",
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
};
