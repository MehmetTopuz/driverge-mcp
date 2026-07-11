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
// TUSS4470-style: the offset cell already prints "0x.." (TMAG5170's "Offset"
// column prints bare-hex+"h" instead — both dialects are accepted below).
const HEX_OFFSET = /^0x([0-9A-Fa-f]{1,2})$/i;
const ACRONYM = /^[A-Z][A-Z0-9_]+$/; // register acronym: DEVICE_CONFIG, X_CH_RESULT
// A leading ALL-CAPS identifier glued to trailing human-readable prose in the
// SAME pdfjs item (TUSS4470 field regression: "DEV_STAT Fault status bits",
// "DEVICE_ID Device ID" — the tail isn't reliably lowercase, so the rule
// doesn't require that). Conservative: only the identifier prefix is kept;
// see trimGluedName.
const GLUED_NAME = /^([A-Z][A-Z0-9_]+)\s+(.+)$/;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

function isHeader(row: TableRow): boolean {
  const cells = row.items.map((it) => norm(it.str));
  // "Offset" (TMAG5170) / "Address" (TUSS4470) are both offset-column header
  // synonyms for this table shape.
  return (cells.includes("offset") || cells.includes("address")) && cells.includes("acronym");
}

function isOffsetCell(raw: string): boolean {
  return OFFSET.test(raw) || HEX_OFFSET.test(raw);
}

/** "0h"/"Ah"/"10h" -> "0x00"/"0x0A"/"0x10"; "0x10"/"0x1E" pass through
 *  (already-normalized, idempotent — TUSS4470's own address-cell dialect). */
function normalizeAddress(raw: string): string {
  const bare = OFFSET.exec(raw);
  if (bare) return `0x${bare[1].toUpperCase().padStart(2, "0")}`;
  const hex = HEX_OFFSET.exec(raw);
  if (hex) return `0x${hex[1].toUpperCase().padStart(2, "0")}`;
  return raw;
}

/**
 * Trim a name cell that arrived as ONE glued pdfjs item pairing an ALL-CAPS
 * identifier with trailing description prose down to just the identifier.
 * Never invents a change: an already-clean acronym (no trailing prose) or an
 * all-prose cell (no leading identifier) is returned untouched.
 */
function trimGluedName(raw: string): string {
  if (ACRONYM.test(raw)) return raw;
  const m = GLUED_NAME.exec(raw);
  return m ? m[1] : raw;
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
    // A register row is `<offset> <ACRONYM…> …`. Anything else (prose, the
    // "0h = 1x …" bit-value decoys whose 2nd token is "=") ends the table.
    // The name cell is conservatively trimmed first (see trimGluedName) so a
    // glued "IDENTIFIER prose tail" cell still qualifies as an acronym row.
    if (toks.length < 2 || !isOffsetCell(toks[0])) break;
    const name = trimGluedName(toks[1]);
    if (!ACRONYM.test(name)) break;
    registers.push({
      name,
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
