// L4a (register path) — reconstruct a register map table from positioned text.
//
// Two layouts are handled behind one entry point:
//
//   * BME280 (Bosch) style — a single-line header ("Register Name | Address |
//     bit7..bit0 | Reset state") whose bit fields are written as `name[hi:lo]`
//     spans. Field positions are recovered geometrically: each field's center is
//     matched to the bit-column span (of the width implied by `[hi:lo]`) it best
//     aligns with, which correctly handles reserved-bit gaps.
//
//   * MCP23017 (Microchip) style — a header stacked across three physical text
//     lines ("Register"/"Name", "Address"/"(hex)", "bit 7".."bit 0",
//     "POR/RST"/"value") that pdfjs emits as separate rows too far apart for the
//     row clusterer to merge, so we merge the header *band* explicitly. Each
//     register names every bit individually (IO7..IO0) rather than using spans,
//     addresses are bare hex ("00") and resets are binary ("1111 1111"); both are
//     normalized to the "0x.." forms the schema/validator expect.

import { centerX, clusterRows, type TableRow } from "./table.js";
import type {
  BitField,
  PageContent,
  PositionedText,
  Register,
  RegisterTable,
} from "./types.js";

const HEX = /0x[0-9A-Fa-f]+/;
// Bare Microchip address cell: 1-2 hex digits, optional trailing "h" ("00", "1A").
const BARE_HEX = /^([0-9A-Fa-f]{1,2})h?$/;
// name[hi:lo] | name[n] | name<hi:lo> | name<n>
const BITFIELD = /^(.+?)[<[](\d+)(?::(\d+))?[>\]]$/;
// Max vertical span (px) of a header whose column labels stack over a few lines.
const HEADER_BAND = 14;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

interface Columns {
  /** center < nameMax => name column. */
  nameMax: number;
  /** center < addrMax => address column. */
  addrMax: number;
  /** center < bitMax => bit region; otherwise reset column. */
  bitMax: number;
  /** bit index (0-7) => x center of that bit's column. */
  bitCenters: number[];
  /** true => Microchip layout: bare-hex addr, binary reset, per-bit-named cells. */
  perBit: boolean;
}

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return (
    // "Register Name" (BME280, one cell) or a split "Register" cell (Microchip).
    (cells.includes("registername") || cells.includes("register")) &&
    cells.includes("address") &&
    cells.includes("bit7") &&
    cells.includes("bit0")
  );
}

/**
 * Find the header, merging a stacked multi-line header into one synthetic row.
 * clusterRows already groups baselines within ~5px; here we additionally fold in
 * up to two more nearby rows when a single cluster doesn't yet carry all the
 * header tokens (the Microchip header lines sit ~5-6px apart, just past the row
 * tolerance). Returns the merged header plus the y of the band's lowest line so
 * the caller can exclude the folded-in sub-rows from the table body.
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
  const bitCenters: number[] = [];
  let nameCenter: number | undefined;
  let addrCenter: number | undefined;
  const resetCenters: number[] = [];
  let perBit = false;

  for (const it of header.items) {
    const t = norm(it.str);
    const bit = /^bit([0-7])$/.exec(t);
    if (bit) {
      bitCenters[Number(bit[1])] = centerX(it);
    } else if (t === "registername" || t === "register" || t === "name") {
      // BME280 has one "Register Name" cell; Microchip stacks "Register"/"Name".
      nameCenter ??= centerX(it);
    } else if (t === "address") {
      addrCenter = centerX(it);
    } else if (t === "reset" || t === "state" || t === "resetstate") {
      resetCenters.push(centerX(it));
    } else if (t === "por/rst" || t === "value") {
      resetCenters.push(centerX(it));
      perBit = true; // Microchip's reset header — signals the per-bit layout.
    }
  }

  if (
    nameCenter === undefined ||
    addrCenter === undefined ||
    bitCenters[7] === undefined ||
    bitCenters[0] === undefined
  ) {
    return undefined;
  }

  const resetCenter =
    resetCenters.length > 0
      ? resetCenters.reduce((a, b) => a + b, 0) / resetCenters.length
      : bitCenters[0] + 40;

  return {
    nameMax: (nameCenter + addrCenter) / 2,
    addrMax: (addrCenter + bitCenters[7]) / 2,
    bitMax: (bitCenters[0] + resetCenter) / 2,
    bitCenters,
    perBit,
  };
}

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

/** BME280 span layout: `name[hi:lo]` cells matched to bit-column spans. */
function parseBitFields(cells: PositionedText[], cols: Columns): BitField[] {
  const fields: BitField[] = [];
  for (const cell of cells) {
    const m = BITFIELD.exec(cell.str.trim());
    if (!m) continue; // lone "0"/"1" reserved markers and prose are ignored
    const name = m[1].trim();
    const hi = Number(m[2]);
    const width = m[3] !== undefined ? hi - Number(m[3]) + 1 : 1;
    if (!name || width < 1 || width > 8) continue;
    const pos = bitPosition(centerX(cell), width, cols.bitCenters);
    fields.push({ name, msb: pos.msb, lsb: pos.lsb });
  }
  fields.sort((a, b) => b.msb - a.msb);
  return fields;
}

/** Microchip per-bit layout: each named cell snaps to its nearest bit column. */
function parseBitFieldsPerBit(
  cells: PositionedText[],
  cols: Columns,
): BitField[] {
  const fields: BitField[] = [];
  for (const cell of cells) {
    const name = cell.str.trim();
    // Skip unimplemented-bit dashes and lone reserved "0"/"1" markers.
    if (!name || name === "—" || name === "-" || /^[01]$/.test(name)) continue;
    const c = centerX(cell);
    let idx = -1;
    let err = Infinity;
    for (let i = 0; i <= 7; i++) {
      if (cols.bitCenters[i] === undefined) continue;
      const e = Math.abs(c - cols.bitCenters[i]);
      if (e < err) {
        err = e;
        idx = i;
      }
    }
    if (idx < 0) continue;
    fields.push({ name, msb: idx, lsb: idx });
  }
  fields.sort((a, b) => b.msb - a.msb);
  return fields;
}

/** "00"/"1A" -> "0x00"/"0x1A". */
function normalizeAddress(raw: string): string {
  const m = BARE_HEX.exec(raw);
  return m ? `0x${m[1].toUpperCase().padStart(2, "0")}` : raw;
}

/** "1111 1111"/"0000 0000" -> "0xFF"/"0x00". */
function normalizeReset(raw: string): string {
  const bits = raw.replace(/\s+/g, "");
  if (/^[01]{8}$/.test(bits)) {
    return `0x${Number.parseInt(bits, 2).toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return raw;
}

/** Parse a register map table from a single page, if it holds one. */
export function parseRegisterTable(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const band = findHeaderBand(rows);
  if (!band) return undefined;
  const cols = columnsFromHeader(band.header);
  if (!cols) return undefined;

  const below = rows
    .filter((r) => r.y < band.bandBottom)
    .sort((a, b) => b.y - a.y);

  const registers: Register[] = [];
  for (const row of below) {
    const name = row.items
      .filter((it) => centerX(it) < cols.nameMax)
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const rawAddress = row.items
      .filter((it) => centerX(it) >= cols.nameMax && centerX(it) < cols.addrMax)
      .map((it) => it.str)
      .join("")
      .trim();

    // Leave the table body once a row has no recognizable address.
    const addressOk = cols.perBit ? BARE_HEX.test(rawAddress) : HEX.test(rawAddress);
    if (!addressOk) break;

    const rawReset = row.items
      .filter((it) => centerX(it) >= cols.bitMax)
      .map((it) => it.str)
      .join(" ")
      .trim();
    const bitCells = row.items.filter(
      (it) => centerX(it) >= cols.addrMax && centerX(it) < cols.bitMax,
    );

    registers.push({
      name,
      address: cols.perBit ? normalizeAddress(rawAddress) : rawAddress,
      reset: cols.perBit ? normalizeReset(rawReset) : rawReset,
      bitFields: cols.perBit
        ? parseBitFieldsPerBit(bitCells, cols)
        : parseBitFields(bitCells, cols),
    });
  }

  return { page: page.index, registers };
}

/** Scan pages and return the first register map table found. */
export function findRegisterTable(
  pages: PageContent[],
): RegisterTable | undefined {
  for (const page of pages) {
    const table = parseRegisterTable(page);
    if (table && table.registers.length > 0) return table;
  }
  return undefined;
}
