import { beforeAll, describe, expect, it } from "vitest";
import { generateDriver, generateEsp32Driver, UnsupportedBusError } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { DriverArtifact } from "../../src/codegen/types";
import type { DatasheetJson } from "../../src/schema/types";
import { commandDatasheet, registerDatasheet, spiRegisterDatasheet } from "./helpers";

describe("generateDriver target=esp32 (register_map, BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const art = generateDriver(json, "esp32");
  const paths = art.files.map((f) => f.path);
  const hal = art.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
  const core = art.files.find((f) => f.path === "bme280.c")!.content;
  const header = art.files.find((f) => f.path === "bme280.h")!.content;

  it("adds an ESP-IDF HAL seam implementation beside the portable core", () => {
    expect(paths).toEqual(["bme280.h", "bme280.c", "bme280_hal_esp32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged)", () => {
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "bme280.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "bme280.c")!.content);
    // The core must stay platform-agnostic — no ESP-IDF calls leak into it.
    expect(core).not.toMatch(/i2c_master_|vTaskDelay|driver\/i2c/);
  });

  it("implements the seam with ESP-IDF i2c_master calls at the JSON address", () => {
    expect(hal).toContain('#include "driver/i2c_master.h"');
    expect(hal).toContain("i2c_master_transmit(");
    expect(hal).toContain("i2c_master_transmit_receive(");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
    // address matches the JSON contract
    expect(hal).toContain("BME280_I2C_ADDR");
    expect(hal).toContain("bme280_esp32_bind(");
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "esp32").files).toEqual(art.files);
  });
});

describe("generateDriver target=esp32 (command_set, SHT3x)", () => {
  const art = generateDriver(commandDatasheet(), "esp32");
  it("emits the command core plus an ESP-IDF seam", () => {
    expect(art.files.map((f) => f.path)).toEqual([
      "sht3x.h",
      "sht3x.c",
      "sht3x_hal_esp32.c",
    ]);
    expect(art.files.find((f) => f.path === "sht3x_hal_esp32.c")!.content).toContain(
      "i2c_master_transmit(",
    );
  });
});

describe("generateDriver target=esp32 (SPI, TMAG5170-shaped — Session A native SPI support)", () => {
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
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "esp32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "tmag5170_hal_esp32.c")!.content;
      core = art.files.find((f) => f.path === "tmag5170.c")!.content;
      header = art.files.find((f) => f.path === "tmag5170.h")!.content;
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

  it("no longer refuses SPI — emits the portable core plus an ESP-IDF spi_master seam file", () => {
    requireGenerated();
    expect(paths).toEqual(["tmag5170.h", "tmag5170.c", "tmag5170_hal_esp32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of ESP-IDF SPI calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(header).toBe(portable.find((f) => f.path === "tmag5170.h")!.content);
    expect(core).toBe(portable.find((f) => f.path === "tmag5170.c")!.content);
    expect(core).not.toMatch(/spi_master_|spi_device_|driver\/spi/);
  });

  it("implements hal_spi_transfer with a single spi_transaction_t and spi_device_polling_transmit", () => {
    requireGenerated();
    expect(hal).toContain('#include "driver/spi_master.h"');
    expect(hal).toContain("spi_transaction_t");
    expect(hal).toContain("spi_device_polling_transmit(");
    expect(hal).toContain("vTaskDelay(pdMS_TO_TICKS(ms))");
  });

  it("exposes a bind function that adds the device to an SPI bus with host/cs/clock", () => {
    requireGenerated();
    expect(hal).toContain("spi_bus_add_device(");
    expect(hal).toMatch(
      /esp_err_t tmag5170_esp32_bind\(spi_host_device_t host, int cs_gpio, int clock_hz\)/,
    );
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
  it("still emits the ESP-IDF i2c_master seam for an I2C part (BME280 golden)", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "esp32");
    expect(art.files.map((f) => f.path)).toEqual(["bme280.h", "bme280.c", "bme280_hal_esp32.c"]);
    const hal = art.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    expect(hal).toContain("i2c_master_transmit(");
    expect(hal).toContain("i2c_master_transmit_receive(");
  });
});

describe.each(["UART", "unknown"] as const)(
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

describe("lintDriver exempts the HAL implementation file from thin-HAL purity", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const completed = generateDriver(json, "esp32").files.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));

  it("passes a completed esp32 driver even though the seam uses ESP-IDF", () => {
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
