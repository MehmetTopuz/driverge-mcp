// L4a (TI bit-field path) — extract per-register bit fields from Texas
// Instruments' "Register Field Descriptions" tables (e.g. TMAG5170). These sit
// separately from the register-summary table parsed by ti-register-map: each is
// titled "Table 7-N. <ACRONYM> Register Field Descriptions" and lists one field
// per row as `Bit | Field | Type | Reset | Description`, where Bit is a single
// index ("15") or a range ("14-12" hyphen / "5:0" colon, per-datasheet). The
// register width follows the highest bit seen (TMAG5170's reach 15 → 16-bit;
// TUSS4470's stop at 7 → 8-bit — see widthFor).
// Returns acronym -> bit fields, which ti-register-map merges into its summary.
// See wiki: register-width, generic-register-table.

import { centerX, clusterRows, type TableRow } from "./table.js";
import type { BitField, PageContent } from "./types.js";

// "Table 7-6. DEVICE_CONFIG Register Field Descriptions" (+ optional "(continued)").
const TITLE =
  /Table\s+[\d.\-–]+\.\s+([A-Z][A-Z0-9_]+)\s+Register Field Descriptions/;
// A Bit cell: a single index or an "msb-lsb" span. The span separator varies
// by TI datasheet generation: TMAG5170 prints a hyphen ("14-12"), TUSS4470 a
// colon ("5:0") — hyphen-only silently dropped every multi-bit TUSS field
// while keeping the single-bit ones, yielding a misleading partial bit list
// (STM32 field test, Unit 3).
const BIT = /^(\d{1,2})(?:[-:](\d{1,2}))?$/;
// The Bit column sits at the far left (x≈76); enum-continuation rows start at the
// Description column (x≈308), so this bound rejects them.
const BIT_X_MAX = 100;

// A TI field acronym (CONV_AVG, T_CH_EN, RESERVED). Rejects footer text like
// "Submit Document Feedback" whose page-number cell can masquerade as a Bit value.
const FIELD_NAME = /^[A-Z][A-Z0-9_]*$/;

/** A field row → its bit field, or undefined if the row isn't one. */
function fieldFromRow(row: TableRow): BitField | undefined {
  const cells = [...row.items].sort((a, b) => a.x - b.x);
  const bitCell = cells[0];
  const nameCell = cells[1];
  if (!bitCell || !nameCell || centerX(bitCell) > BIT_X_MAX) return undefined;
  const m = BIT.exec(bitCell.str.trim());
  if (!m) return undefined;
  const hi = Number(m[1]);
  const lo = m[2] !== undefined ? Number(m[2]) : hi;
  const msb = Math.max(hi, lo);
  // A register bit can't exceed 31 (a "34" is a footer page number, not a bit).
  if (msb > 31) return undefined;
  const name = nameCell.str.trim();
  if (!FIELD_NAME.test(name)) return undefined;
  return { name, msb, lsb: Math.min(hi, lo) };
}

/** A register's extracted bit-field detail. */
export interface FieldTable {
  /** 8/16/32, from the highest bit index seen (RESERVED bits included). */
  width: number;
  /** Named (non-RESERVED) fields, msb-first. */
  bitFields: BitField[];
}

interface Acc {
  maxBit: number;
  bitFields: BitField[];
  seen: Set<string>;
}

const widthFor = (maxBit: number): number =>
  maxBit >= 16 ? 32 : maxBit >= 8 ? 16 : 8;

/** Map each register acronym to its Field Descriptions detail (width + fields). */
export function findTiFieldDescriptions(
  pages: PageContent[],
): Map<string, FieldTable> {
  const acc = new Map<string, Acc>();

  for (const page of pages) {
    // Require the field-descriptions title on the page (TI repeats it, even on
    // "(continued)" pages), so unrelated pages with a stray left-column number
    // never contribute fields.
    let current: string | undefined;
    for (const row of clusterRows(page.items)) {
      const title = TITLE.exec(row.items.map((it) => it.str).join(" "));
      if (title) {
        current = title[1];
        if (!acc.has(current)) {
          acc.set(current, { maxBit: -1, bitFields: [], seen: new Set() });
        }
        continue;
      }
      if (!current) continue;

      const field = fieldFromRow(row);
      if (!field) continue;
      const entry = acc.get(current);
      if (!entry) continue;
      // RESERVED bits still count toward the register width, but aren't emitted.
      entry.maxBit = Math.max(entry.maxBit, field.msb);
      if (/^reserved$/i.test(field.name)) continue;
      const key = `${field.msb}:${field.lsb}`;
      if (entry.seen.has(key)) continue;
      entry.seen.add(key);
      entry.bitFields.push(field);
    }
  }

  const out = new Map<string, FieldTable>();
  for (const [acronym, entry] of acc) {
    if (entry.bitFields.length === 0) continue;
    entry.bitFields.sort((a, b) => b.msb - a.msb);
    out.set(acronym, { width: widthFor(entry.maxBit), bitFields: entry.bitFields });
  }
  return out;
}
