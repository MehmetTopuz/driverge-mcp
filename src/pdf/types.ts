// Shared types for the PDF parsing pipeline (L1 format detection + L2 page map).

/** Overall classification of a datasheet PDF. */
export type PdfType = "text_based" | "scanned" | "mixed";

/** Per-page classification. */
export type PageKind = "text" | "scanned" | "blank";

/** A single positioned text run extracted from a page. */
export interface PositionedText {
  str: string;
  /** X of the text origin, in PDF user-space units (origin bottom-left). */
  x: number;
  /** Y of the text origin, in PDF user-space units. */
  y: number;
  width: number;
  height: number;
}

/** Everything extracted from one page. */
export interface PageContent {
  /** 1-based page number. */
  index: number;
  /** Whitespace-normalized concatenation of the page's text runs. */
  text: string;
  items: PositionedText[];
  /** Whether the page paints a raster image (a "scanned" signal). */
  hasImage: boolean;
}

/** Minimal per-page signal the classifier needs — kept PDF-free so it is pure. */
export interface PageSignal {
  textLength: number;
  hasImage: boolean;
}

export interface PdfClassification {
  type: PdfType;
  pageKinds: PageKind[];
}

/** Label -> 1-based page numbers where that section was detected. */
export type PageMap = Record<string, number[]>;

/** Result of L1 + L2 over a whole PDF. */
export interface PdfAnalysis {
  type: PdfType;
  pageCount: number;
  pageMap: PageMap;
  pages: PageContent[];
  warnings: string[];
}
