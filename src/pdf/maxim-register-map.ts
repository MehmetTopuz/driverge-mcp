// L4a (Maxim register-matrix path) — extract Maxim Integrated's "Register Maps
// and Descriptions" table shape (e.g. MAX30102: pages 10-22), added as a NEW
// specialized adapter (mirrors ti-register-map.ts's parse+find shape) rather
// than folding into register-table.ts: the column ORDER differs from every
// existing adapter (REGISTER | bit region | REG ADDR | POR STATE | R/W — the
// bit region sits BETWEEN the name and the address, not after it), and the
// per-bit cells mix BME280-style bracketed spans ("MODE[2:0]") with
// Microchip-style bare single-bit names ("SHDN") in the SAME table, which
// neither existing per-bit path handles together.
//
// The header itself is a *band*: "REG"/"ADDR" and "POR"/"STATE" render as two
// physical lines a few px apart (sometimes with a third line above carrying
// "REG"/"POR" and the "REGISTER"/B7..B0/"R/W" line in between) — too close for
// clusterRows' 5px tolerance to merge but too far to land in one row, so this
// adapter folds the header band explicitly (mirrors register-table.ts's
// findHeaderBand approach; reimplemented locally rather than exported, since
// the column semantics differ enough that sharing the type isn't worth it).
//
// Real Maxim datasheets also wrap a register's own name, and occasionally a
// long bit-field label, across the line ABOVE and the line BELOW the data row
// itself (the label is vertically centered on the row, so half renders above
// and half below — e.g. MAX30102's "Mode" / <data row> / "Configuration").
// Those wrap lines sit within a few px of the data row (much closer than the
// gap to any unrelated content), so a name-only or bit-region-only line found
// within WRAP_GAP of a valid-address row is folded into that register instead
// of ending the table. See wiki: cross-vendor-coverage-scorecard,
// pdf-parsing-pipeline.

import { isRegisterAddress, normalizeRegisterAddress } from "./address.js";
import { centerX, clusterRows, type TableRow } from "./table.js";
import type {
  BitField,
  PageContent,
  PositionedText,
  Register,
  RegisterTable,
} from "./types.js";

// name[hi:lo] | name[n] | name<hi:lo> | name<n>
const BITFIELD = /^(.+?)[<[](\d+)(?::(\d+))?[>\]]$/;
// Max vertical span (px) a folded header band's lines may sit apart.
const HEADER_BAND = 14;
// Max vertical gap (px) between a data row and a name/bit-label continuation
// line that wraps around it. Comfortably above the ~5-6px real-world wrap gap
// and comfortably below the ~15px+ gap between distinct registers/sections.
const WRAP_GAP = 8;
// Max hops a chain of WRAP_GAP-sized steps may take to reach an anchor row.
// A bit-field label occasionally wraps across MORE than one line on either
// side of its data row (e.g. MAX30102's interrupt-enable names split as
// "A_" / "FULL_" (on the data row) / "EN", three lines deep) — only the
// immediate neighbor is folded into the register (see prefix/suffix below),
// but the table body must not end just because a farther wrap line isn't
// itself adjacent to the anchor.
const WRAP_CHAIN_MAX = 3;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

interface Columns {
  /** center < nameMax => REGISTER (name) column. */
  nameMax: number;
  /** center < bitMax => bit region (B7..B0). */
  bitMax: number;
  /** center < addrMax => REG ADDR column. */
  addrMax: number;
  /** center < resetMax => POR STATE column; otherwise R/W (ignored). */
  resetMax: number;
  /** bit index (0-7) => x center of that bit's column. */
  bitCenters: number[];
}

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return (
    cells.includes("register") &&
    cells.includes("b7") &&
    cells.includes("b0") &&
    cells.includes("reg") &&
    cells.includes("addr") &&
    cells.includes("por") &&
    cells.includes("state")
  );
}

/**
 * Find the header, folding a band of nearby lines into one synthetic row (see
 * file header — "REG"/"POR" and/or "ADDR"/"STATE" commonly sit a physical line
 * away from the main "REGISTER B7..B0 R/W" line).
 */
function findHeaderBand(
  rows: TableRow[],
): { header: TableRow; bandBottom: number } | undefined {
  for (let i = 0; i < rows.length; i++) {
    let merged: PositionedText[] = [...rows[i].items];
    let bandBottom = rows[i].y;
    for (let k = 0; k < 3; k++) {
      if (isHeader({ y: rows[i].y, items: merged })) {
        return { header: { y: rows[i].y, items: merged }, bandBottom };
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
  const bitCenters: number[] = [];
  let nameCenter: number | undefined;
  let regCenter: number | undefined;
  let addrCenter: number | undefined;
  let porCenter: number | undefined;
  let stateCenter: number | undefined;
  let rwCenter: number | undefined;

  for (const it of header.items) {
    const tok = norm(it.str);
    const bit = /^b([0-7])$/.exec(tok);
    if (bit) {
      bitCenters[Number(bit[1])] = centerX(it);
    } else if (tok === "register") {
      nameCenter = centerX(it);
    } else if (tok === "reg") {
      regCenter = centerX(it);
    } else if (tok === "addr") {
      addrCenter = centerX(it);
    } else if (tok === "por") {
      porCenter = centerX(it);
    } else if (tok === "state") {
      stateCenter = centerX(it);
    } else if (tok === "r/w") {
      rwCenter = centerX(it);
    }
  }

  if (
    nameCenter === undefined ||
    bitCenters[7] === undefined ||
    bitCenters[0] === undefined ||
    regCenter === undefined ||
    addrCenter === undefined ||
    porCenter === undefined ||
    stateCenter === undefined
  ) {
    return undefined;
  }

  const addrColCenter = (regCenter + addrCenter) / 2;
  const resetColCenter = (porCenter + stateCenter) / 2;

  return {
    nameMax: (nameCenter + bitCenters[7]) / 2,
    bitMax: (bitCenters[0] + addrColCenter) / 2,
    addrMax: (addrColCenter + resetColCenter) / 2,
    resetMax:
      rwCenter !== undefined ? (resetColCenter + rwCenter) / 2 : Number.POSITIVE_INFINITY,
    bitCenters,
  };
}

type Region = "name" | "bit" | "address" | "reset" | "other";

function regionOf(it: PositionedText, cols: Columns): Region {
  const c = centerX(it);
  if (c < cols.nameMax) return "name";
  if (c < cols.bitMax) return "bit";
  if (c < cols.addrMax) return "address";
  if (c < cols.resetMax) return "reset";
  return "other";
}

function cellsIn(row: TableRow, cols: Columns, region: Region): PositionedText[] {
  return row.items.filter((it) => regionOf(it, cols) === region);
}

function joinText(items: PositionedText[]): string {
  return items
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mirrors register-table.ts's bitPosition: center a `[hi:lo]` span over the bit columns. */
function bitPosition(
  fieldCenter: number,
  width: number,
  bitCenters: number[],
): { msb: number; lsb: number } {
  let best = { msb: width - 1, lsb: 0, err: Infinity };
  for (let msb = width - 1; msb <= 7; msb++) {
    const lsb = msb - width + 1;
    const hiC = bitCenters[msb];
    const loC = bitCenters[lsb];
    if (hiC === undefined || loC === undefined) continue;
    const spanCenter = (hiC + loC) / 2;
    const err = Math.abs(fieldCenter - spanCenter);
    if (err < best.err) best = { msb, lsb, err };
  }
  return { msb: best.msb, lsb: best.lsb };
}

/** Snap a bare bit-name cell to its nearest B<n> column. */
function nearestBitColumn(c: number, bitCenters: number[]): number {
  let idx = -1;
  let err = Infinity;
  for (let i = 0; i <= 7; i++) {
    if (bitCenters[i] === undefined) continue;
    const e = Math.abs(c - bitCenters[i]);
    if (e < err) {
      err = e;
      idx = i;
    }
  }
  return idx;
}

/**
 * Build a register's bit fields from up to three cell groups (a wrapped
 * name-continuation line's bit-region cells, the data row's own, and a
 * trailing wrap's) in top-to-bottom order. Bracketed spans are sized from the
 * bracket and positioned geometrically (never wrap in practice). Bare cells
 * snap to their nearest column and — since a long bare label can itself wrap
 * across the same three lines (e.g. "PWR_" above + "RDY" below the data row,
 * both centered on B0) — fragments landing in the same column concatenate in
 * the order encountered, reconstructing the original label.
 */
function collectBitFields(groups: PositionedText[][], cols: Columns): BitField[] {
  const spanFields: BitField[] = [];
  const byColumn = new Map<number, string[]>();

  for (const cells of groups) {
    for (const cell of cells) {
      const text = cell.str.trim();
      if (!text || text === "—" || text === "-" || /^[01]$/.test(text)) continue;

      const m = BITFIELD.exec(text);
      if (m) {
        const name = m[1].trim();
        const hi = Number(m[2]);
        const width = m[3] !== undefined ? hi - Number(m[3]) + 1 : 1;
        if (!name || width < 1 || width > 8) continue;
        const pos = bitPosition(centerX(cell), width, cols.bitCenters);
        spanFields.push({ name, msb: pos.msb, lsb: pos.lsb });
        continue;
      }

      const idx = nearestBitColumn(centerX(cell), cols.bitCenters);
      if (idx < 0) continue;
      const parts = byColumn.get(idx) ?? [];
      parts.push(text);
      byColumn.set(idx, parts);
    }
  }

  const bareFields: BitField[] = [...byColumn.entries()].map(([idx, parts]) => ({
    name: parts.join(""),
    msb: idx,
    lsb: idx,
  }));

  return [...spanFields, ...bareFields].sort((a, b) => b.msb - a.msb);
}

/**
 * True when, starting at `body[start]` (itself not an anchor), a chain of
 * WRAP_GAP-sized steps reaches an anchor row within WRAP_CHAIN_MAX hops. Used
 * to tell a genuine decoy/end-of-table row apart from a wrap line that's
 * merely farther than one hop from the register it belongs to.
 */
function chainsToAnchor(
  body: TableRow[],
  start: number,
  isAnchor: (row: TableRow) => boolean,
): boolean {
  let cur = body[start];
  for (let j = start + 1; j < body.length && j <= start + WRAP_CHAIN_MAX; j++) {
    const next = body[j];
    if (cur.y - next.y > WRAP_GAP) return false;
    if (isAnchor(next)) return true;
    cur = next;
  }
  return false;
}

/** Parse a Maxim register-matrix table from a single page, if it holds one. */
export function parseMaximRegisterMap(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const band = findHeaderBand(rows);
  if (!band) return undefined;
  const cols = columnsFromHeader(band.header);
  if (!cols) return undefined;

  const body = rows.filter((r) => r.y < band.bandBottom).sort((a, b) => b.y - a.y);
  const isAnchor = (row: TableRow) =>
    isRegisterAddress(joinText(cellsIn(row, cols, "address")));

  const registers: Register[] = [];
  const consumed = new Set<number>();
  // y of the farthest row folded into the most recently pushed register — a
  // trailing wrap fragment more than one hop past the anchor (e.g. the "EN" in
  // "A_" / "FULL_" / "EN") lands within WRAP_GAP of this rather than of the
  // anchor itself.
  let lastRowY: number | undefined;

  for (let i = 0; i < body.length; i++) {
    if (consumed.has(i)) continue;
    const row = body[i];

    if (!isAnchor(row)) {
      if (lastRowY !== undefined && lastRowY - row.y <= WRAP_GAP) {
        // A trailing wrap fragment of the register just pushed — its content
        // isn't folded in (only the immediate suffix is), but it must not be
        // mistaken for a decoy that ends the table.
        lastRowY = row.y;
        continue;
      }
      if (chainsToAnchor(body, i, isAnchor)) continue; // leads into the next register
      break; // a genuine decoy/unrelated row — ends the table body
    }

    const prefixCandidate = i > 0 ? body[i - 1] : undefined;
    const prefix =
      prefixCandidate &&
      !consumed.has(i - 1) &&
      prefixCandidate.y - row.y <= WRAP_GAP &&
      !isAnchor(prefixCandidate)
        ? prefixCandidate
        : undefined;

    const suffixCandidate = i + 1 < body.length ? body[i + 1] : undefined;
    const suffix =
      suffixCandidate && row.y - suffixCandidate.y <= WRAP_GAP && !isAnchor(suffixCandidate)
        ? suffixCandidate
        : undefined;
    if (suffix) consumed.add(i + 1);

    const name = [
      prefix ? joinText(cellsIn(prefix, cols, "name")) : "",
      joinText(cellsIn(row, cols, "name")),
      suffix ? joinText(cellsIn(suffix, cols, "name")) : "",
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const bitFields = collectBitFields(
      [
        prefix ? cellsIn(prefix, cols, "bit") : [],
        cellsIn(row, cols, "bit"),
        suffix ? cellsIn(suffix, cols, "bit") : [],
      ],
      cols,
    );

    const rawAddress = joinText(cellsIn(row, cols, "address"));
    const reset = joinText(cellsIn(row, cols, "reset"));

    registers.push({
      name,
      address: normalizeRegisterAddress(rawAddress) ?? rawAddress,
      reset,
      bitFields,
    });
    lastRowY = suffix ? suffix.y : row.y;
  }

  return { page: page.index, registers };
}

/**
 * Accumulate the Maxim register-matrix table across pages (mirrors
 * findTiRegisterMap's dedup shape). Unlike TI's single contiguous summary
 * table, Maxim spreads per-register tables across many pages interleaved with
 * prose (bit-field descriptions, examples) between them — a page with no table
 * is simply skipped, not treated as the end of the document's table.
 */
export function findMaximRegisterMap(pages: PageContent[]): RegisterTable | undefined {
  let firstPage: number | undefined;
  const registers: Register[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const frag = parseMaximRegisterMap(page);
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
