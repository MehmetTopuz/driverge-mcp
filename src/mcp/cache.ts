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

/** Idempotent ref for a file: same path + mtime → same ref → cache hit. */
export function computeRef(pdfPath: string, mtimeMs: number): string {
  const hash = createHash("sha1")
    .update(`${pdfPath}:${Math.round(mtimeMs)}`)
    .digest("hex");
  return `ds_${hash.slice(0, 12)}`;
}

export function putDatasheet(entry: CacheEntry): void {
  store.set(entry.ref, entry);
}

export function getDatasheet(ref: string): CacheEntry | undefined {
  return store.get(ref);
}

/** Test seam — reset cache between cases. */
export function clearDatasheetCache(): void {
  store.clear();
}
