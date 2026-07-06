import { beforeAll, describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { CODEGEN_LANGUAGES, type CodegenLanguage } from "../../src/codegen/types";
import type { DriverArtifact } from "../../src/codegen/types";
import type { DatasheetJson } from "../../src/schema/types";
import {
  commandDatasheet,
  registerDatasheet,
  spiRegisterDatasheet,
  uartRegisterDatasheet,
} from "./helpers";

// Session D: `generate_driver` gains a `language` option ("c" default | "cpp").
// The cpp flavor is a CLASS WRAPPER that keeps the same #define macro constants
// and the same extern "C" hal_* seam as the C output, so validate_driver's
// constant/mask scans and the native `_hal_<target>.c` seam files work
// unchanged. See wiki: thin-hal-non-negotiable, json-schema-as-contract.
//
// Every describe block below defers file lookup into beforeAll (run phase,
// via requireGenerated()) rather than at describe-body eval time (collection
// phase) — mirroring tests/codegen/esp32.test.ts's SPI/UART/CAN blocks — so a
// throw (missing .hpp file, today) fails each `it` individually and honestly
// instead of crashing the whole file's collection.

function lineWith(text: string, needle: string): string {
  const line = text.split("\n").find((l) => l.includes(needle));
  if (line === undefined) {
    throw new Error(`no line containing "${needle}" found in:\n${text}`);
  }
  return line;
}

function firstMatching(text: string, re: RegExp): string {
  const line = text.split("\n").find((l) => re.test(l));
  if (line === undefined) {
    throw new Error(`no line matching ${re} found in:\n${text}`);
  }
  return line;
}

function externCBlock(header: string): string {
  const match = /extern "C" \{([\s\S]*?)\n\}/.exec(header);
  if (!match) throw new Error(`no extern "C" { ... } block found in:\n${header}`);
  return match[1];
}

describe("codegen/types — CodegenLanguage contract", () => {
  it("exports CODEGEN_LANGUAGES = ['c', 'cpp']", () => {
    expect(CODEGEN_LANGUAGES).toEqual(["c", "cpp"]);
  });

  it("CodegenLanguage type accepts both members (compile-time pin)", () => {
    const c: CodegenLanguage = "c";
    const cpp: CodegenLanguage = "cpp";
    expect([c, cpp]).toEqual(["c", "cpp"]);
  });
});

// ---------------------------------------------------------------------------
// Section 1 — generateDriver gains a third optional `opts` param; omitted /
// {} / "c" must all be byte-identical to today's two-arg call, across a
// register_map I2C part, an SPI part, and a command_set part.
// ---------------------------------------------------------------------------

describe("generateDriver(json, target, opts) — language 'c' is the byte-identical default", () => {
  it("I2C register_map part (BME280): omitted / {} / {language:'c'} all equal the bare 2-arg call", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const bare = generateDriver(json, "portable");
    const empty = generateDriver(json, "portable", {});
    const explicitC = generateDriver(json, "portable", { language: "c" });
    expect(empty).toEqual(bare);
    expect(explicitC).toEqual(bare);
  });

  it("SPI register_map part (TMAG5170): omitted / {} / {language:'c'} all equal the bare 2-arg call", () => {
    const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
    const bare = generateDriver(json, "portable");
    const empty = generateDriver(json, "portable", {});
    const explicitC = generateDriver(json, "portable", { language: "c" });
    expect(empty).toEqual(bare);
    expect(explicitC).toEqual(bare);
  });

  it("command_set part (SHT3x): omitted / {} / {language:'c'} all equal the bare 2-arg call", () => {
    const json = commandDatasheet();
    const bare = generateDriver(json, "portable");
    const empty = generateDriver(json, "portable", {});
    const explicitC = generateDriver(json, "portable", { language: "c" });
    expect(empty).toEqual(bare);
    expect(explicitC).toEqual(bare);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — C++ portable output (register_map, I2C: BME280)
// ---------------------------------------------------------------------------

describe("generateDriver(json, 'portable', {language:'cpp'}) — register_map I2C (BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  let cArt: DriverArtifact;
  let cppArt: DriverArtifact;
  let cHeader: string;
  let hpp: string;
  let cpp: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      cArt = generateDriver(json, "portable");
      cppArt = generateDriver(json, "portable", { language: "cpp" });
      cHeader = cArt.files.find((f) => f.path === "bme280.h")!.content;
      hpp = cppArt.files.find((f) => f.path === "bme280.hpp")!.content;
      cpp = cppArt.files.find((f) => f.path === "bme280.cpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("emits exactly bme280.hpp and bme280.cpp — no .h/.c files", () => {
    requireGenerated();
    expect(cppArt.files.map((f) => f.path)).toEqual(["bme280.hpp", "bme280.cpp"]);
  });

  it("carries the SAME #define macros (I2C address, a register, a MASK/SHIFT pair) as the C header", () => {
    requireGenerated();
    const addrLine = lineWith(cHeader, "BME280_I2C_ADDR");
    const regLine = lineWith(cHeader, "BME280_REG_ID");
    const maskLine = firstMatching(cHeader, /_MASK\s+0x/);
    const shiftLine = firstMatching(cHeader, /_SHIFT\s+\d/);
    expect(hpp).toContain(addrLine);
    expect(hpp).toContain(regLine);
    expect(hpp).toContain(maskLine);
    expect(hpp).toContain(shiftLine);
  });

  it('wraps the seam declarations in extern "C" { ... }, same decl strings as the C header', () => {
    requireGenerated();
    const writeLine = lineWith(cHeader, "void hal_i2c_write(");
    const readLine = lineWith(cHeader, "void hal_i2c_read (");
    const delayLine = lineWith(cHeader, "void hal_delay_ms (");
    const block = externCBlock(hpp);
    expect(block).toContain(writeLine);
    expect(block).toContain(readLine);
    expect(block).toContain(delayLine);
  });

  it('declares the class AFTER the extern "C" block, never inside it', () => {
    requireGenerated();
    expect(hpp).toContain("class Bme280 {");
    const externIdx = hpp.indexOf('extern "C" {');
    const classIdx = hpp.indexOf("class Bme280 {");
    expect(externIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThan(externIdx);
  });

  it("uses the _HPP include-guard convention and #include <cstdint> (not stdint.h)", () => {
    requireGenerated();
    expect(hpp).toMatch(/#ifndef BME280_HPP\b/);
    expect(hpp).toMatch(/#define BME280_HPP\b/);
    expect(hpp).toMatch(/#endif[^\n]*BME280_HPP/);
    expect(hpp).toContain("#include <cstdint>");
    expect(hpp).not.toContain("stdint.h");
  });

  it("declares the exact public API: init(); readRegister(uint8_t reg, uint8_t &value); writeRegister(uint8_t reg, uint8_t value);", () => {
    requireGenerated();
    expect(hpp).toContain("int init();");
    expect(hpp).toContain("int readRegister(uint8_t reg, uint8_t &value);");
    expect(hpp).toContain("int writeRegister(uint8_t reg, uint8_t value);");
  });

  it("never emits a typedef struct handle (bme280_t) — the class replaces it", () => {
    requireGenerated();
    expect(hpp).not.toMatch(/typedef struct/);
    expect(hpp).not.toMatch(/\bbme280_t\b/);
    expect(cpp).not.toMatch(/\bbme280_t\b/);
  });

  it("the .cpp defines Bme280:: methods, keeps the TODO(driverge) marker, and calls the I2C seam", () => {
    requireGenerated();
    expect(cpp).toMatch(/int\s+Bme280::init\(\)/);
    expect(cpp).toMatch(/Bme280::readRegister/);
    expect(cpp).toMatch(/Bme280::writeRegister/);
    expect(cpp).toContain("TODO(driverge)");
    expect(cpp).toMatch(/hal_i2c_read\(/);
    expect(cpp).toMatch(/hal_i2c_write\(/);
  });

  it("fill_in_brief has the same keys as the C artifact for the same datasheet", () => {
    requireGenerated();
    expect(Object.keys(cppArt.fill_in_brief).sort()).toEqual(
      Object.keys(cArt.fill_in_brief).sort(),
    );
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "portable", { language: "cpp" }).files).toEqual(cppArt.files);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — SPI part (TMAG5170), class name PascalCase of the slug
// ---------------------------------------------------------------------------

describe("generateDriver(json, 'portable', {language:'cpp'}) — SPI register_map (TMAG5170)", () => {
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  let cHeader: string;
  let hpp: string;
  let cpp: string;
  let cppArt: DriverArtifact;
  let thrown: unknown;

  beforeAll(() => {
    try {
      const cArt = generateDriver(json, "portable");
      cppArt = generateDriver(json, "portable", { language: "cpp" });
      cHeader = cArt.files.find((f) => f.path === "tmag5170.h")!.content;
      hpp = cppArt.files.find((f) => f.path === "tmag5170.hpp")!.content;
      cpp = cppArt.files.find((f) => f.path === "tmag5170.cpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("emits exactly tmag5170.hpp and tmag5170.cpp", () => {
    requireGenerated();
    expect(cppArt.files.map((f) => f.path)).toEqual(["tmag5170.hpp", "tmag5170.cpp"]);
  });

  it("class name is PascalCase of the slug: Tmag5170", () => {
    requireGenerated();
    expect(hpp).toContain("class Tmag5170 {");
  });

  it('wraps the combined hal_spi_transfer seam in extern "C", same decl string as the C header', () => {
    requireGenerated();
    const transferLine = lineWith(cHeader, "void hal_spi_transfer(");
    const block = externCBlock(hpp);
    expect(block).toContain(transferLine);
  });

  it("carries the same register #define as the C header", () => {
    requireGenerated();
    const regLine = firstMatching(cHeader, /^#define TMAG5170_REG_/);
    expect(hpp).toContain(regLine);
  });

  it("routes readRegister/writeRegister through hal_spi_transfer in the .cpp", () => {
    requireGenerated();
    expect(cpp).toMatch(/hal_spi_transfer\(/);
  });

  it("never emits a typedef struct handle (tmag5170_t)", () => {
    requireGenerated();
    expect(hpp).not.toMatch(/typedef struct/);
    expect(hpp).not.toMatch(/\btmag5170_t\b/);
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "portable", { language: "cpp" }).files).toEqual(cppArt.files);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — command_set part (SHT3x): class exposes a method per public C
// function, camelCase.
// ---------------------------------------------------------------------------

describe("generateDriver(json, 'portable', {language:'cpp'}) — command_set (SHT3x)", () => {
  const json = commandDatasheet();
  let cArt: DriverArtifact;
  let cppArt: DriverArtifact;
  let cHeader: string;
  let hpp: string;
  let cpp: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      cArt = generateDriver(json, "portable");
      cppArt = generateDriver(json, "portable", { language: "cpp" });
      cHeader = cArt.files.find((f) => f.path === "sht3x.h")!.content;
      hpp = cppArt.files.find((f) => f.path === "sht3x.hpp")!.content;
      cpp = cppArt.files.find((f) => f.path === "sht3x.cpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("emits exactly sht3x.hpp and sht3x.cpp", () => {
    requireGenerated();
    expect(cppArt.files.map((f) => f.path)).toEqual(["sht3x.hpp", "sht3x.cpp"]);
  });

  it("class name is Sht3x", () => {
    requireGenerated();
    expect(hpp).toContain("class Sht3x {");
  });

  it("carries the same command #define and CRC macros as the C header", () => {
    requireGenerated();
    const cmdLine = lineWith(cHeader, "SHT3X_CMD_SOFT_RESET");
    const crcPolyLine = lineWith(cHeader, "SHT3X_CRC_POLY");
    const crcInitLine = lineWith(cHeader, "SHT3X_CRC_INIT");
    expect(hpp).toContain(cmdLine);
    expect(hpp).toContain(crcPolyLine);
    expect(hpp).toContain(crcInitLine);
  });

  it("exposes a method per public C function, camelCase: init/sendCommand/readData/crc8", () => {
    requireGenerated();
    expect(hpp).toContain("int init();");
    expect(hpp).toMatch(/int\s+sendCommand\(uint16_t\s+\w+\)\s*;/);
    expect(hpp).toMatch(/int\s+readData\(uint8_t\s*\*\s*\w+,\s*uint16_t\s+\w+\)\s*;/);
    expect(hpp).toMatch(/uint8_t\s+crc8\(const uint8_t\s*\*\s*\w+,\s*uint16_t\s+\w+\)\s*;/);
  });

  it("never leaves the raw C-prefixed prototypes (sht3x_send_command) in the class declaration", () => {
    requireGenerated();
    expect(hpp).not.toMatch(/\bsht3x_send_command\b/);
    expect(hpp).not.toMatch(/\bsht3x_read_data\b/);
  });

  it("the .cpp defines Sht3x:: methods and keeps the CRC TODO(driverge) marker", () => {
    requireGenerated();
    expect(cpp).toMatch(/Sht3x::sendCommand/);
    expect(cpp).toMatch(/Sht3x::crc8/);
    expect(cpp).toContain("TODO(driverge)");
    expect(cpp).toMatch(/hal_i2c_write\(/);
  });

  it("fill_in_brief keeps the crc_todo key, same structure as the C artifact", () => {
    requireGenerated();
    expect(Object.keys(cppArt.fill_in_brief).sort()).toEqual(
      Object.keys(cArt.fill_in_brief).sort(),
    );
    expect(cppArt.fill_in_brief.crc_todo).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — framing_todo bus rules unchanged (UART-only reasoning gap)
// ---------------------------------------------------------------------------

describe("generateDriver(json, 'portable', {language:'cpp'}) — UART framing gap unchanged (MHZ19-shaped)", () => {
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  let art: DriverArtifact;
  let cpp: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "portable", { language: "cpp" });
      cpp = art.files.find((f) => f.path === "mhz19.cpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("carries a framing_todo naming both UART seam functions", () => {
    requireGenerated();
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_read");
  });

  it("the .cpp body names the seam function(s) in the framing TODO, same rule as C", () => {
    requireGenerated();
    expect(cpp).toContain("TODO(driverge)");
    expect(cpp).toMatch(/hal_uart_write|hal_uart_read/);
  });
});

describe("generateDriver(json, 'portable', {language:'cpp'}) — framing_todo absent for I2C/SPI (unchanged rule)", () => {
  it("is undefined for an I2C register_map cpp part (BME280)", () => {
    const art = generateDriver(
      registerDatasheet("bme280.golden.json", "BME280"),
      "portable",
      { language: "cpp" },
    );
    expect(art.fill_in_brief.framing_todo).toBeUndefined();
  });

  it("is undefined for an SPI register_map cpp part (TMAG5170)", () => {
    const art = generateDriver(
      spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"),
      "portable",
      { language: "cpp" },
    );
    expect(art.fill_in_brief.framing_todo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section 2 — deferred cpp parts: register_map_todo/command_set_todo + class
// skeleton (graceful-degradation, unchanged for cpp).
// ---------------------------------------------------------------------------

describe("generateDriver(json, 'portable', {language:'cpp'}) — deferred register map", () => {
  const deferredRegister: DatasheetJson = {
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
    validation: { valid: true, errors: [], warnings: ["register map deferred"] },
  };
  let art: DriverArtifact;
  let hpp: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(deferredRegister, "portable", { language: "cpp" });
      hpp = art.files.find((f) => f.path === "aeat8811.hpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("emits exactly aeat8811.hpp / aeat8811.cpp", () => {
    requireGenerated();
    expect(art.files.map((f) => f.path)).toEqual(["aeat8811.hpp", "aeat8811.cpp"]);
  });

  it("emits a register-map TODO(driverge) block naming the detected page, and still declares the class skeleton", () => {
    requireGenerated();
    expect(hpp).toContain("TODO(driverge)");
    expect(hpp).toMatch(/register map/i);
    expect(hpp).toContain("23");
    expect(hpp).toContain("class Aeat8811 {");
    expect(hpp).toContain("int init();");
    expect(hpp).toContain("int readRegister(uint8_t reg, uint8_t &value);");
    expect(hpp).toContain("int writeRegister(uint8_t reg, uint8_t value);");
  });

  it("adds a register_map_todo to the fill-in brief", () => {
    requireGenerated();
    expect(art.fill_in_brief.register_map_todo).toBeTruthy();
  });
});

describe("generateDriver(json, 'portable', {language:'cpp'}) — deferred command set", () => {
  const deferredCommand: DatasheetJson = {
    metadata: {
      part: "DHT20",
      manufacturer: "Aosong",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 12,
    },
    protocol: { bus: "I2C", addresses: ["0x38"] },
    interface: { kind: "command_set", commands: [] },
    extraction: { status: "deferred", detectedPages: [8] },
    validation: { valid: true, errors: [], warnings: ["command set deferred"] },
  };
  let art: DriverArtifact;
  let hpp: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(deferredCommand, "portable", { language: "cpp" });
      hpp = art.files.find((f) => f.path === "dht20.hpp")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("emits a command-set TODO(driverge) block and still declares the class skeleton", () => {
    requireGenerated();
    expect(hpp).toContain("TODO(driverge)");
    expect(hpp).toMatch(/command/i);
    expect(hpp).toContain("class Dht20 {");
    expect(art.fill_in_brief.command_set_todo).toBeTruthy();
  });
});
