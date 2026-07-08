import { describe, expect, it } from "vitest";
// NOT YET IMPLEMENTED — src/pdf/ti-command-byte.ts does not exist yet, so this
// whole file fails at import. That is the expected RED state: the module (and
// its wiring into assembleDatasheet's buildInterface, right after
// findTiRegisterMap) is what the coder must add to turn this green.
import {
  findTiCommandByteTable,
  parseTiCommandByteTable,
} from "../../src/pdf/ti-command-byte";

// Synthetic-geometry pattern mirrors tests/pdf/ti-register-map.test.ts: build
// PageContent items positioned like the real datasheet (str/x/y/width/height),
// rows separated by y, and let the adapter's own row-clustering regroup them.
// The header/data geometry below reproduces the real TCA6408A-Q1 SCPS234A
// page-24 "Table 8-4. Command Byte" clustered-row dump from the field-test
// diagnosis:
//
//   303 | Table 8-4. Command Byte
//   291 | B7 B6 CONTROL REGISTER BITS B5 B4 B3 B2 B1 B0 COMMAND BYTE (HEX) REGISTER PROTOCOL POWER-UP DEFAULT
//   263 | 0 0 0 0 0 0 0 0 00 Input Port Read byte xxxx xxxx
//   249 | 0 0 0 0 0 0 0 1 01 Output Port Read/write byte 1111 1111
//   235 | 0 0 0 0 0 0 1 0 02 Polarity Inversion Read/write byte 0000 0000
//   221 | 0 0 0 0 0 0 1 1 03 Configuration Read/write byte 1111 1111
const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// Per-column x positions. "CONTROL REGISTER BITS" is a spanning group label
// that renders BETWEEN B6 and B5 in the real PDF (its text run's left edge
// sits under the B6/B5 gap, a rendering artifact of the merged header cell) —
// reproduced verbatim rather than "fixed", since a correct adapter must
// tolerate this quirk rather than assume every header cell maps 1:1 onto a
// data column.
const X = {
  b7: 60,
  b6: 90,
  ctrlBits: 108,
  b5: 140,
  b4: 170,
  b3: 200,
  b2: 230,
  b1: 260,
  b0: 290,
  commandByte: 320,
  register: 430,
  protocol: 520,
  powerUp: 610,
  default: 680,
};

/** The full 15-cell header, as one clustered row at `y` (the "happy path" shape). */
function headerRow(y: number) {
  return [
    t("B7", X.b7, 16, y),
    t("B6", X.b6, 16, y),
    t("CONTROL REGISTER BITS", X.ctrlBits, 150, y),
    t("B5", X.b5, 16, y),
    t("B4", X.b4, 16, y),
    t("B3", X.b3, 16, y),
    t("B2", X.b2, 16, y),
    t("B1", X.b1, 16, y),
    t("B0", X.b0, 16, y),
    t("COMMAND BYTE", X.commandByte, 60, y),
    t("(HEX)", X.commandByte, 40, y),
    t("REGISTER", X.register, 70, y),
    t("PROTOCOL", X.protocol, 70, y),
    t("POWER-UP", X.powerUp, 60, y),
    t("DEFAULT", X.default, 60, y),
  ];
}

/** One Command Byte data row: 8 bit cells + hex + register name + protocol + reset. */
function dataRow(
  y: number,
  bits: readonly [number, number, number, number, number, number, number, number],
  hex: string,
  register: string,
  protocolCell: string,
  reset: string,
) {
  const cols = [X.b7, X.b6, X.b5, X.b4, X.b3, X.b2, X.b1, X.b0];
  return [
    ...bits.map((b, i) => t(String(b), cols[i], 8, y)),
    t(hex, X.commandByte, 16, y),
    t(register, X.register, 70, y),
    t(protocolCell, X.protocol, 90, y),
    t(reset, X.default, 70, y),
  ];
}

/** The 4 real Command Byte rows, stacked downward from `topY` by `step`. */
function fourDataRows(topY: number, step = 14) {
  return [
    ...dataRow(topY, [0, 0, 0, 0, 0, 0, 0, 0], "00", "Input Port", "Read byte", "xxxx xxxx"),
    ...dataRow(
      topY - step,
      [0, 0, 0, 0, 0, 0, 0, 1],
      "01",
      "Output Port",
      "Read/write byte",
      "1111 1111",
    ),
    ...dataRow(
      topY - 2 * step,
      [0, 0, 0, 0, 0, 0, 1, 0],
      "02",
      "Polarity Inversion",
      "Read/write byte",
      "0000 0000",
    ),
    ...dataRow(
      topY - 3 * step,
      [0, 0, 0, 0, 0, 0, 1, 1],
      "03",
      "Configuration",
      "Read/write byte",
      "1111 1111",
    ),
  ];
}

const EXPECTED_REGISTERS = [
  { name: "Input Port", address: "0x00", reset: "xxxx xxxx", bitFields: [] },
  { name: "Output Port", address: "0x01", reset: "0xFF", bitFields: [] },
  { name: "Polarity Inversion", address: "0x02", reset: "0x00", bitFields: [] },
  { name: "Configuration", address: "0x03", reset: "0xFF", bitFields: [] },
];

function commandByteLikePage(index = 24) {
  const items = [
    t("Table 8-4. Command Byte", 60, 220, 303),
    ...headerRow(291),
    ...fourDataRows(263),
  ];
  return { index, text: "", items, hasImage: false };
}

describe("parseTiCommandByteTable (synthetic TI Table 8-4 geometry)", () => {
  it("parses the 4 Command Byte rows into address-only registers with normalized hex address/reset and no bit fields", () => {
    const table = parseTiCommandByteTable(commandByteLikePage());
    expect(table?.page).toBe(24);
    expect(table?.registers).toEqual(EXPECTED_REGISTERS);
  });

  // The header may render as ONE clustered row (above) or as a small BAND —
  // e.g. "POWER-UP" and "DEFAULT" as their own rows a few units below the main
  // header line (the real sheet's two-line "POWER-UP\nDEFAULT" header cell,
  // split further than a single row-clustering pass merges). The adapter must
  // recognize the header across that band, not assume it is always one row.
  it("parses a header BAND where POWER-UP/DEFAULT are stacked as their own rows (~12 units below the main header row)", () => {
    const items = [
      t("Table 8-4. Command Byte", 60, 220, 303),
      // main header row, WITHOUT the POWER-UP/DEFAULT cells
      t("B7", X.b7, 16, 291),
      t("B6", X.b6, 16, 291),
      t("CONTROL REGISTER BITS", X.ctrlBits, 150, 291),
      t("B5", X.b5, 16, 291),
      t("B4", X.b4, 16, 291),
      t("B3", X.b3, 16, 291),
      t("B2", X.b2, 16, 291),
      t("B1", X.b1, 16, 291),
      t("B0", X.b0, 16, 291),
      t("COMMAND BYTE", X.commandByte, 60, 291),
      t("(HEX)", X.commandByte, 40, 291),
      t("REGISTER", X.register, 70, 291),
      t("PROTOCOL", X.protocol, 70, 291),
      // stacked band: POWER-UP 6 units below the main row, DEFAULT 6 more below that
      t("POWER-UP", X.powerUp, 60, 285),
      t("DEFAULT", X.default, 60, 279),
      ...fourDataRows(263),
    ];
    const table = parseTiCommandByteTable({ index: 24, text: "", items, hasImage: false });
    expect(table?.registers).toEqual(EXPECTED_REGISTERS);
  });

  // Table-end guard: the real page 24 footer text immediately follows the
  // last data row ("TCA6408A-Q1 SCPS234A ... www.ti.com 24 Submit Document
  // Feedback ..."). It must NOT be swallowed as a 5th register — parsing
  // stops at the first row without a valid hex cell in the (HEX) column.
  it("stops at the first row without a valid hex cell in the (HEX) column — trailing footer prose is not swallowed", () => {
    const items = [
      ...headerRow(291),
      ...fourDataRows(263),
      t(
        "TCA6408A-Q1 SCPS234A – SEPTEMBER 2016 – REVISED FEBRUARY 2023 www.ti.com 24 Submit Document Feedback",
        60,
        400,
        200,
      ),
    ];
    const table = parseTiCommandByteTable({ index: 24, text: "", items, hasImage: false });
    expect(table?.registers.length).toBe(4);
    expect(table?.registers.map((r) => r.address)).toEqual(["0x00", "0x01", "0x02", "0x03"]);
  });
});

describe("findTiCommandByteTable (page scan)", () => {
  it("finds the Command Byte table on the correct page among several, ignoring unrelated prose pages", () => {
    const unrelated = {
      index: 23,
      text: "",
      items: [
        t(
          "Following the successful acknowledgment of the address byte, the bus controller sends a command byte.",
          60,
          400,
          500,
        ),
      ],
      hasImage: false,
    };
    const table = findTiCommandByteTable([unrelated, commandByteLikePage(24)]);
    expect(table?.page).toBe(24);
    expect(table?.registers).toEqual(EXPECTED_REGISTERS);
  });

  // Negative: TI's OTHER register-table shape (Offset|Acronym summary, e.g.
  // TMAG5170's Table 7-4 — see ti-register-map.test.ts) must not be mistaken
  // for a Command Byte table. Neither "COMMAND BYTE" nor "(HEX)" appears here.
  it("does not match a TI Offset|Acronym register-summary table (no COMMAND BYTE/(HEX) header)", () => {
    const offsetAcronymPage = {
      index: 5,
      text: "",
      items: [
        t("Offset", 60, 30, 100),
        t("Acronym", 120, 34, 100),
        t("Register Name", 200, 60, 100),
        t("Section", 340, 30, 100),
        t("0h", 60, 12, 88),
        t("DEVICE_CONFIG", 120, 60, 88),
        t("Configure Device Operation Modes", 200, 130, 88),
        t("Go", 340, 12, 88),
      ],
      hasImage: false,
    };
    expect(findTiCommandByteTable([offsetAcronymPage])).toBeUndefined();
  });

  // Negative: header matches, but nothing below it is a valid data row (no
  // page anywhere contributes a register) — findTiCommandByteTable must
  // report undefined rather than an empty-but-"found" table.
  it("returns undefined when a header matches but no page has any valid data row", () => {
    const noDataPage = {
      index: 24,
      text: "",
      items: [
        ...headerRow(291),
        t(
          "This table describes the command byte layout for the TCA6408A-Q1 device.",
          60,
          400,
          260,
        ),
      ],
      hasImage: false,
    };
    expect(findTiCommandByteTable([noDataPage])).toBeUndefined();
  });
});
