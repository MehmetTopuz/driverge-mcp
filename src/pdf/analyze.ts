// Orchestrates L1 (format detection) + L2 (page map) over a whole PDF and
// surfaces a detect-and-warn message for scanned/mixed input (OCR is deferred).

import { readFile } from "node:fs/promises";
import { classifyDocument } from "./classify.js";
import { extractPages } from "./extract.js";
import { buildPageMap } from "./page-map.js";
import type { PageSignal, PdfAnalysis } from "./types.js";

export async function analyzePdf(data: Uint8Array): Promise<PdfAnalysis> {
  const pages = await extractPages(data);

  const signals: PageSignal[] = pages.map((page) => ({
    textLength: page.text.length,
    hasImage: page.hasImage,
  }));
  const { type } = classifyDocument(signals);
  const pageMap = buildPageMap(pages.map((page) => page.text));

  const warnings: string[] = [];
  if (type === "scanned") {
    warnings.push(
      "PDF appears to be scanned (little or no extractable text). OCR is not supported in v0.1.0, so parsing will be incomplete.",
    );
  } else if (type === "mixed") {
    warnings.push(
      "PDF mixes text and scanned pages. Scanned pages cannot be parsed (OCR deferred to a future release).",
    );
  }

  return { type, pageCount: pages.length, pageMap, pages, warnings };
}

/** Convenience wrapper: analyze a PDF given a local file path (FR: path input). */
export async function analyzePdfFile(path: string): Promise<PdfAnalysis> {
  const buffer = await readFile(path);
  return analyzePdf(new Uint8Array(buffer));
}
