import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import {
  findGenericRegisterTable,
  parseGenericRegisterTable,
} from "../../src/pdf/generic-register-table";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// ST LSM6DSRX "Table 22. Registers address map" (measured x/width). The header is
// a 3-line BAND (Register address / Name·Type·Default·Comment / Hex·Binary); each
// row is `Name | Type | Hex-addr | Binary-addr | Comment`. Name is LEFT, address
// (bare hex) is RIGHT. A RESERVED "2E-34" span must be skipped, and a section
// heading with no address ends the table.
function stLikePage() {
  const items = [
    t("Register address", 346, 65, 715),
    t("Name", 102, 22, 707), t("Type", 302, 18, 707),
    t("Default", 446, 27, 707), t("Comment", 503, 37, 707),
    t("Hex", 341, 15, 699), t("Binary", 387, 25, 699),
    t("OUTX_L_G", 102, 42, 683), t("R", 308, 6, 683), t("22", 344, 9, 683),
    t("00100010", 382, 36, 683), t("output", 448, 22, 683),
    t("OUTX_H_G", 102, 43, 667), t("R", 308, 6, 667), t("23", 344, 9, 667),
    t("00100011", 382, 35, 667), t("output", 448, 22, 667),
    t("OUTY_L_G", 102, 42, 651), t("R", 308, 6, 651), t("24", 344, 9, 651),
    t("00100100", 382, 36, 651), t("output", 448, 22, 651),
    // RESERVED span — skipped, not a table terminator.
    t("RESERVED", 102, 44, 635), t("-", 309, 3, 635), t("2E-34", 338, 21, 635),
    t("EMB_FUNC_STATUS_MAINPAGE", 102, 125, 619), t("R", 308, 6, 619),
    t("35", 344, 9, 619), t("00110101", 382, 35, 619), t("output", 448, 22, 619),
    // Section heading (no address) — ends the table.
    t("14.2", 43, 16, 603), t("FIFO status registers", 99, 120, 603),
  ];
  return { index: 42, text: "", items, hasImage: false };
}

// Broadcom AEAT-8811 OTP register table (measured). Single-line header; column
// order is the OPPOSITE of ST — Address is LEFT, Name is RIGHT — and names are
// multi-word ("Customer Reserve 0"). Addresses are 0xNN.
function broadcomLikePage() {
  const items = [
    t("Address", 38, 36, 579), t("Bit(s)", 102, 23, 579), t("Name", 161, 25, 579),
    t("Description", 295, 49, 579), t("Default", 519, 30, 579),
    t("0x00", 38, 20, 563), t("[7:0]", 102, 17, 563),
    t("Customer Reserve 0", 161, 82, 563), t("User programmable", 295, 79, 563), t("8'h0", 519, 17, 563),
    t("0x01", 38, 20, 549), t("[7:0]", 102, 17, 549),
    t("Customer Reserve 1", 161, 82, 549), t("User programmable", 295, 79, 549), t("8'h0", 519, 17, 549),
    t("0x02", 38, 20, 535), t("[7:0]", 102, 18, 535),
    t("Zero Reset0", 161, 49, 535), t("Zero Reset Position [7:0]", 295, 99, 535), t("8'h0", 519, 17, 535),
    t("0x03", 38, 20, 521), t("[7:0]", 102, 17, 521),
    t("Zero Reset1", 161, 49, 521), t("Zero Reset Position [15:8]", 295, 104, 521), t("8'h0", 519, 17, 521),
    t("Customer Configuration Registers", 36, 229, 490),
  ];
  return { index: 10, text: "", items, hasImage: false };
}

// A pin-description table (Infineon TLE5014 style): has a name-ish "Symbol"
// column but NO address column — must NOT be mistaken for a register map.
function pinTablePage() {
  const items = [
    t("Pin No.", 51, 35, 283), t("Symbol", 178, 37, 283),
    t("In/Out", 263, 31, 283), t("Function", 331, 43, 283),
    t("1", 51, 5, 265), t("IF1-1", 178, 23, 265), t("I/O", 263, 14, 265), t("DATA (MOSI/MISO)", 331, 85, 265),
    t("2", 51, 5, 248), t("IF2-1", 178, 23, 248), t("I", 264, 3, 248), t("SCK (SSC clock)", 331, 72, 248),
    t("3", 51, 5, 230), t("IF3-1", 178, 23, 230), t("I", 263, 3, 230), t("CSQ (chip select)", 331, 77, 230),
  ];
  return { index: 3, text: "", items, hasImage: false };
}

describe("parseGenericRegisterTable — ST LSM6DSRX-like (name left, addr right, banded header)", () => {
  const table = parseGenericRegisterTable(stLikePage());

  it("extracts name + address, skipping the RESERVED span and stopping at the heading", () => {
    expect(table?.registers.map((r) => [r.name, r.address])).toEqual([
      ["OUTX_L_G", "0x22"],
      ["OUTX_H_G", "0x23"],
      ["OUTY_L_G", "0x24"],
      ["EMB_FUNC_STATUS_MAINPAGE", "0x35"],
    ]);
  });

  it("leaves reset/bitFields empty (address-only → partial extraction)", () => {
    expect(table?.registers.every((r) => r.reset === "" && r.bitFields.length === 0)).toBe(true);
  });
});

describe("parseGenericRegisterTable — Broadcom AEAT-8811-like (addr left, multi-word names)", () => {
  const table = parseGenericRegisterTable(broadcomLikePage());

  it("handles the opposite column order and multi-word register names", () => {
    expect(table?.registers.map((r) => [r.name, r.address])).toEqual([
      ["Customer Reserve 0", "0x00"],
      ["Customer Reserve 1", "0x01"],
      ["Zero Reset0", "0x02"],
      ["Zero Reset1", "0x03"],
    ]);
  });
});

describe("findGenericRegisterTable — guardrails", () => {
  it("ignores a table with no address column (pin description)", () => {
    expect(findGenericRegisterTable([pinTablePage()])).toBeUndefined();
  });

  it("requires at least 3 register rows", () => {
    const twoRows = {
      index: 1,
      text: "",
      items: [
        t("Name", 102, 22, 707), t("Address", 341, 30, 707),
        t("REG_A", 102, 30, 690), t("00", 344, 9, 690),
        t("REG_B", 102, 30, 674), t("01", 344, 9, 674),
      ],
      hasImage: false,
    };
    expect(findGenericRegisterTable([twoRows])).toBeUndefined();
  });

  it("returns the first qualifying table across pages", () => {
    expect(findGenericRegisterTable([pinTablePage(), stLikePage()])?.registers.length).toBe(4);
  });
});

// Real fixtures (git-ignored → skips on a fresh clone / CI).
const LSM = fileURLToPath(new URL("../fixtures/lsm6dsrx.pdf", import.meta.url));
const AEAT = fileURLToPath(new URL("../fixtures/AEAT-8811-Q24_DS.pdf", import.meta.url));

describe.skipIf(!existsSync(LSM))("findGenericRegisterTable — real LSM6DSRX", () => {
  it("extracts the ST main register bank (name + bare-hex address, page-local)", async () => {
    // The main map starts on page 41 (FUNC_CFG_ACCESS@0x01); page-local extraction
    // returns that page's bank. Other pages hold separate banks with overlapping
    // addresses (e.g. 0x02), so we deliberately do NOT accumulate across pages.
    const table = findGenericRegisterTable((await analyzePdfFile(LSM)).pages);
    expect(table).toBeDefined();
    expect((table?.registers.length ?? 0)).toBeGreaterThanOrEqual(15);
    const byName = Object.fromEntries((table?.registers ?? []).map((r) => [r.name, r.address]));
    expect(byName.FUNC_CFG_ACCESS).toBe("0x01");
    expect(byName.PIN_CTRL).toBe("0x02");
    expect(byName.INT1_CTRL).toBe("0x0D");
  });
});

describe.skipIf(!existsSync(AEAT))("findGenericRegisterTable — real AEAT-8811", () => {
  it("extracts the OTP register list (0xNN addresses)", async () => {
    const table = findGenericRegisterTable((await analyzePdfFile(AEAT)).pages);
    expect(table).toBeDefined();
    expect((table?.registers.length ?? 0)).toBeGreaterThanOrEqual(3);
    expect(table?.registers.every((r) => /^0x[0-9A-F]{2}$/.test(r.address))).toBe(true);
  });
});
