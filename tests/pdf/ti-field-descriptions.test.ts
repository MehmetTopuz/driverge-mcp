import { describe, expect, it } from "vitest";
import { findTiFieldDescriptions } from "../../src/pdf/ti-field-descriptions";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// TMAG5170 "Table 7-6. DEVICE_CONFIG Register Field Descriptions" (measured
// x/width). Bit column ≈76, Field ≈109; the Bit cell is "15" or a range "14-12".
// RESERVED fields and enum-continuation rows ("0h = …" at x≈308, no Bit cell) are
// dropped.
function deviceConfigPage() {
  const items = [
    t("Table 7-6. DEVICE_CONFIG Register Field Descriptions", 175, 262, 345),
    t("Bit", 76, 11, 332), t("Field", 109, 19, 332), t("Type", 208, 18, 332),
    t("Reset", 258, 22, 332), t("Description", 308, 44, 332),
    t("15", 77, 9, 318), t("RESERVED", 109, 44, 318), t("R", 208, 6, 318),
    t("0h", 258, 9, 318), t("Reserved", 308, 34, 318),
    t("14-12", 71, 20, 304), t("CONV_AVG", 109, 44, 304), t("R/W", 208, 16, 304),
    t("0h", 258, 9, 304), t("Enables additional sampling of the sensor data", 308, 236, 304),
    t("0h = 1x - 10.0Ksps (3-axes) or 20Ksps (1 axis)", 308, 165, 285),
    t("1h = 2x - 5.7Ksps (3-axes) or 13.3Ksps (1 axis)", 308, 167, 276),
    t("11-10", 72, 20, 204), t("RESERVED", 109, 44, 204), t("R", 208, 6, 204),
    t("0h", 258, 9, 204), t("Reserved", 308, 34, 204),
    t("9-8", 76, 12, 190), t("MAG_TEMPCO", 109, 57, 190), t("R/W", 208, 16, 190),
    t("0h", 258, 9, 190), t("Temperature coefficient of sense magnet", 308, 144, 190),
  ];
  return {
    index: 34,
    text: "Table 7-6. DEVICE_CONFIG Register Field Descriptions",
    items,
    hasImage: false,
  };
}

// The DEVICE_CONFIG table continued on the next page with a repeated header.
function deviceConfigContinued() {
  const items = [
    t("Table 7-6. DEVICE_CONFIG Register Field Descriptions (continued)", 146, 319, 711),
    t("Bit", 76, 11, 699), t("Field", 109, 19, 699), t("Type", 208, 18, 699),
    t("Reset", 258, 22, 699), t("Description", 308, 44, 699),
    t("6-4", 76, 12, 685), t("OPERATING_MODE", 109, 75, 685), t("R/W", 208, 16, 685),
    t("0h", 258, 9, 685), t("Selects operating mode", 308, 84, 685),
    t("0h = Configuration mode, Default (TRIGGER_MODE active)", 308, 213, 675),
    t("3", 79, 4, 594), t("T_CH_EN", 109, 36, 594), t("R/W", 208, 16, 594),
    t("0h", 258, 9, 594), t("Enables data acquisition of the temperature channel", 308, 185, 594),
  ];
  return {
    index: 35,
    text: "Table 7-6. DEVICE_CONFIG Register Field Descriptions (continued)",
    items,
    hasImage: false,
  };
}

function systemConfigPage() {
  const items = [
    t("Table 7-8. SYSTEM_CONFIG Register Field Descriptions", 144, 323, 711),
    t("Bit", 76, 11, 699), t("Field", 109, 19, 699), t("Type", 208, 18, 699),
    t("Reset", 258, 22, 699), t("Description", 308, 44, 699),
    // A RESERVED bit 15 makes this a 16-bit register even though the only named
    // field sits at bit 5.
    t("15", 77, 9, 685), t("RESERVED", 109, 44, 685), t("R", 208, 6, 685),
    t("0h", 258, 9, 685), t("Reserved", 308, 34, 685),
    t("5", 79, 4, 594), t("DIAG_EN", 109, 35, 594), t("R/W", 208, 16, 594),
    t("0h", 258, 9, 594), t("Enables user controlled AFE diagnostic tests", 308, 159, 594),
  ];
  return {
    index: 37,
    text: "Table 7-8. SYSTEM_CONFIG Register Field Descriptions",
    items,
    hasImage: false,
  };
}

// TUSS4470 (STM32 field test, Unit 3) writes multi-bit ranges with a COLON
// ("3:0") where TMAG5170 uses a hyphen ("14-12"); bare single-digit cells are
// shared by both dialects. Measured x/width from the real fixture's page 26
// (Table 7-12) — an 8-bit register, so this also pins widthFor staying at 8.
function vdrvCtrlColonPage() {
  const items = [
    t("Table 7-12. VDRV_CTRL Register Field Descriptions", 183, 250, 345),
    t("Bit", 76, 11, 332), t("Field", 109, 19, 332), t("Type", 208, 18, 332),
    t("Reset", 258, 22, 332), t("Description", 308, 44, 332),
    t("7", 79, 4, 318), t("RESERVED", 109, 44, 318), t("R", 208, 6, 318),
    t("0x0", 258, 12, 318), t("Reserved", 308, 34, 318),
    t("6", 79, 4, 304), t("DIS_VDRV_REG_LSTN", 109, 85, 304), t("R/W", 208, 16, 304),
    t("0x0", 258, 12, 304), t("Automatically disable VDRV charging in listen mode", 308, 190, 304),
    t("5", 79, 4, 290), t("VDRV_HI_Z", 109, 45, 290), t("R/W", 208, 16, 290),
    t("0x1", 258, 12, 290), t("Turn off current source between VPWR and VDRV", 308, 180, 290),
    t("3:0", 76, 12, 276), t("VDRV_VOLTAGE_LEVEL", 109, 92, 276), t("R/W", 208, 16, 276),
    t("0x0", 258, 12, 276), t("Regulated Voltage at VDRV pin", 308, 110, 276),
  ];
  return {
    index: 26,
    text: "Table 7-12. VDRV_CTRL Register Field Descriptions",
    items,
    hasImage: false,
  };
}

describe("findTiFieldDescriptions", () => {
  it("extracts named bit fields (width 16), skipping RESERVED and enum-continuation rows", () => {
    const table = findTiFieldDescriptions([deviceConfigPage()]).get("DEVICE_CONFIG");
    expect(table?.width).toBe(16);
    expect(table?.bitFields).toEqual([
      { name: "CONV_AVG", msb: 14, lsb: 12 },
      { name: "MAG_TEMPCO", msb: 9, lsb: 8 },
    ]);
  });

  it("accumulates fields across a (continued) page break, sorted msb-first", () => {
    const table = findTiFieldDescriptions([
      deviceConfigPage(),
      deviceConfigContinued(),
    ]).get("DEVICE_CONFIG");
    expect(table?.bitFields.map((f) => [f.name, f.msb, f.lsb])).toEqual([
      ["CONV_AVG", 14, 12],
      ["MAG_TEMPCO", 9, 8],
      ["OPERATING_MODE", 6, 4],
      ["T_CH_EN", 3, 3],
    ]);
  });

  it("parses a single-bit field (msb === lsb); RESERVED drives the 16-bit width", () => {
    const table = findTiFieldDescriptions([systemConfigPage()]).get("SYSTEM_CONFIG");
    expect(table?.width).toBe(16);
    expect(table?.bitFields).toEqual([{ name: "DIAG_EN", msb: 5, lsb: 5 }]);
  });

  it("partitions fields by register when multiple tables appear", () => {
    const map = findTiFieldDescriptions([deviceConfigPage(), systemConfigPage()]);
    expect(map.get("DEVICE_CONFIG")?.bitFields.length).toBe(2);
    expect(map.get("SYSTEM_CONFIG")?.bitFields.length).toBe(1);
  });

  it("parses the TUSS4470 colon range dialect (3:0) alongside bare single digits, width 8", () => {
    const table = findTiFieldDescriptions([vdrvCtrlColonPage()]).get("VDRV_CTRL");
    expect(table?.width).toBe(8);
    expect(table?.bitFields).toEqual([
      { name: "DIS_VDRV_REG_LSTN", msb: 6, lsb: 6 },
      { name: "VDRV_HI_Z", msb: 5, lsb: 5 },
      { name: "VDRV_VOLTAGE_LEVEL", msb: 3, lsb: 0 },
    ]);
  });
});
