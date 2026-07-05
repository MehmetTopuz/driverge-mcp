import { describe, expect, it } from "vitest";
import {
  findMaximRegisterMap,
  parseMaximRegisterMap,
} from "../../src/pdf/maxim-register-map";

// RED (Session 11 / Phase D) — pins the contract for the Maxim register-matrix
// adapter, added as a NEW specialized adapter (mirrors ti-register-map.ts's
// shape) rather than reusing register-table.ts's BME280 span path (which skips
// bare single-bit names) or its Microchip per-bit path (which mis-sizes spans).
//
// Maxim datasheets (e.g. MAX30102, "Register Maps and Descriptions") lay the
// table out as:
//   REGISTER | B7 | B6 | B5 | B4 | B3 | B2 | B1 | B0 | REG ADDR | POR STATE | R/W
// with the "REG"/"ADDR" and "POR"/"STATE" header labels commonly stacked two
// physical lines apart (a header *band*, like Microchip's), and per-register
// rows carrying EITHER a bare bit name ("SHDN", "RESET") under a single B<n>
// column OR a bracketed span ("MODE[2:0]") positioned across several B<n>
// columns — its width comes from the bracket, but its msb:lsb come from WHICH
// columns it's geometrically centered over (see bitPosition in register-table.ts,
// which this adapter's span matching mirrors). Unlike BME280/TI, the bit-field
// region sits BETWEEN the name and the address (REGISTER | bits | REG ADDR |
// POR STATE), not after the address.
//
// Real-world geometry (confirmed against tests/fixtures/max30102.pdf pages 10-22
// via `pdftotext -layout`) for the "Mode Configuration (0x09)" register:
//   REGISTER    B7    B6   B5 B4 B3      B2         B1  B0   REG   POR  R/W
//                                                          ADDR  STATE
//   Mode       SHDN  RESET                    MODE[2:0]          0x09  0x00 R/W
//   Configuration
// This test file builds that shape synthetically (single-line rows, following
// ti-register-map.test.ts's style) rather than depending on the fixture PDF.

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// Column x-centers shared by every synthetic row below (centerX = x + width/2).
// B7..B0 spaced 20px apart; REGADDR/PORSTATE stacked columns further right.
//   name ~80   B7 148  B6 168  B5 188  B4 208  B3 228  B2 248  B1 268  B0 288
//   REG ADDR ~325   POR STATE ~365   R/W ~402
function maximHeaderBand(y: number) {
  return [
    // Line 1 (y): REGISTER, B7..B0, REG, POR, R/W.
    t("REGISTER", 40, 70, y),
    t("B7", 140, 16, y),
    t("B6", 160, 16, y),
    t("B5", 180, 16, y),
    t("B4", 200, 16, y),
    t("B3", 220, 16, y),
    t("B2", 240, 16, y),
    t("B1", 260, 16, y),
    t("B0", 280, 16, y),
    t("REG", 310, 30, y),
    t("POR", 350, 30, y),
    t("R/W", 390, 24, y),
    // Line 2 (y - 7): ADDR/STATE stacked directly under REG/POR — a 7px gap,
    // too far for clusterRows' default 5px tolerance to merge into one row, so
    // the adapter must fold nearby header lines into a band (like Microchip's
    // findHeaderBand) to recognize "REG ADDR" / "POR STATE" as columns.
    t("ADDR", 310, 30, y - 7),
    t("STATE", 350, 30, y - 7),
  ];
}

// "Mode Configuration" (0x09): bare SHDN (B7), bare RESET (B6), and a
// MODE[2:0] span geometrically centered across B2..B0 (center 268 == the
// midpoint of B2's 248 and B0's 288) — msb:lsb (2,0) coincide with the
// bracket's own digits here on purpose (kept simple per the probe).
function modeConfigRow(y: number) {
  return [
    t("MODE CONFIG", 40, 80, y), // name, center 80 < any bit column
    t("SHDN", 133, 30, y), // center 148 == B7
    t("RESET", 153, 30, y), // center 168 == B6
    t("MODE[2:0]", 238, 60, y), // center 268 == mid(B2=248, B0=288)
    t("0x09", 310, 30, y), // REG ADDR, center 325
    t("0x00", 350, 30, y), // POR STATE, center 365
  ];
}

// "SpO2 Configuration" (0x0A): only reserved/decoy cells under the bit
// columns — a bare "0" and a dash — neither of which is a real field.
function spo2ReservedRow(y: number) {
  return [
    t("SPO2 CONFIG", 40, 80, y),
    t("0", 161, 14, y), // bare-zero reserved marker, center 168 == B6
    t("—", 183, 10, y), // em-dash reserved marker, center 188 == B5
    t("0x0A", 312, 26, y), // REG ADDR
    t("0x00", 350, 30, y), // POR STATE
  ];
}

// A decoy row that ends the table body: no 0xNN anywhere near the REG ADDR
// column (a caption line, not a register row).
function decoyCaptionRow(y: number) {
  return [t("Table 4. Mode Control", 40, 140, y), t("MODE", 200, 40, y)];
}

// A well-formed-looking register row placed AFTER the decoy — must NOT
// appear in the output, proving the decoy truly ends (breaks) the table
// body rather than just being skipped over.
function partIdRowAfterDecoy(y: number) {
  return [
    t("PART ID", 40, 60, y),
    t("0xFE", 312, 26, y),
    t("0xFF", 350, 30, y),
  ];
}

function maximLikePage(index: number) {
  const items = [
    ...maximHeaderBand(100),
    ...modeConfigRow(70),
    ...spo2ReservedRow(56),
    ...decoyCaptionRow(42),
    ...partIdRowAfterDecoy(28),
  ];
  return { index, text: "", items, hasImage: false };
}

describe("parseMaximRegisterMap (synthetic Maxim register-matrix geometry)", () => {
  const table = parseMaximRegisterMap(maximLikePage(11));

  it("recognizes the 2-line REGISTER/B7..B0/REG ADDR/POR STATE header band and resolves columns", () => {
    expect(table).toBeDefined();
    expect(table?.page).toBe(11);
  });

  it("extracts a bare single-bit field per name (SHDN, RESET) at its own B<n> column", () => {
    const modeConfig = table?.registers.find((r) => r.name === "MODE CONFIG");
    expect(modeConfig).toBeDefined();
    expect(modeConfig?.bitFields).toContainEqual({ name: "SHDN", msb: 7, lsb: 7 });
    expect(modeConfig?.bitFields).toContainEqual({ name: "RESET", msb: 6, lsb: 6 });
  });

  it("sizes a bracketed span (MODE[2:0]) from the bracket and positions it from geometry, losing the bracket in the name", () => {
    const modeConfig = table?.registers.find((r) => r.name === "MODE CONFIG");
    expect(modeConfig?.bitFields).toContainEqual({ name: "MODE", msb: 2, lsb: 0 });
    // Full register shape, per the RED spec.
    expect(modeConfig).toEqual({
      name: "MODE CONFIG",
      address: "0x09",
      reset: "0x00",
      bitFields: [
        { name: "SHDN", msb: 7, lsb: 7 },
        { name: "RESET", msb: 6, lsb: 6 },
        { name: "MODE", msb: 2, lsb: 0 },
      ],
    });
  });

  it("reads REG ADDR / POR STATE into address/reset", () => {
    const modeConfig = table?.registers.find((r) => r.name === "MODE CONFIG");
    expect(modeConfig?.address).toBe("0x09");
    expect(modeConfig?.reset).toBe("0x00");
  });

  it("ignores bare '0'/'1' reserved markers and dash cells (no spurious bit fields)", () => {
    const spo2 = table?.registers.find((r) => r.name === "SPO2 CONFIG");
    expect(spo2).toBeDefined();
    expect(spo2?.bitFields).toEqual([]);
    expect(spo2?.address).toBe("0x0A");
  });

  it("ends the table body at the first row lacking a valid 0xNN REG ADDR (break, not skip)", () => {
    const names = table?.registers.map((r) => r.name) ?? [];
    expect(names).toEqual(["MODE CONFIG", "SPO2 CONFIG"]);
    // The decoy caption row, and the well-formed PART ID row placed after it,
    // are both excluded — the table body ended at the decoy.
    expect(names).not.toContain("PART ID");
  });

  it("returns undefined for a page without the Maxim register-matrix header", () => {
    const page = {
      index: 1,
      text: "",
      items: [t("Just some prose about the device.", 40, 200, 100)],
      hasImage: false,
    };
    expect(parseMaximRegisterMap(page)).toBeUndefined();
  });
});

describe("findMaximRegisterMap (multi-page accumulation, dedup by address)", () => {
  // Page 1: header + MODE CONFIG (0x09) + SPO2 CONFIG (0x0A, empty bitFields).
  const page1 = maximLikePage(11);

  // Page 2: a "(continued)" repeat of the header, a DUPLICATE 0x0A row (this
  // time carrying a bogus bit field, to prove the first-seen page wins the
  // dedup rather than being overwritten), and one genuinely new register
  // (0x0B).
  function duplicateSpo2RowWithExtraField(y: number) {
    return [
      t("SPO2 CONFIG", 40, 80, y),
      t("BOGUS", 133, 30, y), // would be a spurious field if this page won
      t("0x0A", 312, 26, y),
      t("0x00", 350, 30, y),
    ];
  }
  function newFifoRow(y: number) {
    return [
      t("FIFO CONFIG", 40, 80, y),
      t("0x0B", 312, 26, y),
      t("0x00", 350, 30, y),
    ];
  }
  const page2 = {
    index: 12,
    text: "",
    items: [
      ...maximHeaderBand(100),
      ...duplicateSpo2RowWithExtraField(70),
      ...newFifoRow(56),
    ],
    hasImage: false,
  };

  const table = findMaximRegisterMap([page1, page2]);

  it("accumulates registers across pages without duplicating by address", () => {
    const addresses = table?.registers.map((r) => r.address);
    expect(addresses).toEqual(["0x09", "0x0A", "0x0B"]);
  });

  it("keeps the first-seen page's fields for a duplicated address (page 1 wins over page 2)", () => {
    const spo2 = table?.registers.find((r) => r.address === "0x0A");
    expect(spo2?.name).toBe("SPO2 CONFIG");
    expect(spo2?.bitFields).toEqual([]); // page 1's (empty), not page 2's "BOGUS" field
  });

  it("reports the first page the table started on", () => {
    expect(table?.page).toBe(11);
  });
});
