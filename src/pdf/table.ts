// Generic table reconstruction over positioned text: cluster items into rows by
// vertical proximity. Column assignment is caller-specific (see register-table).

import type { PositionedText } from "./types.js";

export interface TableRow {
  /** Representative y (the top-most y of the cluster). */
  y: number;
  /** Row items, left-to-right. */
  items: PositionedText[];
}

/**
 * Group positioned text into rows. Items whose y is within `yTolerance` of an
 * open row join it (datasheet rows often split a pixel or two across baselines).
 * Rows come back top-to-bottom; items within a row left-to-right.
 */
export function clusterRows(
  items: PositionedText[],
  yTolerance = 5,
): TableRow[] {
  const sorted = items
    .filter((it) => it.str.trim() !== "")
    .sort((a, b) => b.y - a.y);

  // Group by the gap to the *previous* item (not a fixed anchor), so a header
  // like "Reset" / "state" split a few px apart still lands in one row.
  const rows: TableRow[] = [];
  let prevY: number | undefined;
  for (const it of sorted) {
    if (rows.length > 0 && prevY !== undefined && prevY - it.y <= yTolerance) {
      rows[rows.length - 1].items.push(it);
    } else {
      rows.push({ y: it.y, items: [it] });
    }
    prevY = it.y;
  }

  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

/** Horizontal center of a positioned item. */
export function centerX(it: { x: number; width: number }): number {
  return it.x + it.width / 2;
}
