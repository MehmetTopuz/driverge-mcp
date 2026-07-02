// L1 — PDF format detection. Pure logic over per-page signals so it can be unit
// tested without a real PDF.

import type {
  PageKind,
  PageSignal,
  PdfClassification,
  PdfType,
} from "./types.js";

/**
 * Minimum extractable characters for a page to count as a real "text" page.
 * Below this, a page carrying a raster image is treated as scanned.
 */
export const MIN_TEXT_CHARS = 16;

export function classifyPage(signal: PageSignal): PageKind {
  if (signal.textLength >= MIN_TEXT_CHARS) return "text";
  if (signal.hasImage) return "scanned";
  return "blank";
}

export function classifyDocument(signals: PageSignal[]): PdfClassification {
  const pageKinds = signals.map(classifyPage);
  // Blank pages carry no evidence either way; decide on the content pages.
  const content = pageKinds.filter((kind) => kind !== "blank");

  let type: PdfType;
  if (content.length === 0) {
    // Nothing extractable anywhere — treat as scanned so the caller warns.
    type = "scanned";
  } else if (content.every((kind) => kind === "text")) {
    type = "text_based";
  } else if (content.every((kind) => kind === "scanned")) {
    type = "scanned";
  } else {
    type = "mixed";
  }

  return { type, pageKinds };
}
