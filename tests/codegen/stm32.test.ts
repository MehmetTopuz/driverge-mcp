import { describe, expect, it } from "vitest";
import { generateDriver, generateStm32Driver, UnsupportedBusError } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { DatasheetJson } from "../../src/schema/types";
import { commandDatasheet, registerDatasheet } from "./helpers";

describe("generateDriver target=stm32 (register_map, BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const art = generateDriver(json, "stm32");
  const paths = art.files.map((f) => f.path);
  const hal = art.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
  const core = art.files.find((f) => f.path === "bme280.c")!.content;

  it("adds a CubeHAL seam implementation beside the portable core", () => {
    expect(paths).toEqual(["bme280.h", "bme280.c", "bme280_hal_stm32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged)", () => {
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "bme280.c")!.content);
    expect(core).not.toMatch(/HAL_I2C_|HAL_Delay/);
  });

  it("implements the seam with CubeHAL Mem_Read/Write and a 7-bit address shift", () => {
    expect(hal).toContain("HAL_I2C_Mem_Write(");
    expect(hal).toContain("HAL_I2C_Mem_Read(");
    expect(hal).toContain("HAL_Delay(ms)");
    expect(hal).toContain("I2C_MEMADD_SIZE_8BIT");
    expect(hal).toContain("addr << 1"); // CubeHAL wants the 8-bit shifted address
    expect(hal).toContain("bme280_stm32_bind(");
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "stm32").files).toEqual(art.files);
  });
});

describe("generateDriver target=stm32 (command_set, SHT3x)", () => {
  const art = generateDriver(commandDatasheet(), "stm32");
  it("emits the command core plus a CubeHAL seam", () => {
    expect(art.files.map((f) => f.path)).toEqual([
      "sht3x.h",
      "sht3x.c",
      "sht3x_hal_stm32.c",
    ]);
    expect(art.files.find((f) => f.path === "sht3x_hal_stm32.c")!.content).toContain(
      "HAL_I2C_Mem_Write(",
    );
  });
});

describe("generateStm32Driver refuses a SPI part (B1 regression pin)", () => {
  // Mirrors the ESP32 pin: the CubeHAL seam references `${PREFIX}_I2C_ADDR`,
  // which the portable core never defines for a SPI part.
  const spiJson: DatasheetJson = {
    ...registerDatasheet("bme280.golden.json", "BME280"),
    protocol: { bus: "SPI" },
  };

  it("throws UnsupportedBusError instead of emitting an I2C-only HAL seam", () => {
    expect(() => generateStm32Driver(spiJson)).toThrow(UnsupportedBusError);
  });

  it("names the target, the bus, and points at the still-working portable target", () => {
    let caught: unknown;
    try {
      generateStm32Driver(spiJson);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsupportedBusError);
    const message = (caught as Error).message;
    expect(message).toMatch(/stm32/i);
    expect(message).toMatch(/SPI/);
    expect(message).toMatch(/portable/);
  });
});

describe("lintDriver exempts the CubeHAL seam file from thin-HAL purity", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const completed = generateDriver(json, "stm32").files.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));

  it("passes a completed stm32 driver even though the seam uses CubeHAL", () => {
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
