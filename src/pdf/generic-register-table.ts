// L4a (generic fallback) — a role-based register-table extractor that runs ONLY
// when the two specialized adapters (register-table, ti-register-map) find nothing.
// It recognizes an arbitrary vendor's "register address map" by column ROLE
// (a name column + an address column), not by literal header tokens, so ST /
// Broadcom / Infineon-style tables that don't match the specialized shapes still
// yield a register list (name + address → a `partial` extraction). Bit fields are
// left to the specialized adapters / host AI. See wiki: graceful-degradation,
// generic-register-table.

import { normalizeRegisterAddress, isRegisterAddress } from "./address.js";
import { centerX, clusterRows, type TableRow } from "./table.js";
import type { PageContent, Register, RegisterTable } from "./types.js";

type Role = "name" | "address" | "reset" | "other";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Column-role synonyms — deliberately broad, matched against a header cell's whole
// (normalized) text. `address` is checked first so "register address" beats the
// bare "register" name synonym.
const ROLE_ADDR = /^(address|addr|offset|sub-?address|reg|register address|hex|\(hex\))$/;
const ROLE_NAME = /^(register name|register|name|symbol|acronym|mnemonic)$/;
const ROLE_RESET = /^(reset|reset value|default|default value|por|por\/rst|initial)$/;

// A hex span like "2E-34" — a reserved-address gap, not a single register.
const RANGE = /[0-9a-f]{1,4}\s*[-–—…]\s*[0-9a-f]{1,4}/i;

// Header lines may stack across a band (e.g. ST: "Register address" over "Hex"/
// "Binary"); merge non-data rows within this vertical span into one header.
const BAND = 18;
// Guard against false-positive tables: a real register map has several rows.
const MIN_ROWS = 3;

interface HeaderCol {
  center: number;
  role: Role;
}

function roleOf(cell: string): Role {
  const n = norm(cell);
  if (ROLE_ADDR.test(n)) return "address";
  if (ROLE_NAME.test(n)) return "name";
  if (ROLE_RESET.test(n)) return "reset";
  return "other";
}

/** A data row is anything carrying a single register-address value. */
const isDataRow = (r: TableRow) => r.items.some((it) => isRegisterAddress(it.str));

/** The header column whose center is nearest x (assigns cells regardless of order). */
function nearestCol(cols: HeaderCol[], x: number): HeaderCol {
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

/** Find the header band: the first non-data row (grown over nearby non-data rows)
 *  that carries BOTH a name-role and an address-role column. */
function findHeader(
  rows: TableRow[],
): { cols: HeaderCol[]; bottomY: number } | undefined {
  for (let i = 0; i < rows.length; i++) {
    if (isDataRow(rows[i])) continue;
    let items = [...rows[i].items];
    let bottomY = rows[i].y;
    for (
      let j = i + 1;
      j < rows.length && rows[i].y - rows[j].y <= BAND && !isDataRow(rows[j]);
      j++
    ) {
      items = items.concat(rows[j].items);
      bottomY = rows[j].y;
    }
    const cols: HeaderCol[] = items.map((it) => ({
      center: centerX(it),
      role: roleOf(it.str),
    }));
    if (cols.some((c) => c.role === "name") && cols.some((c) => c.role === "address")) {
      return { cols, bottomY };
    }
  }
  return undefined;
}

/** Parse a generic register map from a single page, if it holds one. */
export function parseGenericRegisterTable(
  page: PageContent,
): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const header = findHeader(rows);
  if (!header) return undefined;

  const { cols, bottomY } = header;
  const below = rows.filter((r) => r.y < bottomY).sort((a, b) => b.y - a.y);

  const registers: Register[] = [];
  for (const row of below) {
    const nameParts: string[] = [];
    let address: string | undefined;
    let sawRange = false;

    for (const it of row.items) {
      const col = nearestCol(cols, centerX(it));
      const s = it.str.trim();
      if (col.role === "name") {
        if (s) nameParts.push(s);
      } else if (col.role === "address") {
        const a = normalizeRegisterAddress(s);
        if (a && address === undefined) address = a;
        else if (!a && RANGE.test(s)) sawRange = true;
      }
    }

    const name = nameParts.join(" ").replace(/\s+/g, " ").trim();
    if (address === undefined) {
      // A reserved-gap row (named, with a range) is skipped; anything else with a
      // name but no address is the row after the table — stop there.
      if (name && (sawRange || /^reserved$/i.test(name))) continue;
      break;
    }
    if (/^reserved$/i.test(name)) continue;
    if (!name) break;
    registers.push({ name, address, reset: "", bitFields: [] });
  }

  return { page: page.index, registers };
}

/** Scan pages; return the first qualifying generic register table (≥ MIN_ROWS). */
export function findGenericRegisterTable(
  pages: PageContent[],
): RegisterTable | undefined {
  for (const page of pages) {
    const table = parseGenericRegisterTable(page);
    if (table && table.registers.length >= MIN_ROWS) return table;
  }
  return undefined;
}
