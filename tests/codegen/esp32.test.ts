import { beforeAll, describe, expect, it } from "vitest";
import { generateDriver, generateEsp32Driver, UnsupportedBusError } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { DriverArtifact } from "../../src/codegen/types";
import type { DatasheetJson } from "../../src/schema/types";
import {
  canRegisterDatasheet,
  commandDatasheet,
  registerDatasheet,
  spiRegisterDatasheet,
  uartRegisterDatasheet,
} from "./helpers";

describe("generateDriver target=esp32 (register_map, BME280) — Session E: prefixed seam + companion header", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const art = generateDriver(json, "esp32");
  const paths = art.files.map((f) => f.path);
  // Optional chaining (not `!.content`): "bme280_hal_esp32.h" doesn't exist
  // yet under the pre-Session-E generator — this must fail individual `it`s
  // below with a clear diff, not crash the whole file's collection.
  const companionHeader = art.files.find((f) => f.path === "bme280_hal_esp32.h")?.content ?? "";
  const hal = art.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
  const core = art.files.find((f) => f.path === "bme280.c")!.content;
  const header = art.files.find((f) => f.path === "bme280.h")!.content;

  it("adds an ESP-IDF HAL seam implementation PLUS a companion header beside the portable core", () => {
    expect(paths).toEqual(["bme280.h", "bme280.c", "bme280_hal_esp32.h", "bme280_hal_esp32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged)", () => {
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "bme280.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "bme280.c")!.content);
    // The core must stay platform-agnostic — no ESP-IDF calls leak into it.
    expect(core).not.toMatch(/i2c_master_|vTaskDelay|driver\/i2c/);
  });

  it("implements the seam with PREFIXED symbols (bme280_hal_i2c_write/read, bme280_hal_delay_ms) using ESP-IDF i2c_master calls at the JSON address", () => {
    expect(hal).toContain('#include "driver/i2c_master.h"');
    expect(hal).toContain("int bme280_hal_i2c_write(");
    expect(hal).toContain("int bme280_hal_i2c_read(");
    expect(hal).toContain("void bme280_hal_delay_ms(uint32_t ms)");
    expect(hal).toContain("i2c_master_transmit(");
    expect(hal).toContain("i2c_master_transmit_receive(");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
    // address matches the JSON contract
    expect(hal).toContain("BME280_I2C_ADDR");
    expect(hal).toContain("bme280_esp32_bind(");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_read\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\(/);
  });

  it("emits a bme280_hal_esp32.h companion header: include guard, extern \"C\" guard, the i2c_master driver include, and the bind prototype", () => {
    expect(companionHeader).toMatch(/#ifndef\s+BME280_HAL_ESP32_H\b/);
    expect(companionHeader).toMatch(/#define\s+BME280_HAL_ESP32_H\b/);
    expect(companionHeader).toMatch(/#endif[^\n]*BME280_HAL_ESP32_H/);
    expect(companionHeader).toMatch(/#ifdef __cplusplus/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "driver/i2c_master.h"');
    expect(companionHeader).toMatch(
      /esp_err_t\s+bme280_esp32_bind\(\s*i2c_master_bus_handle_t\s+bus\s*,\s*uint32_t\s+scl_speed_hz\s*\)\s*;/,
    );
  });

  it("the seam .c includes its companion header", () => {
    expect(hal).toContain('#include "bme280_hal_esp32.h"');
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "esp32").files).toEqual(art.files);
  });
});

describe("generateDriver target=esp32 (command_set, SHT3x) — prefixed seam + companion header", () => {
  const art = generateDriver(commandDatasheet(), "esp32");
  it("emits the command core plus a companion header and an ESP-IDF seam", () => {
    expect(art.files.map((f) => f.path)).toEqual([
      "sht3x.h",
      "sht3x.c",
      "sht3x_hal_esp32.h",
      "sht3x_hal_esp32.c",
    ]);
    const hal = art.files.find((f) => f.path === "sht3x_hal_esp32.c")!.content;
    expect(hal).toContain("int sht3x_hal_i2c_write(");
    expect(hal).toContain("i2c_master_transmit(");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    const companionHeader = art.files.find((f) => f.path === "sht3x_hal_esp32.h")!.content;
    expect(companionHeader).toMatch(
      /esp_err_t\s+sht3x_esp32_bind\(\s*i2c_master_bus_handle_t\s+bus\s*,\s*uint32_t\s+scl_speed_hz\s*\)\s*;/,
    );
    expect(hal).toContain('#include "sht3x_hal_esp32.h"');
  });
});

describe("generateDriver target=esp32 (SPI, TMAG5170-shaped — Session E full-duplex spi_transaction_t)", () => {
  // generateDriver(..., "esp32") still THROWS UnsupportedBusError for SPI today
  // (pre-Session-A behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase) so that throw fails only this
  // suite's tests, not the whole file's collection.
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let header: string;
  let companionHeader: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "esp32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "tmag5170_hal_esp32.c")!.content;
      core = art.files.find((f) => f.path === "tmag5170.c")!.content;
      header = art.files.find((f) => f.path === "tmag5170.h")!.content;
      companionHeader = art.files.find((f) => f.path === "tmag5170_hal_esp32.h")!.content;
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

  it("no longer refuses SPI — emits the portable core plus a companion header plus an ESP-IDF spi_master seam file", () => {
    requireGenerated();
    expect(paths).toEqual([
      "tmag5170.h",
      "tmag5170.c",
      "tmag5170_hal_esp32.h",
      "tmag5170_hal_esp32.c",
    ]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of ESP-IDF SPI calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "tmag5170.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "tmag5170.c")!.content);
    expect(core).not.toMatch(/spi_master_|spi_device_|driver\/spi/);
  });

  it("declares/defines the PREFIXED full-duplex tmag5170_hal_spi_transfer(tx, rx, len) — never the old (tx_len, rx_len) shape or a bare name", () => {
    requireGenerated();
    expect(hal).toContain(
      "int tmag5170_hal_spi_transfer(const uint8_t *tx, uint8_t *rx, uint16_t len)",
    );
    expect(hal).not.toMatch(/tx_len|rx_len|rxlength/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
  });

  it("implements hal_spi_transfer with ONE full-duplex spi_transaction_t (length = len*8, tx_buffer/rx_buffer) and no half-duplex flag", () => {
    requireGenerated();
    expect(hal).toContain('#include "driver/spi_master.h"');
    const fn = /int tmag5170_hal_spi_transfer\([\s\S]*?\n\}/.exec(hal)?.[0] ?? "";
    expect(fn).toBeTruthy();
    expect(fn).toMatch(/\.length\s*=\s*(?:8\s*\*\s*len|len\s*\*\s*8)/);
    expect(fn).toMatch(/\.tx_buffer\s*=\s*tx/);
    expect(fn).toMatch(/\.rx_buffer\s*=\s*rx/);
    expect(fn).toContain("spi_device_polling_transmit(");
    expect(hal).not.toContain("SPI_DEVICE_HALFDUPLEX");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
  });

  it("exposes a bind function that adds the device to an SPI bus with host/cs/clock, prototyped identically in the companion header", () => {
    requireGenerated();
    expect(hal).toContain("spi_bus_add_device(");
    expect(hal).toMatch(
      /esp_err_t tmag5170_esp32_bind\(spi_host_device_t host, int cs_gpio, int clock_hz\)/,
    );
    expect(companionHeader).toMatch(
      /esp_err_t\s+tmag5170_esp32_bind\(\s*spi_host_device_t\s+host\s*,\s*int\s+cs_gpio\s*,\s*int\s+clock_hz\s*\)\s*;/,
    );
  });

  it("the companion header includes the spi_master driver header and is included by the seam .c", () => {
    requireGenerated();
    expect(companionHeader).toMatch(/#ifndef\s+TMAG5170_HAL_ESP32_H\b/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "driver/spi_master.h"');
    expect(hal).toContain('#include "tmag5170_hal_esp32.h"');
  });

  it("adds a hal_setup_todo naming SPI mode (0-3) selection from the datasheet", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/SPI mode/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/0.{0,4}3/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "esp32").files).toEqual(art.files);
  });
});

describe("generateDriver target=esp32 (I2C behavior unchanged after SPI support lands)", () => {
  it("still emits the ESP-IDF i2c_master seam (prefixed) for an I2C part (BME280 golden)", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "esp32");
    expect(art.files.map((f) => f.path)).toEqual([
      "bme280.h",
      "bme280.c",
      "bme280_hal_esp32.h",
      "bme280_hal_esp32.c",
    ]);
    const hal = art.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    expect(hal).toContain("i2c_master_transmit(");
    expect(hal).toContain("i2c_master_transmit_receive(");
    expect(hal).toContain("int bme280_hal_i2c_write(");
    expect(hal).toContain("int bme280_hal_i2c_read(");
  });
});

describe("generateDriver target=esp32 (UART, MHZ19-shaped CO2 sensor — prefixed seam + companion header)", () => {
  // generateDriver(..., "esp32") still THROWS UnsupportedBusError for UART today
  // (pre-Session-B behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase) so that throw fails only this
  // suite's tests, not the whole file's collection (same pattern as Session A's
  // SPI describe block above).
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let header: string;
  let companionHeader: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "esp32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "mhz19_hal_esp32.c")!.content;
      core = art.files.find((f) => f.path === "mhz19.c")!.content;
      header = art.files.find((f) => f.path === "mhz19.h")!.content;
      companionHeader = art.files.find((f) => f.path === "mhz19_hal_esp32.h")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("no longer refuses UART — emits the portable core plus a companion header plus an ESP-IDF UART seam file", () => {
    requireGenerated();
    expect(paths).toEqual([
      "mhz19.h",
      "mhz19.c",
      "mhz19_hal_esp32.h",
      "mhz19_hal_esp32.c",
    ]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of ESP-IDF UART calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "mhz19.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "mhz19.c")!.content);
    expect(core).not.toMatch(/uart_write_bytes|uart_read_bytes|driver\/uart/);
  });

  it("implements the PREFIXED seam with ESP-IDF uart_write_bytes/uart_read_bytes and a uart_port_t bind", () => {
    requireGenerated();
    expect(hal).toContain('#include "driver/uart.h"');
    expect(hal).toMatch(/void mhz19_esp32_bind\(uart_port_t port\)/);
    expect(hal).toContain("void mhz19_hal_uart_write(");
    expect(hal).toContain("uint16_t mhz19_hal_uart_read(");
    expect(hal).toContain("uart_write_bytes(");
    expect(hal).toContain("uart_read_bytes(");
    expect(hal).toContain("pdMS_TO_TICKS(");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_uart_write\(/);
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_uart_read\(/);
  });

  it("emits a companion header (guard + extern \"C\" + driver/uart.h + bind prototype), included by the seam .c", () => {
    requireGenerated();
    expect(companionHeader).toMatch(/#ifndef\s+MHZ19_HAL_ESP32_H\b/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "driver/uart.h"');
    expect(companionHeader).toMatch(/void\s+mhz19_esp32_bind\(\s*uart_port_t\s+port\s*\)\s*;/);
    expect(hal).toContain('#include "mhz19_hal_esp32.h"');
  });

  it("adds a hal_setup_todo naming uart_driver_install, the baud rate, and the bind call", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/uart_driver_install/);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/baud/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/mhz19_esp32_bind/);
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "esp32").files).toEqual(art.files);
  });
});

describe("generateDriver target=esp32 (CAN, CANTEMP-shaped — prefixed seam + companion header)", () => {
  // generateDriver(..., "esp32") still THROWS UnsupportedBusError for CAN today
  // (pre-Session-C behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase), same pattern as Session A's SPI /
  // Session B's UART describe blocks above.
  const json = canRegisterDatasheet("bme280.golden.json", "CANTEMP");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let header: string;
  let companionHeader: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "esp32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "cantemp_hal_esp32.c")!.content;
      core = art.files.find((f) => f.path === "cantemp.c")!.content;
      header = art.files.find((f) => f.path === "cantemp.h")!.content;
      companionHeader = art.files.find((f) => f.path === "cantemp_hal_esp32.h")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("accepts CAN — emits the portable core plus a companion header plus an ESP-IDF TWAI seam file", () => {
    requireGenerated();
    expect(paths).toEqual([
      "cantemp.h",
      "cantemp.c",
      "cantemp_hal_esp32.h",
      "cantemp_hal_esp32.c",
    ]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of ESP-IDF TWAI calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "cantemp.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "cantemp.c")!.content);
    expect(core).not.toMatch(/twai_/);
  });

  it("implements the PREFIXED seam with ESP-IDF TWAI transmit/receive and a void-argument bind", () => {
    requireGenerated();
    expect(hal).toContain('#include "driver/twai.h"');
    expect(hal).toContain("int cantemp_hal_can_transfer(");
    expect(hal).toContain("twai_transmit(");
    expect(hal).toContain("twai_receive(");
    expect(hal).toContain("twai_message_t");
    expect(hal).toContain("pdMS_TO_TICKS(");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_can_transfer\(/);
    // Symmetry decision (documented for the coder): the bind signature takes NO
    // arguments — the TWAI driver is a single app-global peripheral (unlike I2C/
    // SPI/UART, which bind a specific bus/port handle), so there is nothing to
    // store yet; the hook is reserved for parity with the other targets' bind().
    expect(hal).toMatch(/void cantemp_esp32_bind\(void\)/);
  });

  it("emits a companion header (guard + extern \"C\" + driver/twai.h + void-argument bind prototype), included by the seam .c", () => {
    requireGenerated();
    expect(companionHeader).toMatch(/#ifndef\s+CANTEMP_HAL_ESP32_H\b/);
    expect(companionHeader).toContain('extern "C" {');
    expect(companionHeader).toContain('#include "driver/twai.h"');
    expect(companionHeader).toMatch(/void\s+cantemp_esp32_bind\(\s*void\s*\)\s*;/);
    expect(hal).toContain('#include "cantemp_hal_esp32.h"');
  });

  it("adds a hal_setup_todo naming twai_driver_install and mentioning bitrate and acceptance-filter config", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/twai_driver_install/);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/bitrate|baud/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/acceptance|filter/i);
  });

  it("is deterministic", () => {
    requireGenerated();
    expect(generateDriver(json, "esp32").files).toEqual(art.files);
  });
});

describe("generateDriver target=esp32 (CAN command_set, CANTEMP-shaped) — prefixed seam + companion header", () => {
  const canCommandJson: DatasheetJson = {
    metadata: {
      part: "CANTEMP",
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "CAN" },
    interface: {
      kind: "command_set",
      commands: [{ name: "read_temperature", code: "0x181" }],
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;

  it("emits the command core plus a companion header and an ESP-IDF TWAI seam", () => {
    const art = generateDriver(canCommandJson, "esp32");
    expect(art.files.map((f) => f.path)).toEqual([
      "cantemp.h",
      "cantemp.c",
      "cantemp_hal_esp32.h",
      "cantemp_hal_esp32.c",
    ]);
    const hal = art.files.find((f) => f.path === "cantemp_hal_esp32.c")!.content;
    expect(hal).toContain("twai_transmit(");
    expect(hal).toContain("int cantemp_hal_can_transfer(");
    expect(hal).not.toMatch(/[^_a-zA-Z0-9]hal_can_transfer\(/);
  });
});

describe.each(["unknown"] as const)(
  "generateEsp32Driver refuses a bus it doesn't support (%s)",
  (bus) => {
    const json: DatasheetJson = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus },
    };

    it(`throws UnsupportedBusError for ${bus}`, () => {
      expect(() => generateEsp32Driver(json)).toThrow(UnsupportedBusError);
    });

    it("names the target, the bus, and points at the still-working portable target", () => {
      let caught: unknown;
      try {
        generateEsp32Driver(json);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnsupportedBusError);
      const message = (caught as Error).message;
      expect(message).toMatch(/esp32/i);
      expect(message).toMatch(new RegExp(bus, "i"));
      expect(message).toMatch(/portable/);
    });
  },
);

describe("lintDriver exempts the HAL implementation file AND its companion header from thin-HAL purity", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const completed = generateDriver(json, "esp32").files.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));

  it("passes a completed esp32 driver (core + companion header + seam) even though the seam/header use ESP-IDF vendor types", () => {
    const r = lintDriver(completed, json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("still rejects an ESP-IDF call that leaks into the driver CORE", () => {
    const leaked = completed.map((f) =>
      f.path === "bme280.c"
        ? { path: f.path, content: f.content.replace("return 0;", "i2c_master_transmit(0,0,0,0);\n    return 0;") }
        : f,
    );
    const r = lintDriver(leaked, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/ESP-IDF/);
  });
});
