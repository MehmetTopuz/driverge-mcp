import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import type { PageContent, PdfAnalysis } from "../../src/pdf/types";

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
