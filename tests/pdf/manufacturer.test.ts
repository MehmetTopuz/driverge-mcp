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

  // Session 11 Phase C — cross-vendor scorecard evidence: adxl345.pdf and
  // max30102.pdf and mlx90614.pdf all report manufacturer "generic" today
  // because VENDORS has no Analog Devices, Maxim Integrated, or Melexis entry.
  describe("cross-vendor Phase C additions (Analog Devices, Maxim Integrated, Melexis)", () => {
    it("identifies Analog Devices from copyright + domain (ADXL345)", () => {
      const r = detectManufacturer([
        page("© Analog Devices, Inc. www.analog.com ADXL345 Digital Accelerometer datasheet."),
      ]);
      expect(r.manufacturer).toBe("Analog Devices");
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(r.signals).toContain("copyright");
      expect(r.signals).toContain("url");
    });

    // Maxim Integrated was acquired by Analog Devices in 2021, but MUST stay a
    // separate VENDORS entry: Maxim-era sheets (e.g. MAX30102's) carry Maxim
    // branding, not Analog Devices branding, and merging the two would lose
    // the "doc-number"/"copyright" strong signal that actually appears on them.
    it("identifies Maxim Integrated from copyright + domain (MAX30102), kept distinct from Analog Devices", () => {
      const r = detectManufacturer([
        page(
          "© Maxim Integrated Products, Inc. www.maximintegrated.com MAX30102 Pulse Oximeter and Heart-Rate Sensor.",
        ),
      ]);
      expect(r.manufacturer).toBe("Maxim Integrated");
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(r.signals).toContain("copyright");
      expect(r.signals).toContain("url");
    });

    it("identifies Melexis from copyright + domain (MLX90614)", () => {
      const r = detectManufacturer([
        page("© Melexis NV. www.melexis.com MLX90614 Infrared Thermometer datasheet."),
      ]);
      expect(r.manufacturer).toBe("Melexis");
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(r.signals).toContain("copyright");
      expect(r.signals).toContain("url");
    });

    // Guard pin: a lone weak part-prefix signal must stay below MIN_SCORE and
    // fall back to generic, exactly like the existing MCP23017 guard test.
    it("falls back to generic on a lone part-prefix for the new vendors (no strong signals)", () => {
      expect(
        detectManufacturer([page("The ADXL345 is a small, thin, low-power accelerometer.")])
          .manufacturer,
      ).toBe("generic");
      expect(
        detectManufacturer([
          page("MAX30102 integrates pulse oximetry and heart-rate monitor sensors."),
        ]).manufacturer,
      ).toBe("generic");
      expect(
        detectManufacturer([page("The MLX90614 measures object and ambient temperature.")])
          .manufacturer,
      ).toBe("generic");
    });
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
