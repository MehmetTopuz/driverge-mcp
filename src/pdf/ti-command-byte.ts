// L4a (TI command-byte path) — extract Texas Instruments' "Command Byte" table
// shape (e.g. TCA6408A-Q1's Table 8-4): a per-bit command-byte encoding table
// (8 "B7".."B0" columns + a "(HEX)"-labeled command byte, paired with the
// REGISTER it selects, its access PROTOCOL, and its POWER-UP DEFAULT). This is
// a DIFFERENT TI shape from ti-register-map.ts's Offset|Acronym register
// summary — it documents which *register* a command byte selects, not that
// register's own bit layout, so every row becomes an address-only register
// (bitFields always []). Chained into assembleDatasheet's buildInterface right
// after findTiRegisterMap, so it only ever fires when that adapter (and
// findRegisterTable before it) found nothing. See wiki: register-width,
// generic-register-table.

import { normalizeRegisterAddress } from "./address.js";
import { normalizeReset } from "./register-table.js";
import { centerX, clusterRows, type TableRow } from "./table.js";
import type {
  PageContent,
  PositionedText,
  Register,
  RegisterTable,
} from "./types.js";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// A stacked "POWER-UP"/"DEFAULT" sub-header line (the real sheet's two-line
// reset-column header, split further than clusterRows' default row tolerance
// merges) sits only a few units below the main header row — much closer than
// the next real data row (~14+ units away on the real sheet) — so a small gap
// threshold safely folds it into the header band without ever swallowing a
// data row.
const SUBHEADER_GAP = 8;

const headerCells = (row: TableRow): string[] => row.items.map((it) => norm(it.str));

// Deliberately narrow: COMMAND BYTE + (HEX) + REGISTER anchor the shape, and a
// 4th keyword (PROTOCOL, or the POWER-UP/DEFAULT reset pair) is required too,
// so this can never fire on another vendor's table — nor on TI's OWN other
// register-summary shape (ti-register-map.ts's Offset|Acronym table, which
// shares none of these column labels).
function isHeader(cells: string[]): boolean {
  return (
    cells.includes("commandbyte") &&
    cells.includes("(hex)") &&
    cells.includes("register") &&
    (cells.includes("protocol") || cells.includes("power-up") || cells.includes("default"))
  );
}

/**
 * Find the Command Byte header band. Anchors on the row carrying the literal
 * "COMMAND BYTE" cell, then folds in any closely-stacked sub-header line(s)
 * (see SUBHEADER_GAP) before checking the combined cell set against isHeader.
 */
function findHeaderBand(
  rows: TableRow[],
): { items: PositionedText[]; bandBottom: number } | undefined {
  for (let i = 0; i < rows.length; i++) {
    if (!headerCells(rows[i]).includes("commandbyte")) continue;
    let merged = [...rows[i].items];
    let bandBottom = rows[i].y;
    let prevY = rows[i].y;
    for (let j = i + 1; j < rows.length; j++) {
      if (prevY - rows[j].y > SUBHEADER_GAP) break;
      merged = merged.concat(rows[j].items);
      bandBottom = rows[j].y;
      prevY = rows[j].y;
    }
    if (isHeader(merged.map((it) => norm(it.str)))) {
      return { items: merged, bandBottom };
    }
  }
  return undefined;
}

type ColRole = "hex" | "register" | "reset" | "other";
interface Col {
  center: number;
  role: ColRole;
}

/**
 * Column centers from the header band, classified by role. The address column
 * anchors on the "(HEX)" cell (falling back to "COMMAND BYTE" only when no
 * "(HEX)" cell exists); every other cell — bit-position labels, the "CONTROL
 * REGISTER BITS" span label, PROTOCOL — becomes an unlabeled "other" column so
 * nearest-column matching below still steers data cells away from it.
 */
function columnsFromHeader(items: PositionedText[]): Col[] | undefined {
  const hasHex = items.some((it) => norm(it.str) === "(hex)");
  const cols: Col[] = [];
  let sawRegister = false;
  let sawReset = false;

  for (const it of items) {
    const t = norm(it.str);
    if (t === "(hex)") {
      cols.push({ center: centerX(it), role: "hex" });
    } else if (t === "commandbyte" && !hasHex) {
      cols.push({ center: centerX(it), role: "hex" });
    } else if (t === "register") {
      cols.push({ center: centerX(it), role: "register" });
      sawRegister = true;
    } else if (t === "power-up" || t === "default") {
      cols.push({ center: centerX(it), role: "reset" });
      sawReset = true;
    } else {
      cols.push({ center: centerX(it), role: "other" });
    }
  }

  if (!sawRegister || !sawReset || !cols.some((c) => c.role === "hex")) return undefined;
  return cols;
}

/** The header column whose center is nearest x (assigns cells regardless of column order). */
function nearestCol(cols: Col[], x: number): Col {
  let best = cols[0];
  let dist = Infinity;
  for (const c of cols) {
    const e = Math.abs(c.center - x);
    if (e < dist) {
      dist = e;
      best = c;
    }
  }
  return best;
}

/** One Command Byte data row -> an address-only register, or undefined once the
 *  row's (HEX)-nearest cell(s) don't normalize to a register address — the
 *  table-end guard that keeps trailing footer prose from being swallowed. */
function parseDataRow(row: TableRow, cols: Col[]): Register | undefined {
  const hexParts: string[] = [];
  const nameParts: string[] = [];
  const resetParts: string[] = [];

  for (const it of row.items) {
    const s = it.str.trim();
    if (!s) continue;
    const col = nearestCol(cols, centerX(it));
    if (col.role === "hex") hexParts.push(s);
    else if (col.role === "register") nameParts.push(s);
    else if (col.role === "reset") resetParts.push(s);
  }

  const address = normalizeRegisterAddress(hexParts.join(""));
  if (!address) return undefined;

  const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
  const reset = normalizeReset(resetParts.join(" ").trim());
  return { name, address, reset, bitFields: [] };
}

/** Parse the Command Byte table fragment on a single page, if it holds one. */
export function parseTiCommandByteTable(
  page: PageContent,
): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const band = findHeaderBand(rows);
  if (!band) return undefined;
  const cols = columnsFromHeader(band.items);
  if (!cols) return undefined;

  const below = rows.filter((r) => r.y < band.bandBottom).sort((a, b) => b.y - a.y);

  const registers: Register[] = [];
  for (const row of below) {
    const register = parseDataRow(row, cols);
    if (!register) break; // footer prose (or any non-data row) ends the table
    registers.push(register);
  }
  return { page: page.index, registers };
}

/** Scan pages and return the first Command Byte table found (first-page semantics —
 *  unlike ti-register-map's Offset|Acronym summary, this table has never been
 *  observed split across pages). */
export function findTiCommandByteTable(
  pages: PageContent[],
): RegisterTable | undefined {
  for (const page of pages) {
    const table = parseTiCommandByteTable(page);
    if (table && table.registers.length > 0) return table;
  }
  return undefined;
}
