// L4a (ST bit-layout path) — extract per-register bit fields from ST's
// two-stacked-table register format (Section 9 "Register description" of
// datasheets such as the LSM6DSRX): a "Table N. <ACRONYM> register" bit-layout
// table (one row of exactly 8 per-bit columns, leftmost = bit7, values either
// a field-label fragment or a reserved "0"/"1" with a footnote superscript)
// sits directly above a "Table N+1. <ACRONYM> register description" table
// whose left column (x≈102) carries the canonical field names, e.g.
// "ODR_XL[3:0]", "LPF2_XL_EN". Multi-bit fields render as per-bit indexed
// labels (ODR_XL3 ODR_XL2 ...), one per column, and a label may wrap across
// 2-3 vertical rows within a column. This adapter reconstructs the bit
// position of each canonical name by rebuilding the per-bit label from the
// bracket's own index space and looking it up in the layout table — the
// bracket range need not equal the field's physical bit position (see
// FIFO_CTRL2's UNCOPTR_RATE_[1:0]). Deterministic and narrow by design:
// prefer reliable partial coverage over guessing at layouts this doesn't
// recognize. Feeds assembleDatasheet's generic-fallback branch only (the
// specialized BME280/Microchip/TI adapters never call this). See wiki:
// st-bit-layout, generic-register-table.

import { centerX, clusterRows } from "./table.js";
import type { BitField, PageContent, PositionedText } from "./types.js";

// Any table title, used only to bound regions (the floor under a description
// table may be an unrelated title, e.g. "Table 50. Accelerometer ODR
// selection").
const TABLE_TITLE = /^Table\s+[\d.\-–]+\./;
// "Table 48. CTRL1_XL register" — must NOT match "... register description"
// (anchored at the end).
const LAYOUT_TITLE =
  /Table\s+[\d.\-–]+\.\s+([A-Z][A-Z0-9_]+)\s+register$/;
// "Table 49. CTRL1_XL register description".
const DESC_TITLE =
  /Table\s+[\d.\-–]+\.\s+([A-Z][A-Z0-9_]+)\s+register description$/;

// Footnote markers within the bit-layout region: a bare ordinal ("1.") or a
// bare superscript ("(1)"). Both are dropped before column assignment; a
// superscript glued onto a label (defense in depth) is stripped later too.
const FOOTNOTE_MARKER = /^\d+\.$/;
const BARE_SUPERSCRIPT = /^\(\d+\)$/;
const SUPERSCRIPT = /\(\d+\)/g;

// A canonical field name from the description table's left column:
// "ODR_XL[3:0]", "FS[1:0]_XL", "LPF2_XL_EN", "WTM8".
const CANONICAL_NAME = /^[A-Z][A-Z0-9_]*(\[\d+:\d+\])?[A-Z0-9_]*$/;
// A bracketed field name split into its prefix/hi/lo/suffix.
const BRACKET = /^([A-Z0-9_]*)\[(\d+):(\d+)\]([A-Z0-9_]*)$/;

// The description table's left column sits close to the region's leftmost
// edge (x≈102); prose starts well to the right (x≈196+).
const LEFT_COLUMN_TOLERANCE = 40;
// The bit row occupies a narrow vertical band; anything further below (e.g. a
// footnote sentence) is excluded even if it slipped past the token filter.
const BIT_ROW_BAND = 22;

// A register's description table is sometimes the last thing on its page —
// no further `Table N.` title follows to floor the region, so it would
// otherwise run all the way down into the page's running footer (a document
// ID + revision + page number, isolated from real content by a wide gap).
// Real table/prose rows are packed within ~15-25 units of each other; a gap
// this much larger marks the page-margin boundary.
const CONTENT_GAP = 60;

type TitleEvent =
  | { type: "layout"; acronym: string; y: number }
  | { type: "desc"; acronym: string; y: number }
  | { type: "other"; y: number };

/** Classify each title row on a page (top-to-bottom, per `clusterRows`). */
function findTitleEvents(page: PageContent): TitleEvent[] {
  const events: TitleEvent[] = [];
  for (const row of clusterRows(page.items)) {
    const joined = row.items.map((it) => it.str).join(" ");
    if (!TABLE_TITLE.test(joined)) continue;
    const desc = DESC_TITLE.exec(joined);
    if (desc) {
      events.push({ type: "desc", acronym: desc[1], y: row.y });
      continue;
    }
    const layout = LAYOUT_TITLE.exec(joined);
    if (layout) {
      events.push({ type: "layout", acronym: layout[1], y: row.y });
      continue;
    }
    events.push({ type: "other", y: row.y });
  }
  return events;
}

/** Build bit -> label from the bit-layout table's region. */
function buildBitMap(items: PositionedText[]): Map<number, string> {
  const tokens = items.filter((it) => {
    const s = it.str.trim();
    if (!s || /\s/.test(s)) return false;
    if (FOOTNOTE_MARKER.test(s) || BARE_SUPERSCRIPT.test(s)) return false;
    return true;
  });
  if (tokens.length === 0) return new Map();

  const topY = Math.max(...tokens.map((it) => it.y));
  const bitRow = tokens.filter((it) => it.y > topY - BIT_ROW_BAND);
  if (bitRow.length === 0) return new Map();

  const centers = bitRow.map((it) => centerX(it));
  const minC = Math.min(...centers);
  const maxC = Math.max(...centers);
  const colW = (maxC - minC) / 7 || 1;

  const byBit = new Map<number, PositionedText[]>();
  for (const it of bitRow) {
    const raw = Math.round((centerX(it) - minC) / colW);
    const bit = Math.min(7, Math.max(0, 7 - raw));
    const list = byBit.get(bit);
    if (list) list.push(it);
    else byBit.set(bit, [it]);
  }

  const bitMap = new Map<number, string>();
  for (const [bit, list] of byBit) {
    const label = list
      .slice()
      .sort((a, b) => b.y - a.y)
      .map((it) => it.str.trim())
      .join("")
      .replace(SUPERSCRIPT, "");
    if (label === "0" || label === "1") continue; // reserved
    bitMap.set(bit, label);
  }
  return bitMap;
}

/** Canonical field names from the description table's left column. */
function canonicalNames(items: PositionedText[]): string[] {
  // Restrict to identifier-shaped tokens first, then derive the left column's
  // x from THOSE alone. The floor bounding this region is the next `Table N.`
  // title, which in the real datasheet can trail past the description
  // table's actual end into the next register's subsection heading/intro
  // prose (e.g. "9.2 PIN_CTRL (02h)" at x≈42) — computing the left edge from
  // every item in the region would let that stray heading (never
  // identifier-shaped) drag the reference point away from the true x≈102
  // name column. Distinguish the name column from the prose column by the
  // item's own left edge, not its centerX — a long field name (e.g.
  // "UNCOPTR_RATE_[1:0]") still starts flush at x≈102 even though its center
  // drifts well past a fixed offset from the region's leftmost edge.
  const candidates = items.filter((it) => CANONICAL_NAME.test(it.str.trim()));
  if (candidates.length === 0) return [];
  const minLeftX = Math.min(...candidates.map((it) => it.x));
  const names: string[] = [];
  for (const it of candidates) {
    if (Math.abs(it.x - minLeftX) > LEFT_COLUMN_TOLERANCE) continue;
    names.push(it.str.trim());
  }
  return names;
}

/**
 * The lowest y still considered part of the description table's real content
 * when no further title bounds it on the page (see `CONTENT_GAP`).
 */
function contentFloor(page: PageContent, descTitleY: number): number {
  const rows = clusterRows(page.items)
    .filter((r) => r.y < descTitleY)
    .sort((a, b) => b.y - a.y);
  let prevY = descTitleY;
  for (const row of rows) {
    if (prevY - row.y > CONTENT_GAP) return row.y;
    prevY = row.y;
  }
  return -Infinity;
}

/** Clean a bracket's prefix+suffix concatenation into a field name. */
function cleanName(raw: string): string {
  return raw.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

/** Resolve one canonical name to its bit field via the layout's bit map. */
function correlate(
  name: string,
  bitMap: Map<number, string>,
): BitField | undefined {
  const bracket = BRACKET.exec(name);
  if (bracket) {
    const [, prefix, hiStr, loStr, suffix] = bracket;
    const hi = Number(hiStr);
    const lo = Number(loStr);
    const bits: number[] = [];
    for (let idx = lo; idx <= hi; idx++) {
      const label = `${prefix}${idx}${suffix}`;
      let found: number | undefined;
      for (const [bit, lbl] of bitMap) {
        if (lbl === label) {
          found = bit;
          break;
        }
      }
      if (found === undefined) return undefined;
      bits.push(found);
    }
    return {
      name: cleanName(prefix + suffix),
      msb: Math.max(...bits),
      lsb: Math.min(...bits),
    };
  }
  for (const [bit, lbl] of bitMap) {
    if (lbl === name) return { name, msb: bit, lsb: bit };
  }
  return undefined;
}

/** Map each ST register acronym to its bit fields (msb-first, deduped). */
export function findStBitFields(
  pages: PageContent[],
): Map<string, BitField[]> {
  const out = new Map<string, BitField[]>();

  for (const page of pages) {
    const events = findTitleEvents(page);
    for (let i = 0; i < events.length; i++) {
      const layoutEvt = events[i];
      if (layoutEvt.type !== "layout") continue;
      const descEvt = events[i + 1];
      if (
        !descEvt ||
        descEvt.type !== "desc" ||
        descEvt.acronym !== layoutEvt.acronym
      ) {
        continue;
      }
      const nextEvt = events[i + 2];
      const floor = nextEvt ? nextEvt.y : contentFloor(page, descEvt.y);

      const layoutItems = page.items.filter(
        (it) => it.y > descEvt.y && it.y < layoutEvt.y,
      );
      const descItems = page.items.filter(
        (it) => it.y > floor && it.y < descEvt.y,
      );

      const bitMap = buildBitMap(layoutItems);
      const names = canonicalNames(descItems);

      const seen = new Set<string>();
      const fields: BitField[] = [];
      for (const name of names) {
        const field = correlate(name, bitMap);
        if (!field) continue;
        const key = `${field.msb}:${field.lsb}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fields.push(field);
      }
      if (fields.length === 0) continue;
      fields.sort((a, b) => b.msb - a.msb);
      if (!out.has(layoutEvt.acronym)) out.set(layoutEvt.acronym, fields);
    }
  }

  return out;
}
