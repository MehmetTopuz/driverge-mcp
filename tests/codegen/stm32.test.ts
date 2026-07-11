import { beforeAll, describe, expect, it } from "vitest";
import { generateDriver, generateStm32Driver, UnsupportedBusError } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { DriverArtifact } from "../../src/codegen/types";
import type { DatasheetJson } from "../../src/schema/types";
import {
  commandDatasheet,
  registerDatasheet,
  spiRegisterDatasheet,
  uartRegisterDatasheet,
} from "./helpers";

describe("generateDriver target=stm32 (register_map, BME280) — Session E: prefixed seam + companion header", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const art = generateDriver(json, "stm32");
  const paths = art.files.map((f) => f.path);
  // Optional chaining (not `!.content`): "bme280_hal_stm32.h" doesn't exist
  // yet under the pre-Session-E generator — this must fail individual `it`s
  // below with a clear diff, not crash the whole file's collection.
  const companionHeader = art.files.find((f) => f.path === "bme280_hal_stm32.h")?.content ?? "";
  const hal = art.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
  const core = art.files.find((f) => f.path === "bme280.c")!.content;

  it("adds a CubeHAL seam implementation PLUS a companion header beside the portable core", () => {
    expect(paths).toEqual(["bme280.h", "bme280.c", "bme280_hal_stm32.h", "bme280_hal_stm32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged)", () => {
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "bme280.c")!.content);
    expect(core).not.toMatch(/HAL_I2C_|HAL_Delay/);
  });

  it("implements the seam with PREFIXED symbols (bme280_hal_i2c_write/read, bme280_hal_delay_ms), CubeHAL Mem_Read/Write, and a 7-bit address shift", () => {
    expect(hal).toContain("int bme280_hal_i2c_write(");
    expect(hal).toContain("int bme280_hal_i2c_read(");
    expect(hal).toContain("void bme280_hal_delay_ms(uint32_t ms)");
    expect(hal).toContain("HAL_I2C_Mem_Write(");
    expect(hal).toContain("HAL_I2C_Mem_Read(");
    expect(hal).toContain("HAL_Delay(ms)");
    expect(hal).toContain("I2C_MEMADD_SIZE_8BIT");
    expect(hal).toContain("addr << 1"); // CubeHAL wants the 8-bit shifted address
    expect(hal).toContain("bme280_stm32_bind(");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_read\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\(/);
  });

  it("emits a bme280_hal_stm32.h companion header: include guard, extern \"C\" guard, main.h, and the bme280_stm32_bind prototype", () => {
    expect(companionHeader).toMatch(/#ifndef\s+BME280_HAL_STM32_H\b/);
    expect(companionHeader).toMatch(/#define\s+BME280_HAL_STM32_H\b/);
    expect(companionHeader).toMatch(/#endif[^\n]*BME280_HAL_STM32_H/);
    expect(companionHeader).toMatch(/#ifdef __cplusplus/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "main.h"');
    expect(companionHeader).toMatch(/void\s+bme280_stm32_bind\(\s*I2C_HandleTypeDef\s*\*hi2c\s*\)\s*;/);
  });

  it("the seam .c includes its companion header", () => {
    expect(hal).toContain('#include "bme280_hal_stm32.h"');
  });

  it("mentions the companion header in hal_setup_todo", () => {
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/bme280_hal_stm32\.h/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "stm32").files).toEqual(art.files);
  });
});

describe("generateDriver target=stm32 (command_set, SHT3x) — prefixed seam + companion header", () => {
  const art = generateDriver(commandDatasheet(), "stm32");
  it("emits the command core plus a companion header and a CubeHAL seam", () => {
    expect(art.files.map((f) => f.path)).toEqual([
      "sht3x.h",
      "sht3x.c",
      "sht3x_hal_stm32.h",
      "sht3x_hal_stm32.c",
    ]);
    const hal = art.files.find((f) => f.path === "sht3x_hal_stm32.c")!.content;
    expect(hal).toContain("int sht3x_hal_i2c_write(");
    expect(hal).toContain("HAL_I2C_Mem_Write(");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    const companionHeader = art.files.find((f) => f.path === "sht3x_hal_stm32.h")!.content;
    expect(companionHeader).toMatch(/void\s+sht3x_stm32_bind\(\s*I2C_HandleTypeDef\s*\*hi2c\s*\)\s*;/);
    expect(hal).toContain('#include "sht3x_hal_stm32.h"');
  });
});

describe("generateDriver target=stm32 (SPI, TMAG5170-shaped — Session E full-duplex hal_spi_transfer)", () => {
  // generateDriver(..., "stm32") still THROWS UnsupportedBusError for SPI today
  // (pre-Session-A behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase) so that throw fails only this
  // suite's tests, not the whole file's collection.
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let companionHeader: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "stm32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "tmag5170_hal_stm32.c")!.content;
      core = art.files.find((f) => f.path === "tmag5170.c")!.content;
      companionHeader = art.files.find((f) => f.path === "tmag5170_hal_stm32.h")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  // Re-throws the captured generation error (if any) so every `it` below fails
  // individually and honestly — instead of the whole suite reporting one
  // opaque beforeAll failure — while still not crashing test-file collection.
  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("no longer refuses SPI — emits the portable core plus a companion header plus a CubeHAL SPI seam file", () => {
    requireGenerated();
    expect(paths).toEqual([
      "tmag5170.h",
      "tmag5170.c",
      "tmag5170_hal_stm32.h",
      "tmag5170_hal_stm32.c",
    ]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of CubeHAL SPI/GPIO calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "tmag5170.c")!.content);
    expect(core).not.toMatch(/HAL_SPI_|HAL_GPIO_/);
  });

  it("declares/defines the PREFIXED full-duplex tmag5170_hal_spi_transfer(tx, rx, len) — never the old (tx_len, rx_len) shape or a bare name", () => {
    requireGenerated();
    expect(hal).toContain(
      "int tmag5170_hal_spi_transfer(const uint8_t *tx, uint8_t *rx, uint16_t len)",
    );
    expect(hal).not.toMatch(/tx_len|rx_len/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
  });

  it("implements tmag5170_hal_spi_transfer via HAL_SPI_TransmitReceive when rx != NULL and HAL_SPI_Transmit when rx == NULL", () => {
    requireGenerated();
    const fn = /int tmag5170_hal_spi_transfer\([\s\S]*?\n\}/.exec(hal)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).toContain("HAL_SPI_TransmitReceive(");
    expect(fn).toContain("HAL_SPI_Transmit(");
    expect(fn).toMatch(/rx\s*(?:!=|==)\s*NULL/);
    expect(hal).toContain("HAL_Delay(ms)");
  });

  it("frames hal_spi_transfer as a SINGLE CS window: exactly one GPIO_PIN_RESET .. one GPIO_PIN_SET around the transfer", () => {
    requireGenerated();
    const fn = /int tmag5170_hal_spi_transfer\([\s\S]*?\n\}/.exec(hal)?.[0] ?? "";
    expect(fn).toBeTruthy();
    const resetIdx = fn.indexOf("GPIO_PIN_RESET");
    const setIdx = fn.lastIndexOf("GPIO_PIN_SET");
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(resetIdx);
    expect(fn.split("GPIO_PIN_RESET").length - 1).toBe(1);
    expect(fn.split("GPIO_PIN_SET").length - 1).toBe(1);
  });

  it("exposes a bind function taking the SPI handle and CS GPIO port/pin, prototyped identically in the companion header", () => {
    requireGenerated();
    expect(hal).toMatch(
      /void tmag5170_stm32_bind\(SPI_HandleTypeDef \*hspi, GPIO_TypeDef \*cs_port, uint16_t cs_pin\)/,
    );
    expect(companionHeader).toMatch(
      /void\s+tmag5170_stm32_bind\(\s*SPI_HandleTypeDef\s*\*hspi\s*,\s*GPIO_TypeDef\s*\*cs_port\s*,\s*uint16_t\s+cs_pin\s*\)\s*;/,
    );
  });

  it("the companion header has an include guard, extern \"C\" guard, and includes main.h; the seam .c includes the companion header", () => {
    requireGenerated();
    expect(companionHeader).toMatch(/#ifndef\s+TMAG5170_HAL_STM32_H\b/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "main.h"');
    expect(hal).toContain('#include "tmag5170_hal_stm32.h"');
  });

  it("adds a hal_setup_todo mentioning SPI peripheral + CS GPIO configuration and the bind call", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/SPI/);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/CS/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/tmag5170_stm32_bind/);
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "stm32").files).toEqual(art.files);
  });
});

describe("generateDriver target=stm32 (I2C behavior unchanged after SPI support lands)", () => {
  it("still emits the CubeHAL Mem_Read/Write seam (prefixed) for an I2C part (BME280 golden)", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "stm32");
    expect(art.files.map((f) => f.path)).toEqual([
      "bme280.h",
      "bme280.c",
      "bme280_hal_stm32.h",
      "bme280_hal_stm32.c",
    ]);
    const hal = art.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
    expect(hal).toContain("HAL_I2C_Mem_Write(");
    expect(hal).toContain("HAL_I2C_Mem_Read(");
    expect(hal).toContain("int bme280_hal_i2c_write(");
    expect(hal).toContain("int bme280_hal_i2c_read(");
  });
});

describe("generateDriver target=stm32 (UART, MHZ19-shaped CO2 sensor — prefixed seam + companion header)", () => {
  // generateDriver(..., "stm32") still THROWS UnsupportedBusError for UART today
  // (pre-Session-B behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase), same pattern as Session A's SPI
  // describe block above.
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let companionHeader: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "stm32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "mhz19_hal_stm32.c")!.content;
      core = art.files.find((f) => f.path === "mhz19.c")!.content;
      companionHeader = art.files.find((f) => f.path === "mhz19_hal_stm32.h")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("no longer refuses UART — emits the portable core plus a companion header plus a CubeHAL UART seam file", () => {
    requireGenerated();
    expect(paths).toEqual([
      "mhz19.h",
      "mhz19.c",
      "mhz19_hal_stm32.h",
      "mhz19_hal_stm32.c",
    ]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of CubeHAL UART calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "mhz19.c")!.content);
    expect(core).not.toMatch(/HAL_UART_|HAL_Delay/);
  });

  it("implements the PREFIXED seam via HAL_UART_Transmit/Receive with a UART_HandleTypeDef bind", () => {
    requireGenerated();
    expect(hal).toMatch(/void mhz19_stm32_bind\(UART_HandleTypeDef \*huart\)/);
    expect(hal).toContain("void mhz19_hal_uart_write(");
    expect(hal).toContain("uint16_t mhz19_hal_uart_read(");
    expect(hal).toContain("HAL_UART_Transmit(");
    expect(hal).toContain("HAL_UART_Receive(");
    expect(hal).toContain("HAL_Delay(ms)");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_uart_write\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_uart_read\(/);
  });

  it("emits a companion header (guard + extern \"C\" + main.h + bind prototype), included by the seam .c", () => {
    requireGenerated();
    expect(companionHeader).toMatch(/#ifndef\s+MHZ19_HAL_STM32_H\b/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "main.h"');
    expect(companionHeader).toMatch(/void\s+mhz19_stm32_bind\(\s*UART_HandleTypeDef\s*\*huart\s*\)\s*;/);
    expect(hal).toContain('#include "mhz19_hal_stm32.h"');
  });

  it("adds a hal_setup_todo mentioning UART/USART peripheral config, baud rate, and the bind call", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/UART|USART/);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/baud/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/mhz19_stm32_bind/);
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "stm32").files).toEqual(art.files);
  });
});

// STM32 is explicitly OUT of scope for CAN this pass — the bxCAN vs FDCAN
// peripheral family split across STM32 lines needs its own dedicated session,
// so generateStm32Driver keeps refusing CAN with the same UnsupportedBusError
// every other genuinely-unsupported bus gets.
describe.each(["CAN", "unknown"] as const)(
  "generateStm32Driver refuses a bus it doesn't support (%s)",
  (bus) => {
    // Cast through `unknown`: "CAN" is not yet exercised here — that is the
    // coder's job this session (unlike "unknown", which has always been a
    // valid Bus literal).
    const json = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus },
    } as unknown as DatasheetJson;

    it(`throws UnsupportedBusError for ${bus}`, () => {
      expect(() => generateStm32Driver(json)).toThrow(UnsupportedBusError);
    });

    it("names the target, the bus, and points at the still-working portable target", () => {
      let caught: unknown;
      try {
        generateStm32Driver(json);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnsupportedBusError);
      const message = (caught as Error).message;
      expect(message).toMatch(/stm32/i);
      expect(message).toMatch(new RegExp(bus, "i"));
      expect(message).toMatch(/portable/);
    });
  },
);

describe("lintDriver exempts the CubeHAL seam file AND its companion header from thin-HAL purity", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const completed = generateDriver(json, "stm32").files.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));

  it("passes a completed stm32 driver (core + companion header + seam) even though the seam uses CubeHAL", () => {
    const r = lintDriver(completed, json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("still rejects a CubeHAL call that leaks into the driver CORE", () => {
    const leaked = completed.map((f) =>
      f.path === "bme280.c"
        ? { path: f.path, content: f.content.replace("return 0;", "HAL_I2C_Mem_Write(0,0,0,0,0,0,0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(leaked, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/CubeHAL/);
  });
});
