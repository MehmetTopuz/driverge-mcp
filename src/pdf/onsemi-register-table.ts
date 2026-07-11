// L4a (onsemi register path) — extract onsemi's "I2C REGISTER MAP" table shape
// (e.g. FXL6408's Table 9, page 9), added as a NEW specialized adapter rather
// than folding into register-table.ts's Microchip per-bit path.
//
// Table 9 LOOKS like the existing BME280/Microchip per-bit shape at a glance —
// same "Register | Address | Bit7..Bit0 | Reset Value" band, individual
// per-bit cell names ("MF3"/"GPIO7"/"Out 7"/"In 7"), bare-hex-+"h" addresses,
// contiguous binary reset strings — but it inserts an extra "Type" (R/W) column
// BETWEEN Address and Bit7 that register-table.ts's Columns model has no
// concept of: its addrMax..bitMax boundary conflates Type into the address
// capture, so the first row's address cell reads "01hR/W" and fails BARE_HEX
// outright (confirmed against current src with the real fixture — this is why
// today's extraction is "deferred" with registers: [], not a parse of the
// wrong shape). This adapter's Columns model carries a distinct `typeMax`
// boundary so the Type cell is captured and simply dropped (the schema has no
// per-register access-type field).
//
// Register names ALSO wrap across two physical text lines for several rows
// ("Device ID &" / "Ctrl", "Input Default" / "State", "Interrupt" / "Status")
// — register-table.ts has no wrap-continuation handling at all, so even a
// Type-column fix alone would still break the table body at the first
// continuation-only row. Verified via a raw pdfjs positioned-text dump: the
// continuation line always sits ~7.7-8.7px BELOW its register's own anchor
// row (comfortably under WRAP_GAP), while the pitch to the NEXT register's own
// anchor is ~14.2-14.7px (comfortably over it) — so a wrap line is always
// unambiguous and always trailing (never leading, unlike Maxim's two-sided
// wrap chains — see maxim-register-map.ts).
//
// Two register names also contain a genuine glyph split: "Output High−Z"
// (0x07) and "Pull−Down/ Pull−Up" (0x0D) render their hyphens as a SEPARATE
// positioned-text item using U+2212 MINUS SIGN (not the ASCII hyphen),
// immediately glyph-adjacent (~0px gap) to the surrounding letters — glued
// with no inserted space via the same GLYPH_ADJACENT_EPS convention
// maxim-register-map.ts established. 0x0D's name additionally wraps across
// two physical lines; the two lines join with a single space, mirroring every
// other cross-line title join in this codebase.
//
// See wiki: cross-vendor-coverage-scorecard, pdf-parsing-pipeline,
// json-schema-as-contract (reset stays a verbatim free-form string, so the
// two "XXXXXXXX" status-register resets pass through untouched).

import { isRegisterAddress, normalizeRegisterAddress } from "./address.js";
import { normalizeReset } from "./register-table.js";
import { centerX, clusterRows, type TableRow } from "./table.js";
import type {
  BitField,
  PageContent,
  PositionedText,
  Register,
  RegisterTable,
} from "./types.js";

// Max vertical span (px) a folded header band's lines may sit apart — the
// "Reset" / "Value" header cells stack ~8.6px above the main "Register …
// Bit0" line, comfortably under this and comfortably over the gap to any
// unrelated preceding line (see findHeaderBand).
const HEADER_BAND = 14;
// Max vertical gap (px) between a register's own anchor row and a trailing
// name-only wrap-continuation line. Real continuation gaps run ~7.7-8.7px;
// the pitch to the next register's own anchor runs ~14.2-14.7px — 10 sits
// cleanly between the two (hand-verified against the real fixture dump).
const WRAP_GAP = 10;
// Two glyph runs are joined with NO space when the gap between them is at or
// below this — pdfjs renders the U+2212 MINUS SIGN in "High−Z"/"Pull−Down" as
// its own positioned-text item immediately adjacent (~0px gap) to the
// surrounding letters, versus tens of px between genuinely distinct words.
// Mirrors maxim-register-map.ts's GLYPH_ADJACENT_EPS.
const GLYPH_ADJACENT_EPS = 1.5;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

interface Columns {
  /** center < nameMax => Register (name) column. */
  nameMax: number;
  /** center < addrMax => Address column. */
  addrMax: number;
  /** center < typeMax => Type (R/W) column — captured, then dropped. */
  typeMax: number;
  /** center < bitMax => bit region (Bit7..Bit0); otherwise Reset/Value. */
  bitMax: number;
  /** bit index (0-7) => x center of that bit's column. */
  bitCenters: number[];
}

type Region = "name" | "address" | "type" | "bit" | "reset";

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return (
    cells.includes("register") &&
    cells.includes("address") &&
    cells.includes("type") &&
    cells.includes("bit7") &&
    cells.includes("bit0")
  );
}

/**
 * Find the header, merging a stacked multi-line header into one synthetic row
 * (mirrors register-table.ts's findHeaderBand): the "Reset" cell sits one
 * physical line above the main "Register … Bit0 Value" line, too close for
 * clusterRows' 5px tolerance to merge but too far to land in one row.
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
  let typeCenter: number | undefined;
  const resetCenters: number[] = [];

  for (const it of header.items) {
    const t = norm(it.str);
    const bit = /^bit([0-7])$/.exec(t);
    if (bit) {
      bitCenters[Number(bit[1])] = centerX(it);
    } else if (t === "register") {
      nameCenter = centerX(it);
    } else if (t === "address") {
      addrCenter = centerX(it);
    } else if (t === "type") {
      typeCenter = centerX(it);
    } else if (t === "reset" || t === "value") {
      resetCenters.push(centerX(it));
    }
  }

  if (
    nameCenter === undefined ||
    addrCenter === undefined ||
    typeCenter === undefined ||
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
    addrMax: (addrCenter + typeCenter) / 2,
    typeMax: (typeCenter + bitCenters[7]) / 2,
    bitMax: (bitCenters[0] + resetCenter) / 2,
    bitCenters,
  };
}

function regionOf(it: PositionedText, cols: Columns): Region {
  const c = centerX(it);
  if (c < cols.nameMax) return "name";
  if (c < cols.addrMax) return "address";
  if (c < cols.typeMax) return "type";
  if (c < cols.bitMax) return "bit";
  return "reset";
}

function cellsIn(row: TableRow, cols: Columns, region: Region): PositionedText[] {
  return row.items.filter((it) => regionOf(it, cols) === region);
}

/** True when EVERY item in the row sits in the name column — a bare
 *  wrap-continuation line of a register's own title (e.g. "Ctrl", "State"). */
function isNameOnly(row: TableRow, cols: Columns): boolean {
  return row.items.length > 0 && row.items.every((it) => regionOf(it, cols) === "name");
}

/**
 * Join a row's cells left-to-right (items already come x-sorted from
 * clusterRows). Two cells with essentially no horizontal gap between them
 * (see GLYPH_ADJACENT_EPS) are glued with no space — pdfjs's own split of the
 * U+2212 minus sign into its own run, not a separate word — everything else
 * gets a normal single space. Mirrors maxim-register-map.ts's joinText.
 */
function joinText(items: PositionedText[]): string {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i === 0) {
      out = it.str;
      continue;
    }
    const prev = items[i - 1];
    const gap = it.x - (prev.x + prev.width);
    out += (gap <= GLYPH_ADJACENT_EPS ? "" : " ") + it.str;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Microchip-style per-bit layout: each named cell snaps to its nearest bit
 *  column (mirrors register-table.ts's parseBitFieldsPerBit). */
function parseBitFields(cells: PositionedText[], bitCenters: number[]): BitField[] {
  const fields: BitField[] = [];
  for (const cell of cells) {
    const name = cell.str.trim();
    if (!name || name === "—" || name === "-" || /^[01]$/.test(name)) continue;
    const c = centerX(cell);
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
    if (idx < 0) continue;
    fields.push({ name, msb: idx, lsb: idx });
  }
  fields.sort((a, b) => b.msb - a.msb);
  return fields;
}

/** Parse an onsemi register-map table from a single page, if it holds one. */
export function parseOnsemiRegisterTable(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const band = findHeaderBand(rows);
  if (!band) return undefined;
  const cols = columnsFromHeader(band.header);
  if (!cols) return undefined;

  const body = rows.filter((r) => r.y < band.bandBottom).sort((a, b) => b.y - a.y);

  const registers: Register[] = [];
  let i = 0;
  while (i < body.length) {
    const row = body[i];
    const rawAddress = cellsIn(row, cols, "address")
      .map((it) => it.str)
      .join("")
      .trim();
    // Leave the table body once a row has no recognizable single-register
    // address — this is what correctly excludes the trailing "Reserved 02h,
    // 04h, …" recap row (its address cell is a comma-joined multi-address
    // list, not a single one) without any RESERVED-name special-casing.
    if (!isRegisterAddress(rawAddress)) break;

    // A register's title occasionally wraps onto a trailing name-only line
    // (see file header) — gather up to WRAP_GAP-distant continuation rows.
    const nameParts = [joinText(cellsIn(row, cols, "name"))];
    let cur = row;
    let j = i + 1;
    while (j < body.length) {
      const next = body[j];
      if (cur.y - next.y > WRAP_GAP) break;
      const nextAddress = cellsIn(next, cols, "address")
        .map((it) => it.str)
        .join("")
        .trim();
      if (isRegisterAddress(nextAddress) || !isNameOnly(next, cols)) break;
      nameParts.push(joinText(cellsIn(next, cols, "name")));
      cur = next;
      j++;
    }

    const name = nameParts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const reset = normalizeReset(joinText(cellsIn(row, cols, "reset")));
    const bitFields = parseBitFields(cellsIn(row, cols, "bit"), cols.bitCenters);

    registers.push({
      name,
      address: normalizeRegisterAddress(rawAddress) ?? rawAddress,
      reset,
      bitFields,
    });
    i = j;
  }

  return { page: page.index, registers };
}

/** Scan pages and return the first onsemi register-map table found (matches
 *  ti-command-byte.ts's simple first-page-with-rows semantics — the table
 *  has never been observed split across pages). */
export function findOnsemiRegisterTable(pages: PageContent[]): RegisterTable | undefined {
  for (const page of pages) {
    const table = parseOnsemiRegisterTable(page);
    if (table && table.registers.length > 0) return table;
  }
  return undefined;
}
