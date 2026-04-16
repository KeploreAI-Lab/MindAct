import type { DecisionDependency, DDType, TrustLevel, Visibility } from "../types.ts";

// ─── Registry Interface ───────────────────────────────────────────────────────

export interface DecisionDependencyRegistry {
  /**
   * List available dependencies, optionally filtered.
   */
  list(filter?: RegistryFilter): Promise<DecisionDependency[]>;

  /**
   * Get a single dependency by id, optionally at a specific version.
   * Returns null if not found.
   */
  get(id: string, version?: string): Promise<DecisionDependency | null>;

  /**
   * Lazily load the SKILL.md / entry doc body for a dependency.
   * Uses dd.id + dd.version to uniquely identify the blob.
   * The caller may cache the result in dd.content for the session.
   */
  getContent(dd: DecisionDependency): Promise<string>;

  /**
   * Install a dependency locally (download from remote, write to skills dir).
   * Returns the fully-populated DecisionDependency after install.
   */
  install(id: string, version?: string): Promise<DecisionDependency>;

  /**
   * Publish a dependency to the registry.
   * Only allowed for trust: "org-approved" callers on the remote registry.
   */
  publish(dd: DecisionDependency): Promise<void>;
}

// ─── Filter ───────────────────────────────────────────────────────────────────

export interface RegistryFilter {
  type?: DDType;
  domain?: string;
  tags?: string[];
  visibility?: Visibility;
  trust?: TrustLevel;
  /** Free-text query matched against name + description */
  query?: string;
}
