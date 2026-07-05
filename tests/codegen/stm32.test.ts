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

describe("generateDriver target=stm32 (SPI, TMAG5170-shaped — Session A native SPI support)", () => {
  // generateDriver(..., "stm32") still THROWS UnsupportedBusError for SPI today
  // (pre-Session-A behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase) so that throw fails only this
  // suite's tests, not the whole file's collection.
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "stm32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "tmag5170_hal_stm32.c")!.content;
      core = art.files.find((f) => f.path === "tmag5170.c")!.content;
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

  it("no longer refuses SPI — emits the portable core plus a CubeHAL SPI seam file", () => {
    requireGenerated();
    expect(paths).toEqual(["tmag5170.h", "tmag5170.c", "tmag5170_hal_stm32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of CubeHAL SPI/GPIO calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "tmag5170.c")!.content);
    expect(core).not.toMatch(/HAL_SPI_|HAL_GPIO_/);
  });

  it("implements hal_spi_transfer via HAL_SPI_Transmit/Receive", () => {
    requireGenerated();
    expect(hal).toContain("HAL_SPI_Transmit(");
    expect(hal).toContain("HAL_SPI_Receive(");
    expect(hal).toContain("HAL_Delay(ms)");
  });

  it("frames the hal_spi_transfer transaction with CS low -> transmit -> receive -> CS high", () => {
    requireGenerated();
    const fn = hal.match(/hal_spi_transfer\([\s\S]*?\n\}/);
    expect(fn).toBeTruthy();
    const body = fn![0];
    const resetIdx = body.indexOf("GPIO_PIN_RESET");
    const txIdx = body.indexOf("HAL_SPI_Transmit(");
    const rxIdx = body.indexOf("HAL_SPI_Receive(");
    const setIdx = body.indexOf("GPIO_PIN_SET");
    expect(resetIdx).toBeGreaterThanOrEqual(0);
    expect(txIdx).toBeGreaterThan(resetIdx);
    expect(rxIdx).toBeGreaterThan(txIdx);
    expect(setIdx).toBeGreaterThan(rxIdx);
  });

  it("exposes a bind function taking the SPI handle and CS GPIO port/pin", () => {
    requireGenerated();
    expect(hal).toMatch(
      /void tmag5170_stm32_bind\(SPI_HandleTypeDef \*hspi, GPIO_TypeDef \*cs_port, uint16_t cs_pin\)/,
    );
  });

  it("adds a hal_setup_todo mentioning SPI peripheral + CS GPIO configuration and the bind call", () => {
    requireGenerated();
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/SPI/);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/CS/i);
    expect(art.fill_in_brief.hal_setup_todo).toMatch(/tmag5170_stm32_bind/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "stm32").files).toEqual(art.files);
  });
});

describe("generateDriver target=stm32 (I2C behavior unchanged after SPI support lands)", () => {
  it("still emits the CubeHAL Mem_Read/Write seam for an I2C part (BME280 golden)", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "stm32");
    expect(art.files.map((f) => f.path)).toEqual(["bme280.h", "bme280.c", "bme280_hal_stm32.c"]);
    const hal = art.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
    expect(hal).toContain("HAL_I2C_Mem_Write(");
    expect(hal).toContain("HAL_I2C_Mem_Read(");
  });
});

describe("generateDriver target=stm32 (UART, MHZ19-shaped CO2 sensor — Session B native UART support)", () => {
  // generateDriver(..., "stm32") still THROWS UnsupportedBusError for UART today
  // (pre-Session-B behavior) — computed in beforeAll (run phase) rather than at
  // describe-body eval time (collection phase), same pattern as Session A's SPI
  // describe block above.
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  let art: DriverArtifact;
  let paths: string[];
  let hal: string;
  let core: string;
  let thrown: unknown;

  beforeAll(() => {
    try {
      art = generateDriver(json, "stm32");
      paths = art.files.map((f) => f.path);
      hal = art.files.find((f) => f.path === "mhz19_hal_stm32.c")!.content;
      core = art.files.find((f) => f.path === "mhz19.c")!.content;
    } catch (err) {
      thrown = err;
    }
  });

  function requireGenerated(): void {
    if (thrown) throw thrown;
  }

  it("no longer refuses UART — emits the portable core plus a CubeHAL UART seam file", () => {
    requireGenerated();
    expect(paths).toEqual(["mhz19.h", "mhz19.c", "mhz19_hal_stm32.c"]);
  });

  it("keeps the driver CORE identical to portable (thin-HAL unchanged) and free of CubeHAL UART calls", () => {
    requireGenerated();
    const portable = generatePortableDriver(json).files;
    expect(core).toBe(portable.find((f) => f.path === "mhz19.c")!.content);
    expect(core).not.toMatch(/HAL_UART_|HAL_Delay/);
  });

  it("implements the seam via HAL_UART_Transmit/Receive with a UART_HandleTypeDef bind", () => {
    requireGenerated();
    expect(hal).toMatch(/void mhz19_stm32_bind\(UART_HandleTypeDef \*huart\)/);
    expect(hal).toContain("HAL_UART_Transmit(");
    expect(hal).toContain("HAL_UART_Receive(");
    expect(hal).toContain("HAL_Delay(ms)");
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

describe.each(["unknown"] as const)(
  "generateStm32Driver refuses a bus it doesn't support (%s)",
  (bus) => {
    const json: DatasheetJson = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus },
    };

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
