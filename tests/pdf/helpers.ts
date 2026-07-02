import { PDFDocument, StandardFonts } from "pdf-lib";

// 1x1 red PNG — a stand-in for the full-page raster of a scanned datasheet.
const RED_PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface PageSpec {
  /** Text lines drawn on the page (makes it a "text" page). */
  text?: string[];
  /** Draw a full-page image (makes it look "scanned"). */
  image?: boolean;
}

/**
 * Build a PDF in memory from a list of page specs. Text pages carry drawn text
 * (extractable by pdfjs); image pages carry a raster and no text — the two
 * signals PDF type detection keys on.
 */
export async function makePdf(specs: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(Buffer.from(RED_PNG_1x1, "base64"));

  for (const spec of specs) {
    const page = doc.addPage([400, 300]);
    if (spec.image) {
      page.drawImage(png, { x: 0, y: 0, width: 400, height: 300 });
    }
    if (spec.text) {
      let y = 260;
      for (const line of spec.text) {
        page.drawText(line, { x: 20, y, size: 12, font });
        y -= 20;
      }
    }
  }

  return doc.save();
}
