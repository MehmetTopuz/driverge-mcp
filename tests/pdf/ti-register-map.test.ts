import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findTiRegisterMap, parseTiRegisterMap } from "../../src/pdf/ti-register-map";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// Mirrors TI's "Table 7-4. TMAG5170 Registers": Offset | Acronym | Register Name
// | Section. Offsets are bare hex + "h"; the acronym (col 2) is the register
// name. The trailing "0h = 1x …" row is a decoy (a bit-field value description
// that also starts with an offset) — the acronym rule must reject it.
function tiLikePage() {
  const items = [
    // header
    t("Offset", 60, 30, 100), t("Acronym", 120, 34, 100),
    t("Register Name", 200, 60, 100), t("Section", 340, 30, 100),
    // 0h DEVICE_CONFIG
    t("0h", 60, 12, 88), t("DEVICE_CONFIG", 120, 60, 88),
    t("Configure Device Operation Modes", 200, 130, 88), t("Go", 340, 12, 88),
    // 8h CONV_STATUS
    t("8h", 60, 12, 76), t("CONV_STATUS", 120, 52, 76),
    t("Conversion Status Register", 200, 110, 76), t("Go", 340, 12, 76),
    // 10h OSC_MONITOR
    t("10h", 60, 16, 64), t("OSC_MONITOR", 120, 52, 64),
    t("Conversion Result Register", 200, 110, 64), t("Go", 340, 12, 64),
    // decoy: "0h = 1x - 10Ksps" — offset but no acronym; parsing must stop here
    t("0h", 60, 12, 52), t("=", 120, 6, 52), t("1x - 10Ksps", 140, 60, 52),
  ];
  return { index: 33, text: "", items, hasImage: false };
}

describe("parseTiRegisterMap (synthetic TI Table 7-4 geometry)", () => {
  const table = parseTiRegisterMap(tiLikePage());

  it("reads offset+acronym rows and stops at the first non-register row", () => {
    expect(table?.registers.map((r) => r.name)).toEqual([
      "DEVICE_CONFIG",
      "CONV_STATUS",
      "OSC_MONITOR",
    ]);
  });

  it("normalizes the bare-hex offset to a 0x address", () => {
    expect(table?.registers.map((r) => r.address)).toEqual([
      "0x00",
      "0x08",
      "0x10",
    ]);
  });

  it("leaves reset/bitFields empty (summary table carries no field data)", () => {
    const dc = table?.registers.find((r) => r.name === "DEVICE_CONFIG");
    expect(dc?.reset).toBe("");
    expect(dc?.bitFields).toEqual([]);
  });
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/tmag5170-q1.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("findTiRegisterMap (real TMAG5170)", () => {
  it("extracts the 21-register map across the continued table", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findTiRegisterMap(analysis.pages);
    const byName = Object.fromEntries(
      (table?.registers ?? []).map((r) => [r.name, r.address]),
    );
    expect(byName.DEVICE_CONFIG).toBe("0x00");
    expect(byName.CONV_STATUS).toBe("0x08");
    expect(byName.OSC_MONITOR).toBe("0x10"); // first row of the continued page
    expect(byName.MAGNITUDE_RESULT).toBe("0x14"); // last register
    expect(table?.registers.length).toBe(21);
  });
});
