import { describe, expect, it } from "vitest";
import { findStBitFields } from "../../src/pdf/st-bit-layout";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// ST's two-stacked-table register format (Section 9 "Register description" of
// the LSM6DSRX datasheet): a "Table N. <ACRONYM> register" bit-layout table
// (one row of 8 per-bit columns, leftmost = bit7) directly above a
// "Table N+1. <ACRONYM> register description" table whose left column
// (x≈102) carries the canonical field names, e.g. "ODR_XL[3:0]". Geometry
// below is transcribed verbatim from the measured real-fixture coordinates
// (see the Phase 5 spec) so the synthetic tests pin the exact same
// column/row math the real PDF exercises.

// CTRL1_XL — clean single-row bit layout, no label wrapping. 3 named fields
// (a 4-bit ODR_XL, a 2-bit FS_XL, a 1-bit LPF2_XL_EN) plus a reserved bit0.
function ctrl1XlPage() {
  const items = [
    t("Table 48. CTRL1_XL register", 265.3, 200, 661.2),
    // Bit row, y≈642.1 — 8 columns, leftmost = bit7.
    t("ODR_XL3", 109.3, 36.5, 642.1),
    t("ODR_XL2", 166.0, 36.5, 642.1),
    t("ODR_XL1", 222.7, 36.5, 642.1),
    t("ODR_XL0", 279.4, 36.5, 642.1),
    t("FS1_XL", 339.9, 28.9, 642.1),
    t("FS0_XL", 396.6, 28.9, 642.1),
    t("LPF2_XL_EN", 443.3, 48.9, 642.1),
    t("0", 518.8, 4.4, 641.7),
    t("(1)", 523.2, 6.8, 644.4),
    t("Table 49. CTRL1_XL register description", 239.8, 220, 592.8),
    // Desc left column (x=102.4) — canonical field names.
    t("ODR_XL[3:0]", 102.4, 50, 574.0),
    t("FS[1:0]_XL", 102.4, 48, 550.9),
    t("LPF2_XL_EN", 102.4, 48, 513.1),
    // Desc prose (x=196.0) — must be excluded (sentence-case, has spaces,
    // and sits well right of the x≈102 left column).
    t("Accelerometer full-scale selection.", 196.0, 140, 574.0),
    t("Refer to the datasheet for details.", 196.0, 130, 558.2),
    t("Table 50. Accelerometer ODR selection", 260.0, 200, 456.5),
  ];
  return {
    index: 90,
    text:
      "Table 48. CTRL1_XL register Table 49. CTRL1_XL register description " +
      "Table 50. Accelerometer ODR selection",
    items,
    hasImage: false,
  };
}

// FIFO_CTRL2 — labels wrap across 2-3 vertical rows within a column, two
// reserved bits with a footnote superscript, a footnote sentence that must be
// excluded from the bit row, and a field (UNCOPTR_RATE_[1:0]) whose bracket
// index space [1:0] does NOT equal its physical bit position [2:1].
function fifoCtrl2Page() {
  const items = [
    t("Table 33. FIFO_CTRL2 register", 260.8, 200, 474.5),
    // bit7: "STOP_ON" + "_WTM" (descending y) -> STOP_ON_WTM
    t("STOP_ON", 108.5, 35.0, 451.0),
    t("_WTM", 115.8, 20.0, 441.4),
    // bit6: "FIFO_" + "COMPR_RT_" + "EN" (descending y) -> FIFO_COMPR_RT_EN
    t("FIFO_", 172.9, 25.0, 455.8),
    t("COMPR_RT_", 159.7, 45.0, 446.2),
    t("EN", 178.7, 10.0, 436.6),
    // bit5: reserved "0" + footnote superscript "(1)"
    t("0", 235.3, 4.4, 445.8),
    t("(1)", 239.7, 6.8, 448.5),
    // bit4: "ODRCHG" + "_EN" -> ODRCHG_EN
    t("ODRCHG", 279.9, 30.0, 451.0),
    t("_EN", 289.9, 15.0, 441.4),
    // bit3: reserved "0" + footnote superscript "(1)"
    t("0", 348.7, 4.4, 445.8),
    t("(1)", 353.1, 6.8, 448.5),
    // bit2: "UNCOPTR" + "_RATE_1" -> UNCOPTR_RATE_1 (field index 1, physical bit 2)
    t("UNCOPTR", 391.2, 35.0, 451.0),
    t("_RATE_1", 394.0, 35.0, 441.4),
    // bit1: "UNCOPTR" + "_RATE_0" -> UNCOPTR_RATE_0 (field index 0, physical bit 1)
    t("UNCOPTR", 447.9, 35.0, 451.0),
    t("_RATE_0", 450.7, 35.0, 441.4),
    // bit0: "WTM8" (single row)
    t("WTM8", 512.6, 20.0, 446.2),
    // Footnote line — must NOT be treated as bit-row content: multi-token
    // prose, and the "1." marker, both sit ~30 below the bit row.
    t("1.", 99.2, 8, 419.5),
    t(
      "This bit must be set to '0' for the correct operation of the device.",
      113.4,
      300,
      419.5,
    ),
    t("Table 34. FIFO_CTRL2 register description", 260.8, 220, 387.6),
    // Desc left column (x=102.3) — canonical field names. Reserved bits 5/3
    // have no entry here.
    t("STOP_ON_WTM", 102.3, 70, 349.5),
    t("FIFO_COMPR_RT_EN", 102.3, 100, 313.5),
    t("ODRCHG_EN", 102.3, 60, 297.6),
    t("UNCOPTR_RATE_[1:0]", 102.3, 110, 280.0),
    t("WTM8", 102.3, 30, 260.0),
    t("Table 35. FIFO_CTRL3 register", 260.8, 200, 240.0),
  ];
  return {
    index: 61,
    text:
      "Table 33. FIFO_CTRL2 register Table 34. FIFO_CTRL2 register description " +
      "Table 35. FIFO_CTRL3 register",
    items,
    hasImage: false,
  };
}

// INTERNAL_FREQ_FINE — a clean [7:0] single field spanning all 8 columns at
// the fixed column centers measured across every ST register table in this
// datasheet (127.6, 184.3, 241.0, 297.7, 354.4, 411.1, 467.7, 524.4).
function internalFreqFinePage() {
  const centers = [127.6, 184.3, 241.0, 297.7, 354.4, 411.1, 467.7, 524.4];
  const width = 40;
  const labels = [
    "FREQ_FINE7",
    "FREQ_FINE6",
    "FREQ_FINE5",
    "FREQ_FINE4",
    "FREQ_FINE3",
    "FREQ_FINE2",
    "FREQ_FINE1",
    "FREQ_FINE0",
  ];
  const items = [
    t("Table 60. INTERNAL_FREQ_FINE register", 240.0, 220, 340.0),
    ...labels.map((label, i) => t(label, centers[i] - width / 2, width, 310.0)),
    t(
      "Table 61. INTERNAL_FREQ_FINE register description",
      220.0,
      240,
      290.0,
    ),
    t("FREQ_FINE[7:0]", 102.4, 60, 270.0),
    t("Table 62. Machine state register", 260.0, 200, 240.0),
  ];
  return {
    index: 72,
    text:
      "Table 60. INTERNAL_FREQ_FINE register Table 61. INTERNAL_FREQ_FINE " +
      "register description Table 62. Machine state register",
    items,
    hasImage: false,
  };
}

// A page with no ST-format register tables at all (plain prose).
function loneProsePage() {
  const items = [
    t("This device communicates over I2C and SPI interfaces.", 100, 300, 700),
    t("The default I2C address depends on the SDO/SA0 pin state.", 100, 320, 685),
  ];
  return {
    index: 3,
    text:
      "This device communicates over I2C and SPI interfaces. The default " +
      "I2C address depends on the SDO/SA0 pin state.",
    items,
    hasImage: false,
  };
}

describe("findStBitFields", () => {
  it("extracts CTRL1_XL fields from a clean, non-wrapping bit layout", () => {
    const fields = findStBitFields([ctrl1XlPage()]).get("CTRL1_XL");
    expect(fields).toEqual([
      { name: "ODR_XL", msb: 7, lsb: 4 },
      { name: "FS_XL", msb: 3, lsb: 2 },
      { name: "LPF2_XL_EN", msb: 1, lsb: 1 },
    ]);
  });

  it("reassembles wrapped labels, skips reserved bits + footnotes, and maps a bracket index space that differs from the physical bit position (FIFO_CTRL2)", () => {
    const fields = findStBitFields([fifoCtrl2Page()]).get("FIFO_CTRL2");
    expect(fields).toEqual([
      { name: "STOP_ON_WTM", msb: 7, lsb: 7 },
      { name: "FIFO_COMPR_RT_EN", msb: 6, lsb: 6 },
      { name: "ODRCHG_EN", msb: 4, lsb: 4 },
      { name: "UNCOPTR_RATE", msb: 2, lsb: 1 },
      { name: "WTM8", msb: 0, lsb: 0 },
    ]);
  });

  it("extracts a full [7:0] single field (INTERNAL_FREQ_FINE)", () => {
    const fields = findStBitFields([internalFreqFinePage()]).get(
      "INTERNAL_FREQ_FINE",
    );
    expect(fields).toEqual([{ name: "FREQ_FINE", msb: 7, lsb: 0 }]);
  });

  it("returns an empty map for a page with no ST-format register tables", () => {
    expect(findStBitFields([loneProsePage()]).size).toBe(0);
  });
});
