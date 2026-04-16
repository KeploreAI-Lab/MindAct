/**
 * cache.ts — TTL-based local KV cache at ~/.physmind/registry_cache.json.
 *
 * Used to avoid redundant network calls to the remote registry.
 * NOT the source of truth — D1 / local disk is authoritative.
 * Content blobs (SKILL.md bodies) are never stored here.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const CACHE_PATH = join(homedir(), ".physmind", "registry_cache.json");
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

interface CacheStore {
  [key: string]: CacheEntry;
}

function loadStore(): CacheStore {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as CacheStore;
  } catch {
    return {};
  }
}

function saveStore(store: CacheStore): void {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Non-critical — silently ignore write failures
  }
}

/**
 * Get a cached value by key. Returns undefined if missing or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const store = loadStore();
  const entry = store[key];
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    // Expired — clean up lazily
    delete store[key];
    saveStore(store);
    return undefined;
  }
  return entry.value as T;
}

/**
 * Set a cache value with an optional TTL (ms). Default: 1 hour.
 */
export function cacheSet(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): void {
  const store = loadStore();
  store[key] = { value, expiresAt: Date.now() + ttlMs };
  saveStore(store);
}

/**
 * Delete a specific cache key (e.g., on publish or approve).
 */
export function cacheDelete(key: string): void {
  const store = loadStore();
  if (key in store) {
    delete store[key];
    saveStore(store);
  }
}

/**
 * Delete all keys matching a prefix (e.g., "registry:list:" after publish).
 */
export function cacheDeletePrefix(prefix: string): void {
  const store = loadStore();
  let changed = false;
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) saveStore(store);
}

/**
 * Clear the entire cache.
 */
export function cacheClear(): void {
  saveStore({});
}

// ─── Typed cache helpers for registry use cases ───────────────────────────────

import type { DecisionDependency } from "../types.ts";

const LIST_TTL_MS = 5 * 60 * 1000;   // 5 minutes for list results
const ITEM_TTL_MS = 60 * 60 * 1000;  // 1 hour for individual items

export function cacheListKey(filter: Record<string, string> = {}): string {
  const sorted = Object.entries(filter).sort(([a], [b]) => a.localeCompare(b));
  return `registry:list:${sorted.map(([k, v]) => `${k}=${v}`).join(":")}`;
}

export function cacheGetList(filter: Record<string, string> = {}): DecisionDependency[] | undefined {
  return cacheGet<DecisionDependency[]>(cacheListKey(filter));
}

export function cacheSetList(filter: Record<string, string> = {}, items: DecisionDependency[]): void {
  cacheSet(cacheListKey(filter), items, LIST_TTL_MS);
}

export function cacheGetItem(id: string): DecisionDependency | undefined {
  return cacheGet<DecisionDependency>(`registry:item:${id}`);
}

export function cacheSetItem(dd: DecisionDependency): void {
  cacheSet(`registry:item:${dd.id}`, dd, ITEM_TTL_MS);
}

export function cacheInvalidateItem(id: string): void {
  cacheDelete(`registry:item:${id}`);
  cacheDeletePrefix("registry:list:");
}
