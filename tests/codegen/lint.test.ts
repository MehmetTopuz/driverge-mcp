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

describe("lintDriver — UART seam family (Session B: hal_uart_write/hal_uart_read)", () => {
  // HAL_ALLOWED gains hal_uart_write/hal_uart_read alongside hal_i2c_read,
  // hal_i2c_write, hal_spi_transfer, hal_delay_ms — a completed UART driver that
  // calls the new seam must pass; any other hal_* name must still trip lint.
  const uartJson: DatasheetJson = {
    metadata: {
      part: "MHZ19",
      manufacturer: "Winsen",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "UART" },
    interface: {
      kind: "register_map",
      registers: [
        { name: "ctrl", address: "0x00", reset: "0x00", width: 8, bitFields: [] },
      ] as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
  const uartSkeleton = generatePortableDriver(uartJson).files;
  const completedUart = (): GeneratedFile[] =>
    uartSkeleton.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));

  it("passes a completed UART driver that calls hal_uart_write/hal_uart_read (the new thin-HAL seam family)", () => {
    const withSeamCalls = completedUart().map((f) =>
      f.path.endsWith(".c")
        ? {
            path: f.path,
            content: f.content.replace(
              "return 0;",
              "hal_uart_write((const uint8_t *)&reg, 1);\n    hal_uart_read(&reg, 1, 100);\n    return 0;",
            ),
          }
        : f,
    );
    const r = lintDriver(withSeamCalls, uartJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects an unknown hal_* function outside the UART seam", () => {
    const withUnknown = completedUart().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_uart_flush();\n    return 0;") }
        : f,
    );
    const r = lintDriver(withUnknown, uartJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_uart_flush/);
  });
});

describe("lintDriver — CAN seam family (Session C: hal_can_transfer)", () => {
  // HAL_ALLOWED gains hal_can_transfer alongside hal_i2c_read, hal_i2c_write,
  // hal_spi_transfer, hal_uart_write, hal_uart_read, hal_delay_ms — a completed
  // CAN driver that calls the new seam must pass; any other hal_can_* name (e.g.
  // a hypothetical hal_can_filter) must still trip lint as unknown.
  const canJson: DatasheetJson = {
    metadata: {
      part: "CANTEMP",
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "CAN" },
    interface: {
      kind: "register_map",
      registers: [
        { name: "ctrl", address: "0x00", reset: "0x00", width: 8, bitFields: [] },
      ] as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;
  const canSkeleton = generatePortableDriver(canJson).files;
  const completedCan = (): GeneratedFile[] =>
    canSkeleton.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));

  it("passes a completed CAN driver that calls hal_can_transfer (the new thin-HAL seam family)", () => {
    const withSeamCall = completedCan().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_can_transfer(0,0,0,0,0,0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withSeamCall, canJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects an unknown hal_can_* function outside the allowed seam (e.g. hal_can_filter)", () => {
    const withUnknown = completedCan().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_can_filter(0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withUnknown, canJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_can_filter/);
  });
});

describe("lintDriver — HAL_ALLOWED full family (I2C/SPI/UART/CAN + delay, Session C)", () => {
  // Direct pin of the complete allowed family named in the orchestrator contract:
  // hal_i2c_read, hal_i2c_write, hal_spi_transfer, hal_uart_write, hal_uart_read,
  // hal_can_transfer, hal_delay_ms. lintDriver does not check that a seam call
  // matches the part's OWN bus — only that the function name is a member of the
  // allowed family — so all seven can be exercised together on one (I2C) skeleton.
  it("accepts every allowed hal_* seam function name in one file", () => {
    const allowedCalls = [
      "hal_i2c_read(0,0,0,0);",
      "hal_i2c_write(0,0,0,0);",
      "hal_spi_transfer(0,0,0,0);",
      "hal_uart_write(0,0);",
      "hal_uart_read(0,0,0);",
      "hal_can_transfer(0,0,0,0,0,0);",
      "hal_delay_ms(0);",
    ].join("\n    ");
    const files = completed().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", `${allowedCalls}\n    return 0;`) }
        : f,
    );
    const r = lintDriver(files, json);
    expect(r.errors.filter((e) => /unknown HAL function/.test(e))).toEqual([]);
  });
});

describe("lintDriver — ESP-IDF TWAI forbidden in the CORE, allowed in the seam file (Session C)", () => {
  // FORBIDDEN gains ESP-IDF TWAI (/\btwai_\w+/): a core file calling twai_transmit
  // must fail lint, but the same call inside a *_hal_esp32.c seam file is exempt
  // (isHalImpl) — mirrors the existing i2c_master_*/spi_device_* ESP-IDF pins.
  it("rejects an ESP-IDF TWAI call (twai_transmit) that leaks into a core file", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "twai_transmit(0,0);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/ESP-IDF/);
  });

  it("does not flag the same twai_transmit call inside a *_hal_esp32.c seam file (isHalImpl exemption)", () => {
    const files = completed().map((f) =>
      f.path.endsWith(".c")
        ? {
            path: "bme280_hal_esp32.c",
            content: f.content.replace("return 0;", "twai_transmit(0,0);\n    return 0;"),
          }
        : f,
    );
    const r = lintDriver(files, json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
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

// ---------------------------------------------------------------------------
// Session E (2026-07-11 STM32 field-test findings — CAP1206/TUSS4470/FXL6408,
// raw/stm32-test-results/*.md + the approved plan): every thin-HAL seam symbol
// is now PER-DRIVER PREFIXED (`<slug>_hal_*`, slug = slug(json.metadata.part)).
// lintDriver's HAL_ALLOWED / scan regex must recognize this family, keyed off
// the SAME json passed to lintDriver.
// ---------------------------------------------------------------------------

describe("lintDriver — per-driver prefixed seam family (<slug>_hal_*, field-test regression)", () => {
  const capJson: DatasheetJson = {
    metadata: {
      part: "CAP1206",
      manufacturer: "Microchip",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x28"] },
    interface: {
      kind: "register_map",
      registers: [
        { name: "ctrl", address: "0x00", reset: "0x00", width: 8, bitFields: [] },
      ] as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
  const capSkeleton = generatePortableDriver(capJson).files;
  const completedCap = (): GeneratedFile[] =>
    capSkeleton.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));

  it("passes a completed driver that calls only its OWN prefixed seam (cap1206_hal_i2c_read/write/delay_ms) — the generator itself must emit the prefixed names", () => {
    const files = completedCap();
    const core = files.find((f) => f.path.endsWith(".c"))!.content;
    // Ties the generator output to the lint contract: a driver whose core does
    // NOT call the prefixed seam at all cannot honestly exercise this pin.
    expect(core).toContain("cap1206_hal_i2c_write");
    expect(core).toContain("cap1206_hal_delay_ms");
    const r = lintDriver(files, capJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.warnings.filter((w) => /unprefixed/i.test(w))).toEqual([]);
  });

  // CRITICAL regression pin (the actual CAP1206 field-test blind spot): the
  // OLD scan regex `/\bhal_[a-z0-9_]+/` requires a word boundary immediately
  // before "hal_" — but "cap1206_hal_i2c_wrte" has "_" (a word character)
  // right before "hal_", so there is NO boundary there and the old regex
  // never even sees this token. A driver whose core mistypes a PREFIXED seam
  // call must still be caught as an unknown HAL function.
  it("CRITICAL: catches a mistyped prefixed seam call (cap1206_hal_i2c_wrte) that the old bare \\bhal_ scan could never see", () => {
    const mistyped = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? {
            path: f.path,
            content: f.content.replace(
              "return 0;",
              "cap1206_hal_i2c_wrte(0,0,0,0);\n    return 0;",
            ),
          }
        : f,
    );
    const r = lintDriver(mistyped, capJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/cap1206_hal_i2c_wrte/);
  });

  it("rejects an unknown prefixed seam function (cap1206_hal_foo — right prefix, wrong family member)", () => {
    const withUnknown = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "cap1206_hal_foo(0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withUnknown, capJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/cap1206_hal_foo/);
  });

  it("downgrades a bare LEGACY seam call (hal_i2c_write) to a warning, not an error — driver stays valid", () => {
    const withBare = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_i2c_write(0,0,0,0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withBare, capJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).toMatch(
      /unprefixed seam symbol — collides in multi-driver projects/i,
    );
    expect(r.warnings.join("\n")).toMatch(/hal_i2c_write/);
  });

  it("downgrades bare hal_delay_ms to a warning too (the exact symbol from the field-test link collisions)", () => {
    const withBare = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_delay_ms(1);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withBare, capJson);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).toMatch(/unprefixed seam symbol/i);
    expect(r.warnings.join("\n")).toMatch(/hal_delay_ms/);
  });

  it("still hard-errors a bare UNKNOWN seam call (hal_gpio_set) — not eligible for the warning downgrade", () => {
    const withUnknownBare = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_gpio_set(1);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withUnknownBare, capJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_gpio_set/);
  });

  it("still hard-errors the retired bare hal_spi_write/hal_spi_read (never a legal name, prefixed or not)", () => {
    const withRetired = completedCap().map((f) =>
      f.path.endsWith(".c")
        ? { path: f.path, content: f.content.replace("return 0;", "hal_spi_write(0,0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(withRetired, capJson);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_spi_write/);
  });
});

describe("lintDriver — seam companion header (_hal_<target>.h/.hpp) is exempt from core purity (isHalImpl covers headers too)", () => {
  // Concrete field-test shape (CAP1206/FXL6408 reports): the ESP32 companion
  // header declares a bind() prototype using vendor handle types (e.g.
  // i2c_master_bus_handle_t), which matches FORBIDDEN's ESP-IDF regex
  // (`\bi2c_master_\w+`). isHalImpl's regex is `_hal_[a-z0-9]+\.(?:c|cpp)$`
  // today — it does NOT match ".h"/".hpp", so a companion header is
  // (incorrectly) scanned as core content and trips the ESP-IDF FORBIDDEN
  // check even though it is legitimate seam-implementation surface.
  it("does not flag ESP-IDF vendor types (i2c_master_bus_handle_t) inside a bme280_hal_esp32.h companion header", () => {
    const header: GeneratedFile = {
      path: "bme280_hal_esp32.h",
      content: [
        "#ifndef BME280_HAL_ESP32_H",
        "#define BME280_HAL_ESP32_H",
        "",
        "#ifdef __cplusplus",
        'extern "C" {',
        "#endif",
        "",
        '#include "driver/i2c_master.h"',
        "",
        "esp_err_t bme280_esp32_bind(i2c_master_bus_handle_t bus, uint32_t scl_speed_hz);",
        "",
        "#ifdef __cplusplus",
        "}",
        "#endif",
        "#endif /* BME280_HAL_ESP32_H */",
        "",
      ].join("\n"),
    };
    const r = lintDriver([...completed(), header], json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("does the same for a C++ companion header (.hpp) — isHalImpl covers both extensions", () => {
    const header: GeneratedFile = {
      path: "bme280_hal_esp32.hpp",
      content: [
        "#ifndef BME280_HAL_ESP32_HPP",
        "#define BME280_HAL_ESP32_HPP",
        "",
        "#ifdef __cplusplus",
        'extern "C" {',
        "#endif",
        "",
        '#include "driver/i2c_master.h"',
        "",
        "esp_err_t bme280_esp32_bind(i2c_master_bus_handle_t bus, uint32_t scl_speed_hz);",
        "",
        "#ifdef __cplusplus",
        "}",
        "#endif",
        "#endif /* BME280_HAL_ESP32_HPP */",
        "",
      ].join("\n"),
    };
    const r = lintDriver([...completed(), header], json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("regression contrast: the SAME i2c_master_bus_handle_t content DOES trip FORBIDDEN when it leaks into the core (non-exempt filename)", () => {
    const leaked = withSource((c) =>
      c.replace("return 0;", "i2c_master_bus_handle_t bogus;\n    return 0;"),
    );
    const r = lintDriver(leaked, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/ESP-IDF/);
  });
});
