// L4a (TI register path) — extract Texas Instruments' register-summary table.
//
// TI datasheets (e.g. TMAG5170) don't use a single BME280/Microchip-style bit
// table; they list registers in a plain "Register Map" summary table
// ("Table 7-4. … Registers": Offset | Acronym | Register Name | Section) and put
// the bit fields in separate per-register sections. This adapter parses that
// summary — enough to produce a validated register list (name = acronym,
// address = the offset) that codegen turns into address #defines. Bit-field
// extraction from the per-register tables is a separate, 16-bit-aware follow-up.

import { findTiFieldDescriptions } from "./ti-field-descriptions.js";
import { clusterRows, type TableRow } from "./table.js";
import type { PageContent, Register, RegisterTable } from "./types.js";

const OFFSET = /^([0-9A-Fa-f]{1,2})h$/; // bare hex + "h": "0h", "8h", "10h"
const ACRONYM = /^[A-Z][A-Z0-9_]+$/; // register acronym: DEVICE_CONFIG, X_CH_RESULT

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  return cells.includes("offset") && cells.includes("acronym");
}

/** "0h"/"Ah"/"10h" -> "0x00"/"0x0A"/"0x10". */
function normalizeAddress(raw: string): string {
  const m = OFFSET.exec(raw);
  return m ? `0x${m[1].toUpperCase().padStart(2, "0")}` : raw;
}

/** Parse the Table 7-4 fragment on a single page (rows below its header). */
export function parseTiRegisterMap(
  page: PageContent,
): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const header = rows.find(isHeader);
  if (!header) return undefined;

  const below = rows.filter((r) => r.y < header.y).sort((a, b) => b.y - a.y);
  const registers: Register[] = [];
  for (const row of below) {
    const toks = row.items.map((it) => it.str.trim()).filter(Boolean);
    // A register row is `<offset> <ACRONYM> …`. Anything else (prose, the
    // "0h = 1x …" bit-value decoys whose 2nd token is "=") ends the table.
    if (toks.length < 2 || !OFFSET.test(toks[0]) || !ACRONYM.test(toks[1])) {
      break;
    }
    registers.push({
      name: toks[1],
      address: normalizeAddress(toks[0]),
      reset: "",
      bitFields: [],
    });
  }
  return { page: page.index, registers };
}

/** Accumulate the (possibly page-continued) TI register-summary table. */
export function findTiRegisterMap(
  pages: PageContent[],
): RegisterTable | undefined {
  let firstPage: number | undefined;
  const registers: Register[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const frag = parseTiRegisterMap(page);
    if (frag && frag.registers.length > 0) {
      if (firstPage === undefined) firstPage = frag.page;
      for (const r of frag.registers) {
        if (!seen.has(r.address)) {
          seen.add(r.address);
          registers.push(r);
        }
      }
    } else if (firstPage !== undefined) {
      break; // the summary table ended on the previous page
    }
  }

  if (firstPage === undefined) return undefined;

  // Enrich the summary with per-register bit fields from the separate "Register
  // Field Descriptions" tables (16-bit registers — see ti-field-descriptions and
  // register-width). Registers without a field table stay address-only (width 8).
  const detail = findTiFieldDescriptions(pages);
  for (const r of registers) {
    const table = detail.get(r.name);
    if (table) {
      r.width = table.width;
      r.bitFields = table.bitFields;
    }
  }

  return { page: firstPage, registers };
}
