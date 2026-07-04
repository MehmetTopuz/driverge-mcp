// pdfjs-dist adapter: load a PDF and pull positioned text + an image flag from
// every page. The legacy build is the Node-friendly entry (and ships types).

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageContent, PositionedText } from "./types.js";

const IMAGE_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
]);

export async function extractPages(data: Uint8Array): Promise<PageContent[]> {
  // S3 hardening note: earlier pdfjs-dist versions accepted `isEvalSupported`
  // to stop it from `new Function(...)`-evaluating embedded Type3/PostScript
  // glyph code on untrusted PDFs (CVE-2024-4367). This install (pdfjs-dist
  // 6.1.200) removed both the option and the eval code path upstream — grep
  // of node_modules/pdfjs-dist finds no `isEvalSupported` or `new Function(`
  // left in the bundle — so there is nothing left here to opt out of. Flagged
  // to the orchestrator; revisit if a future pdfjs-dist bump reintroduces it.
  const task = getDocument({ data });
  const pdf = await task.promise;
  try {
    const pages: PageContent[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);

      const textContent = await page.getTextContent();
      const items: PositionedText[] = [];
      for (const item of textContent.items) {
        // TextMarkedContent entries carry no `str`; skip them.
        if (!("str" in item)) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height,
        });
      }
      const text = items
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const opList = await page.getOperatorList();
      const hasImage = opList.fnArray.some((fn) => IMAGE_OPS.has(fn));

      pages.push({ index: n, text, items, hasImage });
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.cleanup();
    await task.destroy();
  }
}
