import { describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import { commandDatasheet, registerDatasheet } from "./helpers";

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
