import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { GeneratedFile } from "../../src/codegen/types";
import type { DatasheetJson } from "../../src/schema/types";
import { registerDatasheet } from "./helpers";

const json = registerDatasheet("bme280.golden.json", "BME280");
const skeleton = generatePortableDriver(json).files;

// Simulate a host AI that finished its work: drop the TODO(driverge) markers.
// Everything else in the skeleton is already valid, thin-HAL-pure C.
function completed(): GeneratedFile[] {
  return skeleton.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));
}

function withSource(mutate: (c: string) => string): GeneratedFile[] {
  return completed().map((f) =>
    f.path.endsWith(".c") ? { path: f.path, content: mutate(f.content) } : f,
  );
}

describe("lintDriver", () => {
  it("passes a completed, thin-HAL-pure driver", () => {
    const r = lintDriver(completed(), json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects the raw skeleton (leftover TODO(driverge) markers)", () => {
    const r = lintDriver(skeleton, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/TODO\(driverge\)/);
  });

  it("rejects a direct vendor peripheral call (STM32 CubeHAL)", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "HAL_I2C_Master_Transmit(0,0,0,0,0);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/CubeHAL|hal_\* seam/);
  });

  it("rejects an Arduino Wire call", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "Wire.write(0);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Arduino/);
  });

  it("rejects an unknown HAL function outside the thin seam", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "hal_gpio_set(1);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_gpio_set/);
  });

  it("rejects a reference to an undefined register constant", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "(void)BME280_REG_BOGUS;\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/BME280_REG_BOGUS/);
  });

  it("rejects a corrupted bit-field mask", () => {
    const bad = completed().map((f) =>
      f.path.endsWith(".h")
        ? { path: f.path, content: f.content.replace("BME280_CTRL_MEAS_OSRS_T_MASK  0xE0", "BME280_CTRL_MEAS_OSRS_T_MASK  0x00") }
        : f,
    );
    const r = lintDriver(bad, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/OSRS_T_MASK/);
  });

  it("ignores braces/parens inside string and char literals when checking balance (B2 regression pin)", () => {
    const r = lintDriver(
      withSource(
        (c) =>
          `${c}\nstatic const char *fmt = "{ (";\nstatic const char open_brace = '{';\n`,
      ),
      json,
    );
    expect(r.errors.filter((e) => /unbalanced/.test(e))).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects unbalanced braces", () => {
    const r = lintDriver(
      withSource((c) => `${c}\nint stray(void) {`),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/braces/);
  });
});

describe("lintDriver — completed deferred driver", () => {
  // A deferred datasheet has no registers in its JSON; the host AI adds them while
  // completing the skeleton. Lint must not flag those host-added registers as
  // hallucinated (they are defined + used within the files it checks).
  const deferred: DatasheetJson = {
    metadata: {
      part: "AEAT8811",
      manufacturer: "Broadcom",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 40,
    },
    protocol: { bus: "SPI" },
    interface: { kind: "register_map", registers: [] },
    extraction: { status: "deferred", detectedPages: [23] },
    validation: { valid: true, errors: [], warnings: [] },
  };

  it("passes when the host AI adds registers absent from the (deferred) JSON, using the combined hal_spi_transfer seam", () => {
    const files = generatePortableDriver(deferred).files.map((f) => {
      let c = f.content.replace(/TODO\(driverge\)/g, "done");
      if (f.path.endsWith(".h")) c += "\n#define AEAT8811_REG_STATUS 0x01\n";
      if (f.path.endsWith(".c")) {
        c +=
          "\nint aeat8811_status(aeat8811_t *dev, uint8_t *v) {\n" +
          "    uint8_t r = AEAT8811_REG_STATUS;\n" +
          "    (void)dev;\n" +
          "    hal_spi_transfer(&r, 1, v, 1);\n" +
          "    return 0;\n}\n";
      }
      return { path: f.path, content: c };
    });
    const r = lintDriver(files, deferred);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
});

describe("lintDriver — SPI seam family (Session A: single hal_spi_transfer)", () => {
  // HAL_ALLOWED narrows to hal_i2c_read, hal_i2c_write, hal_spi_transfer,
  // hal_delay_ms — the retired hal_spi_write/hal_spi_read pair must now fail
  // lint as an unknown HAL function (see decisions: thin-hal-non-negotiable).
  const spiJson: DatasheetJson = {
    metadata: {
      part: "TMAG5170",
      manufacturer: "Texas Instruments",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "SPI" },
    interface: {
      kind: "register_map",
      registers: [
        { name: "ctrl", address: "0x00", reset: "0x00", width: 8, bitFields: [] },
      ] as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
  const spiSkeleton = generatePortableDriver(spiJson).files;
  const completedSpi = (): GeneratedFile[] =>
    spiSkeleton.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));

  it("passes a completed SPI driver that calls only the combined hal_spi_transfer seam", () => {
    const r = lintDriver(completedSpi(), spiJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects a driver that still calls the retired hal_spi_write", () => {
    const withOldSeam = completedSpi().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_spi_write(0, 0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withOldSeam, spiJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_spi_write/);
  });

  it("rejects a driver that still calls the retired hal_spi_read", () => {
    const withOldSeam = completedSpi().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_spi_read(0, 0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withOldSeam, spiJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_spi_read/);
  });
});

describe("lintDriver — 16-bit register masks", () => {
  const json16: DatasheetJson = {
    metadata: {
      part: "WIDE16",
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "SPI" },
    interface: {
      kind: "register_map",
      registers: [
        {
          name: "ctrl",
          address: "0x00",
          reset: "0x0000",
          width: 16,
          bitFields: [{ name: "gain", msb: 11, lsb: 8 }],
        },
      ] as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };

  it("accepts a width-correct 16-bit mask (not falsely flagged against 8-bit geometry)", () => {
    const files = generatePortableDriver(json16).files.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));
    const r = lintDriver(files, json16);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
});
