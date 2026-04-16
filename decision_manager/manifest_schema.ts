import { z } from "zod";

// ─── Package Manifest (decision-dependency.yaml) ─────────────────────────────

export const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "must follow semver X.Y.Z"),
  type: z.enum(["skill", "knowledge", "connector", "memory"]),
  modes: z.array(z.enum(["tool_wrapper", "generator", "reviewer", "inversion", "pipeline"])).default([]),
  tags: z.array(z.string()).default([]),
  domain: z.string().default(""),
  publisher: z.string().default(""),
  visibility: z.enum(["public", "private", "org"]).default("private"),
  trust: z.enum(["untrusted", "reviewed", "org-approved"]).default("untrusted"),
  maturity: z.enum(["L0", "L1", "L2", "L3"]).default("L0"),
  trigger: z.object({
    intents: z.array(z.string()),
    preconditions: z.array(z.string()).optional(),
    requiredInputs: z.array(z.string()).optional(),
    blockedUntil: z.array(z.string()).optional(),
    scoringHints: z.record(z.string(), z.number()).optional(),
  }).optional(),
  executionPolicy: z.object({
    runtime: z.enum(["python", "typescript", "bash", "none"]),
    entrypoint: z.string().optional(),
    allowNetwork: z.boolean(),
    allowSideEffects: z.boolean(),
    allowFileWrite: z.boolean(),
    allowedConnectors: z.array(z.string()).optional(),
    requiresApproval: z.boolean(),
  }).optional(),
  checkpoints: z.array(z.object({
    id: z.string(),
    label: z.string(),
    blocking: z.boolean(),
    requiresUserConfirmation: z.boolean(),
    completionCondition: z.string().optional(),
  })).optional(),
  resourceIndex: z.object({
    entryDocs: z.array(z.string()).optional(),
    knowledgeDocs: z.array(z.string()).optional(),
    executableScripts: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
    assets: z.array(z.string()).optional(),
    tests: z.array(z.string()).optional(),
    evals: z.array(z.string()).optional(),
    configFiles: z.array(z.string()).optional(),
  }).optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

// ─── LLM Output Schemas ───────────────────────────────────────────────────────

/**
 * Stage 1 (detect): domain detection output.
 * LLM produces: { is_domain_specific: bool, domain: string|null, reason: string }
 */
export const DomainDetectSchema = z.object({
  is_domain_specific: z.boolean(),
  domain: z.string().nullable().transform(v => v ?? ""),
  reason: z.string().default(""),
});

export type DomainDetectResult = z.infer<typeof DomainDetectSchema>;

/**
 * Stage 2 (decompose): dependency decomposition output.
 * LLM produces: { dependencies: [{name, description, level}] }
 */
export const DependencyItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  level: z.enum(["critical", "helpful"]).default("helpful"),
});

export const DependencyArraySchema = z.object({
  dependencies: z.array(DependencyItemSchema).default([]),
});

export type DependencyItem = z.infer<typeof DependencyItemSchema>;
export type DependencyArrayResult = z.infer<typeof DependencyArraySchema>;

/**
 * Stage 3 (file match): per-file coverage output.
 * LLM produces: { covered: [{dependency: string, coverage: "full"|"partial"|"none"}] }
 */
export const FileCoverageItemSchema = z.object({
  dependency: z.string().min(1),
  coverage: z.enum(["full", "partial", "none"]).default("partial"),
});

export const FileMatchSchema = z.object({
  covered: z.array(FileCoverageItemSchema).default([]),
});

export type FileCoverageItem = z.infer<typeof FileCoverageItemSchema>;
export type FileMatchResult = z.infer<typeof FileMatchSchema>;

/**
 * Stage 3 (batch match): batch file matching output.
 * LLM produces: { matches: [{dependency, level, covered_by, coverage}] }
 */
export const BatchMatchItemSchema = z.object({
  dependency: z.string().min(1),
  level: z.enum(["critical", "helpful"]).default("helpful"),
  covered_by: z.array(z.string()).default([]),
  coverage: z.enum(["full", "partial", "none"]).default("none"),
});

export const BatchMatchSchema = z.object({
  matches: z.array(BatchMatchItemSchema).default([]),
});

export type BatchMatchItem = z.infer<typeof BatchMatchItemSchema>;
export type BatchMatchResult = z.infer<typeof BatchMatchSchema>;
