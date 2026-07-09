// Server-side datasheet cache. analyze_datasheet parses once and stores the full
// DatasheetJson under a content-stable `ref` (hash of pdf_path + mtime); later
// tools hydrate by ref so the large JSON never round-trips through the model.
// See wiki: parsed-json-handoff-via-handle.

import { createHash } from "node:crypto";
import type { DatasheetJson } from "../schema/types.js";

export interface CacheEntry {
  ref: string;
  pdfPath: string;
  json: DatasheetJson;
}

const store = new Map<string, CacheEntry>();

/**
 * Bounded LRU cap — a long-lived server process must not grow this cache
 * without bound under repeated analyze_datasheet calls (see wiki: hardening).
 * Map iteration order is insertion order, so the "oldest" entry is always the
 * first key; recency is refreshed by delete+re-set on both write and read.
 */
export const MAX_CACHE_ENTRIES = 32;

/**
 * Idempotent ref for a file: same path + mtime (+ `extra`) → same ref → cache
 * hit. `extra` folds in anything else that changes assembly output for the
 * same file — currently the analyze_datasheet manufacturer/interface-kind
 * hints (Session 10 / Contract A) — so re-analyzing with different hints
 * doesn't silently serve a stale cached entry from before the hint existed.
 */
export function computeRef(pdfPath: string, mtimeMs: number, extra?: string): string {
  const hash = createHash("sha256")
    .update(`${pdfPath}:${Math.round(mtimeMs)}:${extra ?? ""}`)
    .digest("hex");
  return `ds_${hash.slice(0, 12)}`;
}

export function putDatasheet(entry: CacheEntry): void {
  // Delete-then-set moves an already-present ref to the recent end too, so a
  // re-analyze doesn't leave it stuck near the eviction edge.
  store.delete(entry.ref);
  store.set(entry.ref, entry);
  while (store.size > MAX_CACHE_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function getDatasheet(ref: string): CacheEntry | undefined {
  const entry = store.get(ref);
  if (!entry) return undefined;
  // Refresh recency on read so a hot entry survives future evictions.
  store.delete(ref);
  store.set(ref, entry);
  return entry;
}

/** Test seam — reset cache between cases. */
export function clearDatasheetCache(): void {
  store.clear();
}
