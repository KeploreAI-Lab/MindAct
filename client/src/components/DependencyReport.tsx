import React, { useState } from "react";
import type { AnalysisReport, ResolvedDependency } from "../types/analysis";
import { getMatchedSkill, getLegacyDependencies } from "../types/analysis";
import { useStore } from "../store";
import { t } from "../i18n";

interface Props {
  report: AnalysisReport;
  onExecute: (enrichedPrompt: string) => void;
  onExecuteRaw: (rawTask: string) => void;
  onApplyCreatedSkill: (rawTask: string) => void;
  onDismiss: () => void;
  onAddKnowledge: () => void;
  onCreateSkill: (report: AnalysisReport) => void;
  createdSkillReady?: boolean;
  creatingSkill?: boolean;
  /** Called when user wants to create a missing skill via skill-creator */
  onCreateWithSkillCreator?: (dep: ResolvedDependency) => void;
  /** True while skill-creator is being installed from cloud */
  installingSkillCreator?: boolean;
}

// ─── Type icons + trust badges ────────────────────────────────────────────────

function typeIcon(type: string): string {
  switch (type) {
    case "skill":     return "⚡";
    case "knowledge": return "📚";
    case "connector": return "🔌";
    case "memory":    return "🧠";
    default:          return "📦";
  }
}

function trustBadge(trust: string): { emoji: string; color: string } {
  switch (trust) {
    case "org-approved": return { emoji: "🟢", color: "#4ec9b0" };
    case "reviewed":     return { emoji: "🔵", color: "#7dd3fc" };
    default:             return { emoji: "🟡", color: "#c8a45a" };
  }
}

function maturityLabel(maturity: string): string {
  return maturity ?? "L0";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DependencyReport({
  report,
  onExecute,
  onExecuteRaw,
  onApplyCreatedSkill,
  onDismiss,
  onAddKnowledge,
  onCreateSkill,
  createdSkillReady,
  creatingSkill,
  onCreateWithSkillCreator,
  installingSkillCreator,
}: Props) {
  const uiLanguage = useStore(s => s.uiLanguage);
  const [expanded, setExpanded] = useState(false);

  const levelConfig = {
    high:   { color: "#4ec9b0", labelKey: "confidence_high" as const, bg: "#0a2a20" },
    medium: { color: "#c8a45a", labelKey: "confidence_medium" as const, bg: "#2a1800" },
    low:    { color: "#e05555", labelKey: "confidence_low" as const, bg: "#2a0a0a" },
  }[report.confidenceLevel];

  // Use compat helpers to get matched skill + legacy dependency list
  const matchedSkill = getMatchedSkill(report);
  const deps = getLegacyDependencies(report);

  // v2: get non-skill resolved deps for richer display
  const resolvedDeps: ResolvedDependency[] = report.resolved
    ? report.resolved.filter(r => r.dd.type !== "skill")
    : [];
  const useV2 = report.resolved && report.resolved.length > 0;

  // Missing deps that are good candidates for skill creation (gated by _isSkillCreatable)
  const creatableSkillDeps: ResolvedDependency[] = report.resolved
    ? report.resolved.filter(r =>
        r.coverage === "none" &&
        ((r.dd as any)._isSkillCreatable === true || r.dd.type === "skill")
      )
    : [];

  return (
    <div style={{
      position: "absolute",
      bottom: 60,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(480px, 90%)",
      background: "#111118",
      border: `1px solid ${levelConfig.color}44`,
      borderRadius: 8,
      boxShadow: `0 4px 24px ${levelConfig.color}22`,
      zIndex: 100,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px",
        background: levelConfig.bg,
        borderBottom: `1px solid ${levelConfig.color}33`,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 11, color: "#888" }}>{t(uiLanguage, "report_analysis")} · {report.domain}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: levelConfig.color,
            padding: "1px 8px", background: levelConfig.bg,
            border: `1px solid ${levelConfig.color}66`, borderRadius: 4,
          }}>
            {t(uiLanguage, levelConfig.labelKey)}
          </span>
        </div>
      </div>

      {/* Dependency list */}
      <div style={{ padding: "10px 14px" }}>
        {matchedSkill && (
          <div style={{ marginBottom: 8, padding: "7px 8px", background: "#0a1a20", borderRadius: 4, fontSize: 10, color: "#7dd3fc" }}>
            ⚡ {t(uiLanguage, "report_skill_matched")}: <b>{matchedSkill.name}</b>
            <span style={{ marginLeft: 8, fontSize: 9, color: "#4ec9b0" }}>
              {Math.round(matchedSkill.score * 100)}%
            </span>
          </div>
        )}

        {matchedSkill ? (
          <div style={{ padding: "8px 10px", background: "#0a1a20", borderRadius: 4, fontSize: 11, color: "#9dd9ff", lineHeight: 1.6 }}>
            {t(uiLanguage, "report_skill_matched_detail", { name: matchedSkill.name })}<br />
            {t(uiLanguage, "report_skill_path", { path: matchedSkill.path })}<br />
            {t(uiLanguage, "report_skill_apply_question")}
          </div>
        ) : deps.length === 0 ? (
          <div style={{ padding: "6px 8px", background: "#1a0a00", borderRadius: 4, fontSize: 10, color: "#c8a45a" }}>
            ⚠ {t(uiLanguage, "report_no_deps_warning")}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {t(uiLanguage, "report_dependencies")} · {report.foundFiles.length} {t(uiLanguage, "report_covered")} · {report.missingDeps.length} {t(uiLanguage, "report_missing")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: expanded ? 240 : 130, overflowY: "auto" }}>
              {useV2
                ? resolvedDeps.map((rd, i) => {
                    const badge = trustBadge(rd.dd.trust);
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        padding: "4px 6px", borderRadius: 4,
                        background: rd.coverage === "none" ? "#1a0808" : "#0a1a0a",
                      }}>
                        <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                          {rd.coverage === "full" ? "✅" : rd.coverage === "partial" ? "🟡" : "❌"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: 10, opacity: 0.7 }}>{typeIcon(rd.dd.type)}</span>
                            <span style={{ fontSize: 11, color: rd.coverage === "none" ? "#e05555" : "#ccc", fontWeight: 500 }}>
                              {rd.dd.name}
                            </span>
                            <span style={{ fontSize: 9, color: badge.color, marginLeft: 2 }} title={`Trust: ${rd.dd.trust}`}>
                              {badge.emoji}
                            </span>
                            <span style={{ fontSize: 8, color: "#555", marginLeft: 2 }}>
                              {maturityLabel(rd.dd.maturity)}
                            </span>
                          </div>
                          {rd.coveredBy.length > 0 && (
                            <div style={{ fontSize: 9, color: "#4ec9b0", marginTop: 1 }}>
                              → {rd.coveredBy.join(", ")}
                            </div>
                          )}
                          {rd.coverage === "none" && (
                            <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>
                              {(rd.dd as any)._isSkillCreatable
                                ? "⚡ Create this skill below"
                                : rd.dd.type === "knowledge"
                                  ? "📚 Add to your vault and re-analyze"
                                  : t(uiLanguage, "report_missing_hint")}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                : deps.map((dep, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 8,
                      padding: "4px 6px", borderRadius: 4,
                      background: dep.coverage === "none" ? "#1a0808" : "#0a1a0a",
                    }}>
                      <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>
                        {dep.coverage === "full" ? "✅" : dep.coverage === "partial" ? "🟡" : "❌"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: dep.coverage === "none" ? "#e05555" : "#ccc", fontWeight: 500 }}>
                          {dep.name}
                          {dep.level === "critical" && (
                            <span style={{ fontSize: 9, color: "#e05555", marginLeft: 6, verticalAlign: "middle" }}>{t(uiLanguage, "report_dep_required")}</span>
                          )}
                        </div>
                        {dep.coveredBy.length > 0 && (
                          <div style={{ fontSize: 9, color: "#4ec9b0", marginTop: 1 }}>
                            → {dep.coveredBy.join(", ")}
                          </div>
                        )}
                        {dep.coverage === "none" && (
                          <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>
                            {t(uiLanguage, "report_missing_hint")}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
              }
            </div>
            {(useV2 ? resolvedDeps : deps).length > 4 && (
              <button onClick={() => setExpanded(!expanded)} style={linkBtn}>
                {expanded
                  ? t(uiLanguage, "report_show_less")
                  : `${t(uiLanguage, "report_show_all")} ${(useV2 ? resolvedDeps : deps).length}`}
              </button>
            )}
            {report.missingDeps.length > 0 && (
              <div style={{ marginTop: 8, padding: "6px 8px", background: "#1a0808", borderRadius: 4, fontSize: 10, color: "#e05555" }}>
                ❌ {t(uiLanguage, "report_missing_list", { list: report.missingDeps.join(", ") })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{
        padding: "8px 14px",
        borderTop: "1px solid #1a1a2a",
        display: "flex",
        gap: 8,
        justifyContent: "flex-end",
      }}>
        <button onClick={onDismiss} style={ghostBtn}>{t(uiLanguage, "report_cancel")}</button>
        {!matchedSkill && !createdSkillReady && (
          creatableSkillDeps.length > 0 && onCreateWithSkillCreator
            /* Gated: show per-skill creation buttons for process-type missing deps */
            ? creatableSkillDeps.slice(0, 3).map(dep => (
                <button
                  key={dep.dd.id}
                  onClick={() => onCreateWithSkillCreator(dep)}
                  disabled={!!installingSkillCreator}
                  style={secondaryBtn(!!installingSkillCreator)}
                >
                  {installingSkillCreator
                    ? "⬇ Installing…"
                    : `⚡ Create "${dep.dd.name}"`}
                </button>
              ))
            /* Fallback: no creatable skill deps, or callback not wired — use static template */
            : (
                <button
                  onClick={() => onCreateSkill(report)}
                  disabled={!!creatingSkill}
                  style={secondaryBtn(!!creatingSkill)}
                >
                  {creatingSkill
                    ? `⟳ ${t(uiLanguage, "report_generating_skill")}`
                    : `✦ ${t(uiLanguage, "report_generate_skill")}`}
                </button>
              )
        )}
        {matchedSkill && (
          <button onClick={() => onExecuteRaw(report.task)} style={secondaryBtn()}>
            {t(uiLanguage, "report_without_skill")}
          </button>
        )}
        {!matchedSkill && createdSkillReady && (
          <button onClick={() => onExecuteRaw(report.task)} style={secondaryBtn()}>
            {t(uiLanguage, "report_without_skill")}
          </button>
        )}
        {report.missingDeps.length > 0 && (
          <button onClick={onAddKnowledge} style={secondaryBtn()}>
            ✓ {t(uiLanguage, "report_reanalyze")}
          </button>
        )}
        <button
          onClick={() => {
            if (!matchedSkill && createdSkillReady) {
              onApplyCreatedSkill(report.task);
              return;
            }
            onExecute(report.enrichedPrompt);
          }}
          style={primaryBtn(levelConfig.color)}
        >
          {matchedSkill
            ? `▶ ${t(uiLanguage, "report_apply_skill")}`
            : createdSkillReady
              ? `▶ ${t(uiLanguage, "report_apply_created_skill")}`
              : report.confidenceLevel === "low"
                ? `⚠ ${t(uiLanguage, "report_execute_anyway")}`
                : `▶ ${t(uiLanguage, "report_execute")}`}
        </button>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "#555", cursor: "pointer",
  fontSize: 10, padding: "2px 0", marginTop: 4,
};
const ghostBtn: React.CSSProperties = {
  background: "none", border: "1px solid #333", borderRadius: 4,
  color: "#666", cursor: "pointer", fontSize: 11, padding: "4px 12px",
};
const secondaryBtn = (disabled?: boolean): React.CSSProperties => ({
  background: "#1a1800",
  border: "1px solid #c8a45a55",
  borderRadius: 4,
  color: "#c8a45a",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 11,
  padding: "4px 12px",
  opacity: disabled ? 0.65 : 1,
});
const primaryBtn = (color: string): React.CSSProperties => ({
  background: color + "22", border: `1px solid ${color}88`, borderRadius: 4,
  color: color, cursor: "pointer", fontSize: 11, padding: "4px 14px", fontWeight: 600,
});
