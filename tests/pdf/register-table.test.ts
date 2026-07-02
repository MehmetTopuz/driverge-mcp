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
