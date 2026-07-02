// L4a (register path) — reconstruct a register map table from positioned text.
//
// Strategy: find the header row ("Register Name | Address | bit7..bit0 | Reset
// state"), derive column boundaries and per-bit x-centers from it, then read the
// rows below into registers. Bit-field positions are recovered geometrically:
// each field's horizontal center is matched to the bit-column span (of the width
// implied by its `[hi:lo]` notation) it best aligns with — which correctly
// handles reserved-bit gaps.

import { centerX, clusterRows, type TableRow } from "./table.js";
import type {
  BitField,
  PageContent,
  PositionedText,
  Register,
  RegisterTable,
} from "./types.js";

const HEX = /0x[0-9A-Fa-f]+/;
// name[hi:lo] | name[n] | name<hi:lo> | name<n>
const BITFIELD = /^(.+?)[<[](\d+)(?::(\d+))?[>\]]$/;

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
}

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return (
    cells.includes("registername") &&
    cells.includes("address") &&
    cells.includes("bit7") &&
    cells.includes("bit0")
  );
}

function columnsFromHeader(header: TableRow): Columns | undefined {
  const bitCenters: number[] = [];
  let nameCenter: number | undefined;
  let addrCenter: number | undefined;
  const resetCenters: number[] = [];

  for (const it of header.items) {
    const t = norm(it.str);
    const bit = /^bit([0-7])$/.exec(t);
    if (bit) {
      bitCenters[Number(bit[1])] = centerX(it);
    } else if (t === "registername") {
      nameCenter = centerX(it);
    } else if (t === "address") {
      addrCenter = centerX(it);
    } else if (t === "reset" || t === "state" || t === "resetstate") {
      resetCenters.push(centerX(it));
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

/** Parse a register map table from a single page, if it holds one. */
export function parseRegisterTable(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const header = rows.find(isHeader);
  if (!header) return undefined;
  const cols = columnsFromHeader(header);
  if (!cols) return undefined;

  const below = rows
    .filter((r) => r.y < header.y)
    .sort((a, b) => b.y - a.y);

  const registers: Register[] = [];
  for (const row of below) {
    const name = row.items
      .filter((it) => centerX(it) < cols.nameMax)
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const address = row.items
      .filter((it) => centerX(it) >= cols.nameMax && centerX(it) < cols.addrMax)
      .map((it) => it.str)
      .join("")
      .trim();

    // Once a row below the header has no hex address, we've left the table body.
    if (!HEX.test(address)) break;

    const reset = row.items
      .filter((it) => centerX(it) >= cols.bitMax)
      .map((it) => it.str)
      .join(" ")
      .trim();
    const bitCells = row.items.filter(
      (it) => centerX(it) >= cols.addrMax && centerX(it) < cols.bitMax,
    );

    registers.push({
      name,
      address,
      reset,
      bitFields: parseBitFields(bitCells, cols),
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
