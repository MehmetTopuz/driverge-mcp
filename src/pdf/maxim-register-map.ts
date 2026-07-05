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
// bit-field label, across the line(s) ABOVE and BELOW the data row itself (the
// label is vertically centered on the row, so it renders split — e.g.
// MAX30102's "Mode" / <data row> / "Configuration", or a label split across
// TWO lines on the SAME side, "A_" / "FULL_" (on the data row) / "EN"). Those
// wrap lines sit within a few px of each other (much closer than the gap to
// any unrelated content), so a chain of such lines on either side of a
// valid-address row is folded into that register instead of ending the table
// — see WRAP_GAP/WRAP_CHAIN_MAX and gatherChain below.
//
// A single page frequently carries MORE THAN ONE of these recap sections back
// to back (e.g. "Interrupt Enable (0x02-0x03)" then "FIFO (0x04-0x07)"), so
// this adapter scans every header band on a page (findHeaderBands), not just
// the first — each section's body is bounded below by the NEXT section's
// header (or the page end) so sections never bleed into each other.
//
// See wiki: cross-vendor-coverage-scorecard, pdf-parsing-pipeline.

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
// Max vertical gap (px) between consecutive lines of a wrapped name/bit-label
// chain. Comfortably above the ~5-6px real-world wrap gap and comfortably
// below the ~15px+ gap between distinct registers/sections.
const WRAP_GAP = 8;
// Max hops a chain of WRAP_GAP-sized steps may take — either to reach an
// anchor row (chainsToAnchor, deciding whether a row ends the table) or to
// gather wrap fragments into a register (gatherChain). A label occasionally
// wraps across MORE than one line on either side of its data row (e.g.
// MAX30102's interrupt-enable names split "A_" / "FULL_" (on the data row) /
// "EN", three lines deep).
const WRAP_CHAIN_MAX = 3;
// Max vertical gap (px) between two adjacent registers' OWN anchor rows for
// their (otherwise unrelated-looking) names to be considered two halves of
// ONE shared title — see mergeSplitTitles. Hand-verified against the real
// fixture: LED Pulse Amplitude's 0x0C/0x0D anchors sit 14.4px apart (must
// merge); Revision ID/Part ID's 0xFE/0xFF anchors sit 15.85px apart (must
// NOT merge, they're genuinely different registers) — 15 sits cleanly
// between the two.
const TITLE_SPLIT_GAP = 15;
// Wider gap tolerance used ONLY when the wrap candidate is a bare name-only
// line (see isNameOnly): a title's second/third physical line sits a little
// farther from the data row than a bit-label fragment does (hand-verified:
// SpO2 Configuration's "Configuration" sits 11px below its anchor — over
// WRAP_GAP but a genuine title line, not a section-ending decoy, which sit
// 14.5px+ away — see PART ID/DIE TEMPERATURE in the file header).
const NAME_WRAP_GAP = 12;
// Two glyph runs are considered part of the SAME token (joined with no
// space) when the gap between them is at or below this — pdfjs renders a
// subscript/superscript ("SpO₂") as separate horizontally-adjacent runs with
// an ~0px gap, versus tens of px between genuinely distinct words.
const GLYPH_ADJACENT_EPS = 1.5;

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
 * Find every header band on the page, folding each into one synthetic row
 * (see file header — "REG"/"POR" and/or "ADDR"/"STATE" commonly sit a
 * physical line away from the main "REGISTER B7..B0 R/W" line). Scanning
 * resumes right after each matched band's folded rows, so a page carrying
 * several recap sections back to back yields one band per section, in order.
 */
function findHeaderBands(
  rows: TableRow[],
): { header: TableRow; bandBottom: number }[] {
  const bands: { header: TableRow; bandBottom: number }[] = [];
  let i = 0;
  while (i < rows.length) {
    let merged: PositionedText[] = [...rows[i].items];
    let bandBottom = rows[i].y;
    let consumedRows = 0;
    for (let k = 0; k < 3; k++) {
      if (isHeader({ y: rows[i].y, items: merged })) {
        consumedRows = k + 1;
        bands.push({ header: { y: rows[i].y, items: merged }, bandBottom });
        break;
      }
      const next = rows[i + k + 1];
      if (!next || rows[i].y - next.y > HEADER_BAND) break;
      merged = merged.concat(next.items);
      bandBottom = next.y;
    }
    i += consumedRows > 0 ? consumedRows : 1;
  }
  return bands;
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

/** True when EVERY item in the row is in the name column — a bare subtitle
 * or caption line (e.g. "DIE TEMPERATURE", "PART ID") rather than table data.
 */
function isNameOnly(row: TableRow, cols: Columns): boolean {
  return row.items.length > 0 && row.items.every((it) => regionOf(it, cols) === "name");
}

/**
 * Join a row's cells left-to-right (items already come x-sorted from
 * clusterRows). Two cells with essentially no horizontal gap between them
 * (see GLYPH_ADJACENT_EPS) are glued with no space — pdfjs's own split of a
 * subscript ("SpO" + superscript "2") into separate runs, not two words —
 * everything else gets a normal single space.
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
 * Build a register's bit fields from several cell groups (wrapped
 * name/bit-label continuation lines on either side, plus the data row's own)
 * in top-to-bottom order. Bracketed spans are sized from the bracket and
 * positioned geometrically (never wrap in practice) — except a colon-less
 * top-bit bracket ("NAME[7]") with nothing else in the register's bit region,
 * which is Maxim's own shorthand for the whole byte rather than a literal
 * single-bit flag (hand-verified: MAX30102's PART_ID[7] sits at the same
 * column as REV_ID[7:0] directly above it). Bare cells snap to their nearest
 * column and — since a long bare label can itself wrap across several lines
 * (e.g. "PWR_" above + "RDY" below the data row, both centered on B0, or
 * "A_" / "FULL_" / "EN" straddling it three deep) — fragments landing in the
 * same column concatenate in the order encountered, reconstructing the
 * original label.
 */
function collectBitFields(groups: PositionedText[][], cols: Columns): BitField[] {
  const spanFields: BitField[] = [];
  const byColumn = new Map<number, string[]>();
  const soleCandidate = groups.flat().length === 1 ? groups.flat()[0] : undefined;

  for (const cells of groups) {
    for (const cell of cells) {
      const text = cell.str.trim();
      if (!text || text === "—" || text === "-" || /^[01]$/.test(text)) continue;

      const m = BITFIELD.exec(text);
      if (m) {
        const name = m[1].trim();
        const hi = Number(m[2]);
        let width = m[3] !== undefined ? hi - Number(m[3]) + 1 : 1;
        if (m[3] === undefined && hi === 7 && cell === soleCandidate) width = 8;
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

/**
 * Gather up to WRAP_CHAIN_MAX rows of wrap fragments on one side of an anchor
 * (step = -1 for the lines above, +1 for the lines below), stopping at the
 * first row already consumed by another register, the first anchor, or the
 * first gap over the applicable tolerance — WRAP_GAP normally, or the wider
 * NAME_WRAP_GAP when the candidate is a bare name-only title line (a title's
 * second/third physical line sits a little farther from the data row than a
 * bit-label fragment does; see NAME_WRAP_GAP).
 *
 * A name-only candidate that ALSO sits within NAME_WRAP_GAP of a FURTHER
 * anchor on the same side (i.e. it's sandwiched between two registers, e.g.
 * MAX30102's "Mode Control" between 0x11 and 0x12) is left unclaimed here —
 * it's a title shared by both neighbors, not a one-sided trailing/leading
 * fragment, and is spliced in by mergeSplitTitles' between-anchors sweep
 * instead. A candidate with no such further anchor (e.g. SpO2
 * Configuration's trailing "Configuration", followed only by prose) is
 * claimed normally.
 *
 * Returned index order always reads top-to-bottom (farthest-to-nearest above
 * the anchor, nearest-to-farthest below it) so joining their text/bit-region
 * content reconstructs the original label.
 */
function gatherChain(
  body: TableRow[],
  anchorIdx: number,
  step: -1 | 1,
  isAnchor: (row: TableRow) => boolean,
  consumed: ReadonlySet<number>,
  cols: Columns,
): number[] {
  const indices: number[] = [];
  let cur = body[anchorIdx];
  for (let hop = 1; hop <= WRAP_CHAIN_MAX; hop++) {
    const idx = anchorIdx + step * hop;
    if (idx < 0 || idx >= body.length || consumed.has(idx)) break;
    const candidate = body[idx];
    const gap = step < 0 ? candidate.y - cur.y : cur.y - candidate.y;
    const nameOnly = isNameOnly(candidate, cols);
    const limit = nameOnly ? NAME_WRAP_GAP : WRAP_GAP;
    if (gap > limit || isAnchor(candidate)) break;
    if (nameOnly) {
      const beyond = body[idx + step];
      if (beyond && isAnchor(beyond)) {
        const beyondGap = step < 0 ? beyond.y - candidate.y : candidate.y - beyond.y;
        if (beyondGap <= NAME_WRAP_GAP) break;
      }
    }
    indices.push(idx);
    cur = candidate;
  }
  return step < 0 ? indices.reverse() : indices;
}

/**
 * True when a row's own name-region text sits at a DIFFERENT y than that same
 * row's address cell — the signature of clusterRows having glued a
 * neighboring line's fragment onto this row's cluster (see mergeSplitTitles)
 * rather than the name genuinely belonging to this data row. A row built from
 * a single uniform y (every real single-line row, and every synthetic test
 * row) never trips this.
 */
function hasForeignOwnName(row: TableRow, cols: Columns): boolean {
  const nameItems = cellsIn(row, cols, "name");
  const addressItems = cellsIn(row, cols, "address");
  if (nameItems.length === 0 || addressItems.length === 0) return false;
  const addressY = addressItems[0].y;
  return nameItems.every((it) => it.y !== addressY);
}

/**
 * A register whose datasheet title is split across physical lines that got
 * attributed to a DIFFERENT adjacent register's own row (e.g. MAX30102's "LED
 * Pulse" / "Amplitude" landing on 0x0C's and 0x0D's rows respectively via
 * clusterRows' ordinary tolerance, rather than as wrap lines this adapter's
 * own chain-gathering would fold together) ends up with a half-name instead
 * of the one shared title. Two adjacent registers are merge candidates only
 * when BOTH carry a "foreign" own-name (glued from a different y, see
 * hasForeignOwnName) — genuinely distinct back-to-back registers (e.g.
 * Interrupt Status 1/2) never have foreign own-names, since their names come
 * from prefix/suffix wrap chains, not a glued same-row fragment.
 *
 * Two shapes trigger the merge:
 *  - the anchors sit within TITLE_SPLIT_GAP of each other (LED Pulse /
 *    Amplitude: 12.7px apart), or
 *  - every row STRICTLY BETWEEN the two anchors that isn't already claimed by
 *    a wrap chain is a bare name-only title line (Multi-LED / "Mode Control"
 *    / Registers: the middle line sits ~9.7-11px from EITHER anchor — past
 *    WRAP_GAP and NAME_WRAP_GAP both — so gatherChain never claims it, but
 *    it's still unambiguously the shared title's middle third, spliced into
 *    the combined name in y-order). A genuinely unrelated, non-name-only row
 *    sitting between the two (prose, another field) blocks the merge outright.
 */
function mergeSplitTitles(
  records: { reg: Register; y: number; rowIdx: number; foreignName: boolean }[],
  body: TableRow[],
  cols: Columns,
  consumed: ReadonlySet<number>,
): void {
  for (let i = 0; i + 1 < records.length; i++) {
    const a = records[i];
    const b = records[i + 1];
    if (!a.foreignName || !b.foreignName) continue;

    // Rows already folded into a's or b's own wrap chain are already
    // accounted for in their names — skip rather than double-count or block.
    const between: TableRow[] = [];
    let blocked = false;
    for (let idx = a.rowIdx + 1; idx < b.rowIdx; idx++) {
      if (consumed.has(idx)) continue;
      const row = body[idx];
      if (isNameOnly(row, cols)) {
        between.push(row);
      } else {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    if (between.length === 0 && a.y - b.y > TITLE_SPLIT_GAP) continue;

    const an = a.reg.name.toLowerCase();
    const bn = b.reg.name.toLowerCase();
    if (!an || !bn || an === bn || an.includes(bn) || bn.includes(an)) continue;

    const betweenNames = between.map((r) => joinText(cellsIn(r, cols, "name"))).filter(Boolean);
    const combined = [a.reg.name, ...betweenNames, b.reg.name].filter(Boolean).join(" ").trim();
    a.reg.name = combined;
    b.reg.name = combined;
  }
}

/** Parse one recap section's body (below its header, above the next section's) into registers. */
function registersForSection(body: TableRow[], cols: Columns): Register[] {
  const isAnchor = (row: TableRow) => isRegisterAddress(joinText(cellsIn(row, cols, "address")));
  const consumed = new Set<number>();
  const records: { reg: Register; y: number; rowIdx: number; foreignName: boolean }[] = [];

  for (let i = 0; i < body.length; i++) {
    if (consumed.has(i)) continue;
    const row = body[i];

    if (!isAnchor(row)) {
      // A bare subtitle/caption (e.g. "DIE TEMPERATURE", "PART ID") never
      // ends the table — it carries no data of its own, and more registers
      // routinely follow it a few lines down.
      if (isNameOnly(row, cols)) continue;
      if (chainsToAnchor(body, i, isAnchor)) continue; // leads into the next register
      break; // a genuine decoy/unrelated row — ends the table body
    }

    const prefixIdx = gatherChain(body, i, -1, isAnchor, consumed, cols);
    const suffixIdx = gatherChain(body, i, 1, isAnchor, consumed, cols);
    for (const idx of prefixIdx) consumed.add(idx);
    for (const idx of suffixIdx) consumed.add(idx);
    const prefixRows = prefixIdx.map((idx) => body[idx]);
    const suffixRows = suffixIdx.map((idx) => body[idx]);

    const name = [
      ...prefixRows.map((r) => joinText(cellsIn(r, cols, "name"))),
      joinText(cellsIn(row, cols, "name")),
      ...suffixRows.map((r) => joinText(cellsIn(r, cols, "name"))),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // A reserved-range row ("0x13-0x17", "0x18-0x1E", ...) prints its address
    // as two fragments straddling the anchor; only the tail ("0x17") reads as
    // a valid single address, which would otherwise surface as a mangled
    // single-address "RESERVED" register. Mirror the generic extractor and
    // drop it instead (see generic-register-table).
    if (/^reserved$/i.test(name)) continue;

    const bitFields = collectBitFields(
      [
        ...prefixRows.map((r) => cellsIn(r, cols, "bit")),
        cellsIn(row, cols, "bit"),
        ...suffixRows.map((r) => cellsIn(r, cols, "bit")),
      ],
      cols,
    );

    const rawAddress = joinText(cellsIn(row, cols, "address"));
    const reset = joinText(cellsIn(row, cols, "reset"));

    records.push({
      reg: {
        name,
        address: normalizeRegisterAddress(rawAddress) ?? rawAddress,
        reset,
        bitFields,
      },
      y: row.y,
      rowIdx: i,
      foreignName: hasForeignOwnName(row, cols),
    });
  }

  mergeSplitTitles(records, body, cols, consumed);
  return records.map((r) => r.reg);
}

/** Parse a Maxim register-matrix table from a single page, if it holds one. */
export function parseMaximRegisterMap(page: PageContent): RegisterTable | undefined {
  const rows = clusterRows(page.items);
  const bands = findHeaderBands(rows);
  if (bands.length === 0) return undefined;

  const registers: Register[] = [];
  for (let b = 0; b < bands.length; b++) {
    const cols = columnsFromHeader(bands[b].header);
    if (!cols) continue;
    const nextTop = bands[b + 1]?.header.y;
    const body = rows
      .filter((r) => r.y < bands[b].bandBottom && (nextTop === undefined || r.y > nextTop))
      .sort((r1, r2) => r2.y - r1.y);
    registers.push(...registersForSection(body, cols));
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
