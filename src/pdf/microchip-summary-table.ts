// L4a (Microchip summary-table path) — extract Microchip's OTHER register-table
// shape: CAP1206's "TABLE 5-1: REGISTER SET IN HEXADECIMAL ORDER" (pages 21-23),
// a SIX-column row-per-register summary (Register Address | R/W | Register Name
// | Function | Default Value | Page) with NO bit columns at all — bit detail
// lives in separate per-register sections (Table 5-2..5-51), out of scope here.
// This is a DIFFERENT shape from register-table.ts's per-bit MCP23017/BME280
// table (which requires Bit7..Bit0 header cells and has no concept of a
// "Function"/"Page" column), so it gets its own file rather than a third branch
// there — same "keep each vendor dialect self-contained" reasoning as
// maxim-register-map.ts / onsemi-register-table.ts.
//
// Two things the naive "first qualifying page only" reading (today's
// findGenericRegisterTable fallback, which produces only 4/55 registers) gets
// wrong, confirmed via a raw pdfjs positioned-text dump of the real fixture:
//
//   1. The table spans THREE pages (21, 22, 23 — each repeats the same
//      6-column header band, with "(CONTINUED)" in the caption on 22/23), so
//      this adapter's find* entry point accumulates across every page that
//      carries the header, mirroring findMaximRegisterMap's continuation
//      style (not findTiRegisterMap's "stop at the first page without a
//      match" style — degrading gracefully if a page is skipped for any
//      reason is safer for a 3-page table with no interleaved content).
//   2. A HANDFUL of Register Name cells wrap across TWO physical text lines
//      that straddle the row actually carrying the address/default/page cells
//      — and which side (above or below the anchor line) carries which half
//      is NOT consistent (e.g. 0x22 "Sensor Input" sits ABOVE its anchor line
//      while "Configuration" sits BELOW; 0xB9/0xBA additionally strand the
//      R/W-column cell on the ABOVE line too, apart from both the address AND
//      the name). A trailing-only wrap assumption (onsemi-register-table.ts's
//      approach, correct for FXL6408) is not enough here — this adapter walks
//      BOTH directions from each anchor row (mirrors maxim-register-map.ts's
//      two-sided gatherChain), joining whatever name-bearing lines it finds
//      within WRAP_GAP in top-to-bottom (y) order, never x order.
//
// See wiki: cross-vendor-coverage-scorecard, pdf-parsing-pipeline,
// generic-register-table (this adapter is tried BEFORE the role-based generic
// fallback in assembleDatasheet's chain, since the generic pass already
// produces a non-empty — if impoverished — result for this table today).

import { isRegisterAddress, normalizeRegisterAddress } from "./address.js";
import { centerX, clusterRows, type TableRow } from "./table.js";
import type { PageContent, PositionedText, Register, RegisterTable } from "./types.js";

// Base row-clustering tolerance for this adapter's OWN line grouping — much
// tighter than clusterRows' 5px default. This table packs Function-column
// prose wraps and Name-column title wraps at the SAME ~4.98-5.04px physical
// line pitch as the gap from a register's anchor line to its own wrapped
// name fragment; clusterRows' default tolerance would transitively merge
// several of those lines into one synthetic row (losing the adjacency this
// adapter's own gatherChain relies on), so line grouping here only merges
// items that share (near-)exactly the same y — true same-physical-line
// fragments, hand-verified as an EXACT y match throughout the real fixture —
// and every cross-line merge is instead done explicitly below (findHeaderBand
// for the header band, gatherChain for wrapped names).
const LINE_TOLERANCE = 0.1;
// Max vertical span (px) a folded header band's lines may sit apart. The real
// header stacks THREE physical lines ("Register"/"Default" over "R/W"/
// "Register Name"/"Function"/"Page" over "Address"/"Value", ~5.5px apart each)
// — comfortably under this, comfortably over the gap to unrelated content.
const HEADER_BAND = 14;
// Max vertical gap (px) between a register's own anchor row (the line
// carrying its address/default/page cells) and a name-bearing continuation
// line on EITHER side. Real continuation gaps run ~4.98-5.04px; the nearest
// unrelated content (a mid-table section caption, or the next register's own
// territory) sits ~10px+ away — 6 sits cleanly between the two (hand-verified
// against the real fixture dump for every wrapped name in the table).
const WRAP_GAP = 6;
// Max hops a chain of WRAP_GAP-sized steps may take on either side of an
// anchor. Observed wraps never exceed 1 hop per side, but a 3-hop budget
// (mirrors maxim-register-map.ts's WRAP_CHAIN_MAX) costs nothing and guards
// against an unseen 2-line wrap.
const WRAP_CHAIN_MAX = 3;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Columns {
  /** center < addrMax => Register Address column. */
  addrMax: number;
  /** center < rwMax => R/W column — captured, then dropped. */
  rwMax: number;
  /** center < nameMax => Register Name column. */
  nameMax: number;
  /** center < functionMax => Function (prose) column — dropped. */
  functionMax: number;
  /** center < resetMax => Default Value column; otherwise Page — dropped. */
  resetMax: number;
}

type Region = "address" | "rw" | "name" | "function" | "reset" | "page";

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return (
    cells.includes("address") &&
    cells.includes("registername") &&
    cells.includes("function") &&
    (cells.includes("default") || cells.includes("value")) &&
    cells.includes("page")
  );
}

/**
 * Find the header, merging a stacked multi-line header into one synthetic row
 * (mirrors register-table.ts / onsemi-register-table.ts's findHeaderBand):
 * "Register"/"Default" sit one physical line above the main "R/W … Page"
 * line, and "Address"/"Value" sit one physical line below it.
 */
function findHeaderBand(
  rows: TableRow[],
): { header: TableRow; bandBottom: number } | undefined {
  for (let i = 0; i < rows.length; i++) {
    let merged: PositionedText[] = [...rows[i].items];
    let bandBottom = rows[i].y;
    for (let k = 0; k < 3; k++) {
      if (isHeader({ y: rows[i].y, items: merged })) {
        const items = [...merged].sort((a, b) => a.x - b.x);
        return { header: { y: rows[i].y, items }, bandBottom };
      }
      const next = rows[i + k + 1];
      if (!next || rows[i].y - next.y > HEADER_BAND) break;
      merged = merged.concat(next.items);
      bandBottom = next.y;
    }
  }
  return undefined;
}

function columnsFromHeader(header: TableRow): Columns | undefined {
  const addrCenters: number[] = [];
  const resetCenters: number[] = [];
  let rwCenter: number | undefined;
  let nameCenter: number | undefined;
  let functionCenter: number | undefined;
  let pageCenter: number | undefined;

  for (const it of header.items) {
    const t = norm(it.str);
    if (t === "register" || t === "address") {
      addrCenters.push(centerX(it));
    } else if (t === "r/w") {
      rwCenter = centerX(it);
    } else if (t === "registername") {
      nameCenter = centerX(it);
    } else if (t === "function") {
      functionCenter = centerX(it);
    } else if (t === "default" || t === "value") {
      resetCenters.push(centerX(it));
    } else if (t === "page") {
      pageCenter = centerX(it);
    }
  }

  if (
    addrCenters.length === 0 ||
    rwCenter === undefined ||
    nameCenter === undefined ||
    functionCenter === undefined ||
    resetCenters.length === 0 ||
    pageCenter === undefined
  ) {
    return undefined;
  }

  const addrCenter = avg(addrCenters);
  const resetCenter = avg(resetCenters);

  return {
    addrMax: (addrCenter + rwCenter) / 2,
    rwMax: (rwCenter + nameCenter) / 2,
    nameMax: (nameCenter + functionCenter) / 2,
    functionMax: (functionCenter + resetCenter) / 2,
    resetMax: (resetCenter + pageCenter) / 2,
  };
}

function regionOf(it: PositionedText, cols: Columns): Region {
  const c = centerX(it);
  if (c < cols.addrMax) return "address";
  if (c < cols.rwMax) return "rw";
  if (c < cols.nameMax) return "name";
  if (c < cols.functionMax) return "function";
  if (c < cols.resetMax) return "reset";
  return "page";
}

function cellsIn(row: TableRow, cols: Columns, region: Region): PositionedText[] {
  return row.items.filter((it) => regionOf(it, cols) === region);
}

function joinCell(items: PositionedText[]): string {
  return items
    .map((it) => it.str)
    .join("")
    .trim();
}

/** Join a name fragment's items left-to-right with single spaces (register
 *  names in this table never glue adjacent glyphs the way onsemi's minus-sign
 *  split does — a plain space-joined, whitespace-collapsed concatenation
 *  matches every observed cell, including multi-item ones like "Sensor Input
 *  Enable"'s single combined string or "Sensor Input" split further upstream
 *  by the wrap itself). */
function joinText(items: PositionedText[]): string {
  return items
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const isAnchorRow = (row: TableRow, cols: Columns): boolean =>
  isRegisterAddress(joinCell(cellsIn(row, cols, "address")));

/**
 * Gather up to WRAP_CHAIN_MAX rows of name-bearing wrap fragments on one side
 * of an anchor (step = -1 above, +1 below), stopping at the first row already
 * consumed by another register, the first further anchor, or the first gap
 * over WRAP_GAP. Mirrors maxim-register-map.ts's gatherChain, simplified: any
 * non-anchor, non-consumed row within range is walked (even a Function-only
 * line contributes nothing but doesn't break the chain — see file header),
 * since this table interleaves Name-column and Function-column wraps at the
 * same ~5px line pitch and there's no cheap way to tell them apart except by
 * column position, already handled by cellsIn/joinText downstream.
 *
 * Returned index order always reads top-to-bottom, so joining their
 * name-column content reconstructs the original label in reading order.
 */
function gatherChain(
  body: TableRow[],
  anchorIdx: number,
  step: -1 | 1,
  cols: Columns,
  consumed: ReadonlySet<number>,
): number[] {
  const indices: number[] = [];
  let cur = body[anchorIdx];
  for (let hop = 1; hop <= WRAP_CHAIN_MAX; hop++) {
    const idx = anchorIdx + step * hop;
    if (idx < 0 || idx >= body.length || consumed.has(idx)) break;
    const candidate = body[idx];
    const gap = step < 0 ? candidate.y - cur.y : cur.y - candidate.y;
    if (gap > WRAP_GAP || isAnchorRow(candidate, cols)) break;
    indices.push(idx);
    cur = candidate;
  }
  return step < 0 ? indices.reverse() : indices;
}

/** Parse one page's table body (below its header) into registers. */
function registersForPage(body: TableRow[], cols: Columns): Register[] {
  const consumed = new Set<number>();
  const registers: Register[] = [];

  for (let i = 0; i < body.length; i++) {
    if (consumed.has(i)) continue;
    const row = body[i];
    if (!isAnchorRow(row, cols)) continue;

    const upIdx = gatherChain(body, i, -1, cols, consumed);
    const downIdx = gatherChain(body, i, 1, cols, consumed);
    for (const idx of upIdx) consumed.add(idx);
    for (const idx of downIdx) consumed.add(idx);
    consumed.add(i);

    const name = [
      ...upIdx.map((idx) => joinText(cellsIn(body[idx], cols, "name"))),
      joinText(cellsIn(row, cols, "name")),
      ...downIdx.map((idx) => joinText(cellsIn(body[idx], cols, "name"))),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // No RESERVED filler rows observed in this table, but skip defensively —
    // mirrors every other register-table adapter's own convention.
    if (!name || /^reserved$/i.test(name)) continue;

    const rawAddress = joinCell(cellsIn(row, cols, "address"));
    // The Default Value cell shares the address column's own "NNh" idiom
    // (never the binary-octet idiom register-table.ts's normalizeReset
    // handles — see file header), so the SAME hex-cell normalizer applies.
    const rawDefault = joinCell(cellsIn(row, cols, "reset"));

    registers.push({
      name,
      address: normalizeRegisterAddress(rawAddress) ?? rawAddress,
      reset: normalizeRegisterAddress(rawDefault) ?? rawDefault,
      bitFields: [],
    });
  }

  return registers;
}

/** Parse the Microchip summary-table fragment on a single page, if it holds one. */
export function parseMicrochipSummaryTable(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items, LINE_TOLERANCE);
  const band = findHeaderBand(rows);
  if (!band) return undefined;
  const cols = columnsFromHeader(band.header);
  if (!cols) return undefined;

  const body = rows.filter((r) => r.y < band.bandBottom).sort((a, b) => b.y - a.y);
  return { page: page.index, registers: registersForPage(body, cols) };
}

/**
 * Accumulate the Microchip summary table across its continuation pages
 * (mirrors findMaximRegisterMap's shape — every page carrying the header
 * band contributes, regardless of whether an unrelated page in between does
 * not, which never happens for this table but costs nothing to tolerate).
 */
export function findMicrochipSummaryTable(pages: PageContent[]): RegisterTable | undefined {
  let firstPage: number | undefined;
  const registers: Register[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const frag = parseMicrochipSummaryTable(page);
    if (!frag || frag.registers.length === 0) continue;
    if (firstPage === undefined) firstPage = frag.page;
    for (const r of frag.registers) {
      if (!seen.has(r.address)) {
        seen.add(r.address);
        registers.push(r);
      }
    }
  }

  if (firstPage === undefined) return undefined;
  return { page: firstPage, registers };
}
