import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findTiRegisterMap } from "../../src/pdf/ti-register-map";
import golden from "../fixtures/tmag5170.golden.json";

// Hand-verified L0 contract for the TMAG5170 (TI) register map — the "Table 7-4.
// TMAG5170 Registers" summary (21 registers, offsets 0x00–0x14) enriched with the
// per-register "Register Field Descriptions" bit fields (all 16-bit registers).
// Skips on a fresh clone lacking the git-ignored PDF.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/tmag5170-q1.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("TMAG5170 golden register map", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findTiRegisterMap(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });

  it("enriches registers with 16-bit width and named bit fields", async () => {
    const table = findTiRegisterMap((await analyzePdfFile(FIXTURE)).pages);
    const deviceConfig = table?.registers.find((r) => r.name === "DEVICE_CONFIG");
    expect(deviceConfig?.width).toBe(16);
    expect(deviceConfig?.bitFields).toContainEqual({ name: "CONV_AVG", msb: 14, lsb: 12 });
    // Every register is 16-bit and the config registers carry bit fields.
    expect(table?.registers.every((r) => r.width === 16)).toBe(true);
    const withFields = table?.registers.filter((r) => r.bitFields.length > 0) ?? [];
    expect(withFields.length).toBeGreaterThan(10);
  });
});
