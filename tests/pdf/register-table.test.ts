import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findRegisterTable, parseRegisterTable } from "../../src/pdf/register-table";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// A page whose geometry mirrors the real BME280 "Table 18: Memory map"
// (measured x/width), so the pure parser is exercised deterministically.
function bme280LikePage() {
  const items = [
    // header
    t("Register Name", 80, 47, 100),
    t("Address", 141, 26, 100),
    t("bit7", 189, 12, 100), t("bit6", 229, 12, 100),
    t("bit5", 269, 12, 100), t("bit4", 309, 12, 100),
    t("bit3", 349, 12, 100), t("bit2", 390, 12, 100),
    t("bit1", 430, 12, 100), t("bit0", 470, 12, 100),
    t("Reset", 506, 20, 100), t("state", 508, 18, 100),
    // ctrl_meas 0xF4
    t("ctrl_meas", 88, 31, 90), t("0xF4", 147, 15, 90),
    t("osrs_t[2:0]", 218, 31, 90), t("osrs_p[2:0]", 338, 33, 90),
    t("mode[1:0]", 440, 30, 90), t("0x00", 508, 14, 90),
    // id 0xD0
    t("id", 100, 6, 80), t("0xD0", 147, 16, 80),
    t("chip_id[7:0]", 317, 34, 80), t("0x60", 508, 14, 80),
    // config 0xF5
    t("config", 93, 20, 70), t("0xF5", 147, 15, 70),
    t("t_sb[2:0]", 221, 26, 70), t("filter[2:0]", 342, 26, 70),
    t("spi3w_en[0]", 457, 35, 70), t("0x00", 508, 14, 70),
    // legend row (no address) — parsing must stop here
    t("Type:", 153, 30, 55), t("read only", 220, 40, 55),
  ];
  return { index: 27, text: "", items, hasImage: false };
}

describe("parseRegisterTable (synthetic BME280-like geometry)", () => {
  const table = parseRegisterTable(bme280LikePage());

  it("finds the registers in order, stopping at the legend row", () => {
    expect(table?.registers.map((r) => r.name)).toEqual([
      "ctrl_meas",
      "id",
      "config",
    ]);
  });

  it("extracts address and reset value", () => {
    const id = table?.registers.find((r) => r.name === "id");
    expect(id?.address).toBe("0xD0");
    expect(id?.reset).toBe("0x60");
  });

  it("computes bitfield offsets from column geometry", () => {
    const ctrl = table?.registers.find((r) => r.name === "ctrl_meas");
    expect(ctrl?.bitFields).toEqual([
      { name: "osrs_t", msb: 7, lsb: 5 },
      { name: "osrs_p", msb: 4, lsb: 2 },
      { name: "mode", msb: 1, lsb: 0 },
    ]);
  });

  it("handles reserved-bit gaps (config.spi3w_en at bit 0, not bit 1)", () => {
    const config = table?.registers.find((r) => r.name === "config");
    expect(config?.bitFields.find((f) => f.name === "spi3w_en")).toEqual({
      name: "spi3w_en",
      msb: 0,
      lsb: 0,
    });
  });
});

// The MCP23017 (Microchip) register summary uses a different table shape than
// the BME280: the column header is stacked across three physical text lines
// ("Register"/"Name", "Address"/"(hex)", "bit 7".."bit 0", "POR/RST"/"value"),
// each register row names every bit individually (IO7..IO0) instead of using
// [hi:lo] spans, addresses are bare hex ("00"), and the reset is binary
// ("1111 1111"). Crucially the first header line sits >5px above the bit line,
// so clusterRows does NOT merge them — the parser must merge the header band.
function mcp23017LikePage() {
  const items = [
    // header line 1 (y463) — sits 6px above the bit line, so it stays a
    // separate cluster row and must be band-merged into the header.
    t("Register", 73, 32, 463), t("Address", 118, 32, 463),
    t("POR/RST", 489, 35, 463),
    // header line 2 (y457) — bit columns
    t("bit 7", 165, 16, 457), t("bit 6", 207, 16, 457),
    t("bit 5", 248, 16, 457), t("bit 4", 289, 16, 457),
    t("bit 3", 330, 16, 457), t("bit 2", 371, 16, 457),
    t("bit 1", 412, 16, 457), t("bit 0", 454, 16, 457),
    // header line 3 (y452) — sub-labels (merges with the bit line at tol 5)
    t("Name", 78, 22, 452), t("(hex)", 125, 19, 452), t("value", 497, 20, 452),
    // IODIRA 00 — every bit named, reset 1111 1111
    t("IODIRA", 65, 28, 438), t("00", 130, 9, 438),
    t("IO7", 167, 13, 438), t("IO6", 208, 13, 438), t("IO5", 250, 13, 438),
    t("IO4", 291, 13, 438), t("IO3", 332, 13, 438), t("IO2", 373, 13, 438),
    t("IO1", 414, 13, 438), t("IO0", 455, 13, 438),
    t("1111", 484, 19, 438), t("1111", 508, 19, 438),
    // GPINTENA 02 — reset 0000 0000
    t("GPINTENA", 65, 41, 412), t("02", 130, 9, 412),
    t("GPINT7", 159, 29, 412), t("GPINT6", 200, 29, 412),
    t("GPINT5", 242, 29, 412), t("GPINT4", 283, 29, 412),
    t("GPINT3", 324, 29, 412), t("GPINT2", 365, 29, 412),
    t("GPINT1", 406, 29, 412), t("GPINT0", 447, 29, 412),
    t("0000", 484, 19, 412), t("0000", 508, 19, 412),
    // next table's title (no address) — parsing must stop here
    t("TABLE 3-3:", 65, 53, 386), t("SUMMARY OF REGISTERS", 137, 357, 386),
  ];
  return { index: 16, text: "", items, hasImage: false };
}

describe("parseRegisterTable (synthetic MCP23017-like geometry)", () => {
  const table = parseRegisterTable(mcp23017LikePage());

  it("merges the split header band and finds the registers, stopping at the next title", () => {
    expect(table?.registers.map((r) => r.name)).toEqual(["IODIRA", "GPINTENA"]);
  });

  it("normalizes bare-hex address and binary reset", () => {
    const iodira = table?.registers.find((r) => r.name === "IODIRA");
    expect(iodira?.address).toBe("0x00");
    expect(iodira?.reset).toBe("0xFF");
    const gpinten = table?.registers.find((r) => r.name === "GPINTENA");
    expect(gpinten?.address).toBe("0x02");
    expect(gpinten?.reset).toBe("0x00");
  });

  it("names every bit individually from its column (per-bit format)", () => {
    const iodira = table?.registers.find((r) => r.name === "IODIRA");
    expect(iodira?.bitFields).toEqual([
      { name: "IO7", msb: 7, lsb: 7 },
      { name: "IO6", msb: 6, lsb: 6 },
      { name: "IO5", msb: 5, lsb: 5 },
      { name: "IO4", msb: 4, lsb: 4 },
      { name: "IO3", msb: 3, lsb: 3 },
      { name: "IO2", msb: 2, lsb: 2 },
      { name: "IO1", msb: 1, lsb: 1 },
      { name: "IO0", msb: 0, lsb: 0 },
    ]);
  });
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))(
  "findRegisterTable (real BME280 datasheet)",
  () => {
    it("extracts the BME280 memory map with known register values", async () => {
      const analysis = await analyzePdfFile(FIXTURE);
      const table = findRegisterTable(analysis.pages);
      expect(table).toBeDefined();
      const byName = Object.fromEntries(
        (table?.registers ?? []).map((r) => [r.name, r]),
      );

      expect(byName.id?.address).toBe("0xD0");
      expect(byName.id?.reset).toBe("0x60");
      expect(byName.id?.bitFields).toEqual([
        { name: "chip_id", msb: 7, lsb: 0 },
      ]);

      expect(byName.ctrl_meas?.address).toBe("0xF4");
      expect(byName.ctrl_meas?.bitFields).toEqual([
        { name: "osrs_t", msb: 7, lsb: 5 },
        { name: "osrs_p", msb: 4, lsb: 2 },
        { name: "mode", msb: 1, lsb: 0 },
      ]);
    });
  },
);
