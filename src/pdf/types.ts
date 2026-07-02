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

/** One bit field within a register, positioned by absolute bit index. */
export interface BitField {
  name: string;
  /** Most-significant bit index within the register (0-7). */
  msb: number;
  /** Least-significant bit index within the register (0-7). */
  lsb: number;
}

/** A single register row reconstructed from a memory-map table. */
export interface Register {
  name: string;
  /** Verbatim address cell, e.g. "0xF4" or a range like "0x88…0xA1". */
  address: string;
  /** Verbatim reset/default cell, e.g. "0x00", "0x60", "individual". */
  reset: string;
  bitFields: BitField[];
}

/** The register map extracted from one table. */
export interface RegisterTable {
  /** 1-based page the table was found on. */
  page: number;
  registers: Register[];
}

/** L3a — deterministic manufacturer detection result. */
export interface ManufacturerDetection {
  /** Vendor name, or "generic" when no confident match. */
  manufacturer: string;
  /** 0-1; 0 means generic fallback. */
  confidence: number;
  /** Which signals fired, e.g. ["copyright", "doc-number", "url"]. */
  signals: string[];
}

/** L3b — control-interface classification. */
export type InterfaceKind = "register_map" | "command_set" | "unknown";

export interface InterfaceKindDetection {
  kind: InterfaceKind;
  confidence: number;
  signals: string[];
}

/** Result of L1 + L2 over a whole PDF. */
export interface PdfAnalysis {
  type: PdfType;
  pageCount: number;
  pageMap: PageMap;
  pages: PageContent[];
  warnings: string[];
}
