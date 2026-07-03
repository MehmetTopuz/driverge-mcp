import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { detectManufacturer } from "../../src/pdf/manufacturer";

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

describe("detectManufacturer", () => {
  it("identifies Bosch from copyright + doc-number + url", () => {
    const r = detectManufacturer([
      page(
        "© Bosch Sensortec GmbH. Document number BST-BME280-DS001-23. www.bosch-sensortec.com BME280",
      ),
    ]);
    expect(r.manufacturer).toBe("Bosch Sensortec");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.signals).toContain("copyright");
  });

  it("identifies Microchip (part-prefix collisions resolved by strong signals)", () => {
    const r = detectManufacturer([
      page("Microchip Technology Inc. DS20001952C microchip.com MCP23017"),
    ]);
    expect(r.manufacturer).toBe("Microchip");
    expect(r.signals).toContain("doc-number");
  });

  it("falls back to generic on a lone part-prefix (no strong signals)", () => {
    const r = detectManufacturer([
      page("The MCP23017 device provides general-purpose parallel I/O expansion."),
    ]);
    expect(r.manufacturer).toBe("generic");
    expect(r.confidence).toBe(0);
  });

  it("identifies TI, Aosong, Broadcom, and Infineon from strong signals", () => {
    expect(detectManufacturer([page("Texas Instruments SBAS934A ti.com TMAG5170-Q1")]).manufacturer).toBe("Texas Instruments");
    expect(detectManufacturer([page("Aosong(Guangzhou) Electronics aosong.com DHT20")]).manufacturer).toBe("Aosong");
    expect(detectManufacturer([page("Broadcom Inc. broadcom.com AEAT-8811-Q24")]).manufacturer).toBe("Broadcom");
    expect(detectManufacturer([page("Infineon Technologies AG www.infineon.com TLE5014")]).manufacturer).toBe("Infineon");
  });
});

const TMAG = fileURLToPath(
  new URL("../fixtures/tmag5170-q1.pdf", import.meta.url),
);

describe.skipIf(!existsSync(TMAG))("detectManufacturer (real TMAG5170)", () => {
  it("detects Texas Instruments", async () => {
    const r = detectManufacturer((await analyzePdfFile(TMAG)).pages);
    expect(r.manufacturer).toBe("Texas Instruments");
  });
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("detectManufacturer (real BME280)", () => {
  it("detects Bosch Sensortec with high confidence", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const r = detectManufacturer(analysis.pages);
    expect(r.manufacturer).toBe("Bosch Sensortec");
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});

// MCP23017 fixture-gated — activates once tests/fixtures/mcp23017-datasheet.pdf
// is provided; validates the Microchip / register_map generalization.
const MCP = fileURLToPath(
  new URL("../fixtures/mcp23017-datasheet.pdf", import.meta.url),
);

describe.skipIf(!existsSync(MCP))("detectManufacturer (real MCP23017)", () => {
  it("detects Microchip", async () => {
    const analysis = await analyzePdfFile(MCP);
    const r = detectManufacturer(analysis.pages);
    expect(r.manufacturer).toBe("Microchip");
  });
});
