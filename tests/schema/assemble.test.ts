import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import type { PageContent, PdfAnalysis, PositionedText } from "../../src/pdf/types";

const bme280 = fileURLToPath(new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url));
const sht3x = fileURLToPath(new URL("../fixtures/sht3x-datasheet.pdf", import.meta.url));

describe.skipIf(!existsSync(bme280))("assembleDatasheet — BME280 (register_map)", () => {
  it("assembles a validated register-map contract from the pipeline", async () => {
    const json = assembleDatasheet(await analyzePdfFile(bme280));
    expect(json.metadata.part).toBe("BME280");
    expect(json.metadata.manufacturer).toBe("Bosch Sensortec");
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind === "register_map") {
      expect(json.interface.registers.length).toBeGreaterThan(5);
      expect(json.interface.registers.some((r) => r.name === "id")).toBe(true);
    }
    expect(json.validation.valid).toBe(true);
  });
});

describe.skipIf(!existsSync(sht3x))("assembleDatasheet — SHT3x (command_set)", () => {
  it("assembles a validated command-set contract from the pipeline", async () => {
    const json = assembleDatasheet(await analyzePdfFile(sht3x));
    expect(json.metadata.manufacturer).toBe("Sensirion");
    expect(json.interface.kind).toBe("command_set");
    expect(json.protocol.bus).toBe("I2C");
    if (json.interface.kind === "command_set") {
      expect(json.interface.commands.length).toBeGreaterThan(0);
    }
  });
});

// --- Session 10 / Contract A — analyze hints wired into assembly (F1) -------
//
// `assembleDatasheet` gains an optional second parameter:
//   opts?: {
//     manufacturerHint?: string;
//     interfaceKindHint?: "register_map" | "command_set";
//   }
// These are synthesized PdfAnalysis fixtures (no PDF fixture needed — mirrors
// the pure-pages style used in graceful-degradation.test.ts) so the pin runs on
// every clone, not just ones with the git-ignored reference PDFs.

const page = (index: number, text: string): PageContent => ({
  index,
  text,
  items: [],
  hasImage: false,
});

const analysisOf = (pages: PageContent[]): PdfAnalysis => ({
  type: "text_based",
  pageCount: pages.length,
  pageMap: {},
  pages,
  warnings: [],
});

describe("assembleDatasheet — opts.interfaceKindHint overrides detection (F1)", () => {
  // Register-keyword-only text: detectInterfaceKind lands on "register_map"
  // (registerScore=2, commandScore=0) with no actual table, so buildInterface's
  // register branch runs and produces an (empty) register_map by default.
  const analysis = analysisOf([
    page(7, "7 Register map — the following registers are available"),
  ]);

  it("classifies as register_map with no opts (baseline, today's behavior)", () => {
    const json = assembleDatasheet(analysis);
    expect(json.interface.kind).toBe("register_map");
  });

  it("forces the command_set branch when interfaceKindHint is supplied, overriding detection", () => {
    const json = assembleDatasheet(analysis, { interfaceKindHint: "command_set" });
    expect(json.interface.kind).toBe("command_set");
  });
});

describe("assembleDatasheet — opts.manufacturerHint (F1)", () => {
  it("applies the hint when detection lands on generic (no confident vendor)", () => {
    const analysis = analysisOf([
      page(
        1,
        "Generic Sensor XYZ123 communicates over I2C and exposes a register map of control registers.",
      ),
    ]);
    // Confirm the fixture really is a generic-detection case before hint-ing it.
    const baseline = assembleDatasheet(analysis);
    expect(baseline.metadata.manufacturer).toBe("generic");
    expect(baseline.metadata.manufacturerConfidence).toBe(0);

    const json = assembleDatasheet(analysis, { manufacturerHint: "Acme Sensors" });
    expect(json.metadata.manufacturer).toBe("Acme Sensors");
    expect(json.metadata.manufacturerConfidence).toBe(0.5);
  });

  it("is ignored when detection is confident (Bosch Sensortec copyright + domain)", () => {
    const analysis = analysisOf([
      page(
        1,
        "Bosch Sensortec — see www.bosch-sensortec.com for the full register map.",
      ),
    ]);
    const baseline = assembleDatasheet(analysis);
    expect(baseline.metadata.manufacturer).toBe("Bosch Sensortec");

    const json = assembleDatasheet(analysis, { manufacturerHint: "Should Be Ignored" });
    expect(json.metadata.manufacturer).toBe("Bosch Sensortec");
    expect(json.metadata.manufacturer).not.toBe("Should Be Ignored");
    expect(json.metadata.manufacturerConfidence).toBe(baseline.metadata.manufacturerConfidence);
  });
});

// --- Session 11 / Phase D — Maxim register-matrix adapter wiring (RED) ------
//
// buildInterface's fallback chain gains a new slot: findMaximRegisterMap, tried
// after findTiRegisterMap and before findGenericRegisterTable (mirrors how
// findTiRegisterMap itself is wired in). This is a minimal end-to-end pin that
// the chain actually reaches the new adapter through assembleDatasheet — the
// fixture-level golden (max30102-golden.test.ts) carries the full weight.
//
// The synthetic page below is shaped like Maxim's register-matrix table
// ("REGISTER | B7..B0 | REG ADDR | POR STATE | R/W", header stacked across two
// lines) and is NOT parseable by findRegisterTable (BME280/Microchip) or
// findTiRegisterMap (TI's Offset/Acronym summary shape). A multi-bit field
// (msb > lsb) is asserted specifically because findGenericRegisterTable — the
// adapter this one is slotted BEFORE — never produces bit fields (always `[]`),
// so seeing one here proves the Maxim adapter, not the generic fallback, is
// what produced this result.
const maximT = (str: string, x: number, width: number, y: number): PositionedText => ({
  str,
  x,
  y,
  width,
  height: 10,
});

function maximShapedPage(): PageContent {
  const items: PositionedText[] = [
    // Header, band-split across two lines (REG/ADDR and POR/STATE stacked).
    maximT("REGISTER", 40, 70, 100),
    maximT("B7", 140, 16, 100),
    maximT("B6", 160, 16, 100),
    maximT("B5", 180, 16, 100),
    maximT("B4", 200, 16, 100),
    maximT("B3", 220, 16, 100),
    maximT("B2", 240, 16, 100),
    maximT("B1", 260, 16, 100),
    maximT("B0", 280, 16, 100),
    maximT("REG", 310, 30, 100),
    maximT("POR", 350, 30, 100),
    maximT("R/W", 390, 24, 100),
    maximT("ADDR", 310, 30, 93),
    maximT("STATE", 350, 30, 93),
    // "Mode Configuration" (0x09): bare SHDN/RESET + a MODE[2:0] span
    // geometrically centered across B2..B0.
    maximT("MODE CONFIG", 40, 80, 70),
    maximT("SHDN", 133, 30, 70),
    maximT("RESET", 153, 30, 70),
    maximT("MODE[2:0]", 238, 60, 70),
    maximT("0x09", 310, 30, 70),
    maximT("0x00", 350, 30, 70),
  ];
  return { index: 9, text: "", items, hasImage: false };
}

describe("assembleDatasheet — buildInterface reaches findMaximRegisterMap (Phase D wiring)", () => {
  it("flows a Maxim register-matrix page through into interface.registers with a real bit field", () => {
    const analysis = analysisOf([maximShapedPage()]);
    const json = assembleDatasheet(analysis);
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") return;
    const modeConfig = json.interface.registers.find((r) => r.name === "MODE CONFIG");
    expect(modeConfig?.address).toBe("0x09");
    expect(modeConfig?.bitFields).toContainEqual({ name: "MODE", msb: 2, lsb: 0 });
    // Proves a specialized adapter (not the bitField-less generic fallback) fired.
    expect(json.interface.registers.some((r) => r.bitFields.some((bf) => bf.msb > bf.lsb))).toBe(
      true,
    );
  });
});
