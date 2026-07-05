import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";

// RED (Session 11 / Phase D) — fixture-gated pin for the MAX30102 (Maxim)
// register-matrix table ("Register Maps and Descriptions", pages 10-22: REGISTER
// | B7..B0 | REG ADDR | POR STATE | R/W). Skips on a clone lacking the
// git-ignored fixture PDF (see tests/fixtures/README.md).
//
// Today (before findMaximRegisterMap exists and is wired into
// buildInterface/assemble.ts) this whole pipeline yields 0 registers and a
// `deferred` extraction status — see tests/scorecard/scorecard.snap.md's
// max30102.pdf row. This test pins the FLOOR the new adapter must clear:
// >= 8 registers, at least one multi-bit field, and a non-`none` extraction
// status. It intentionally does NOT pin exact register names/addresses/bit
// positions yet — the byte-exact golden JSON (mirroring bme280.golden.json /
// tmag5170.golden.json) gets committed in a follow-up RED once the adapter is
// GREEN on this floor and its real output can be hand-verified against the
// datasheet.
const FIXTURE = fileURLToPath(new URL("../fixtures/max30102.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("MAX30102 (Maxim) register-matrix extraction", () => {
  it("extracts a real register map via the Maxim adapter (not 0/deferred)", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const json = assembleDatasheet(analysis);

    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") return;

    // Today: 0. The datasheet lists 19+ addressable registers (0x00-0x21, 0xFE,
    // 0xFF) across Interrupt Status/Enable, FIFO, Configuration, Temperature and
    // Part ID — >= 8 is a conservative floor, not the final count.
    expect(json.interface.registers.length).toBeGreaterThanOrEqual(8);

    // At least one register (e.g. Mode Configuration's MODE[2:0], or SpO2
    // Configuration's SPO2_ADC_RGE[1:0]/SPO2_SR[2:0]) must carry a real
    // multi-bit span, not just address-only rows.
    const hasMultiBitField = json.interface.registers.some((r) =>
      r.bitFields.some((bf) => bf.msb > bf.lsb),
    );
    expect(hasMultiBitField).toBe(true);

    expect(["complete", "partial"]).toContain(json.extraction?.status);
  });
});
