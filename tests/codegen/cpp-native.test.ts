import { describe, expect, it } from "vitest";
import { generateDriver, UnsupportedBusError } from "../../src/codegen";
import type { DatasheetJson } from "../../src/schema/types";
import { registerDatasheet, spiRegisterDatasheet } from "./helpers";

// Session D §3: native targets + language cpp. A native target (esp32/stm32)
// does not replace the thin HAL — it pre-fills the seam — so with
// language:"cpp" the artifact is the cpp CORE (.hpp/.cpp) plus the SAME
// `_hal_<target>.c` seam file the "c" run emits, byte-for-byte identical.
// Guard/refusal behavior (UnsupportedBusError) is independent of language.

describe("generateDriver target=esp32, language=cpp (I2C, BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const cArt = generateDriver(json, "esp32");
  const cppArt = generateDriver(json, "esp32", { language: "cpp" });

  it("emits the cpp core files plus the unchanged ESP-IDF seam file", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "bme280.hpp",
      "bme280.cpp",
      "bme280_hal_esp32.c",
    ]);
  });

  it("keeps the native seam file byte-identical to the language:'c' run", () => {
    const cSeam = cArt.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    expect(cppSeam).toEqual(cSeam);
  });

  it("the cpp core never leaks ESP-IDF calls (thin-HAL unchanged)", () => {
    const core = cppArt.files.find((f) => f.path === "bme280.cpp")!.content;
    expect(core).not.toMatch(/i2c_master_|vTaskDelay|driver\/i2c/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "esp32", { language: "cpp" }).files).toEqual(cppArt.files);
  });
});

describe("generateDriver target=esp32, language=cpp (command_set doesn't break, SHT3x-shaped over I2C)", () => {
  it("emits the command-set cpp core plus the ESP-IDF seam", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "esp32", { language: "cpp" });
    expect(art.files.map((f) => f.path)).toContain("bme280_hal_esp32.c");
    expect(art.files.map((f) => f.path)).toContain("bme280.hpp");
    expect(art.files.map((f) => f.path)).toContain("bme280.cpp");
  });
});

describe("generateDriver target=stm32, language=cpp (SPI, TMAG5170 — Session A SPI seam)", () => {
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  const cArt = generateDriver(json, "stm32");
  const cppArt = generateDriver(json, "stm32", { language: "cpp" });

  it("emits the cpp core files plus the unchanged CubeHAL SPI seam file", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "tmag5170.hpp",
      "tmag5170.cpp",
      "tmag5170_hal_stm32.c",
    ]);
  });

  it("keeps the native seam file byte-identical to the language:'c' run", () => {
    const cSeam = cArt.files.find((f) => f.path === "tmag5170_hal_stm32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "tmag5170_hal_stm32.c")!.content;
    expect(cppSeam).toEqual(cSeam);
  });

  it("the cpp core never leaks CubeHAL SPI/GPIO calls (thin-HAL unchanged)", () => {
    const core = cppArt.files.find((f) => f.path === "tmag5170.cpp")!.content;
    expect(core).not.toMatch(/HAL_SPI_|HAL_GPIO_/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "stm32", { language: "cpp" }).files).toEqual(cppArt.files);
  });
});

describe("generateDriver target=stm32, language=cpp (I2C, BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const cArt = generateDriver(json, "stm32");
  const cppArt = generateDriver(json, "stm32", { language: "cpp" });

  it("emits the cpp core files plus the unchanged CubeHAL I2C seam file", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "bme280.hpp",
      "bme280.cpp",
      "bme280_hal_stm32.c",
    ]);
  });

  it("keeps the native seam file byte-identical to the language:'c' run", () => {
    const cSeam = cArt.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
    expect(cppSeam).toEqual(cSeam);
  });
});

describe("native cpp guard/refusal behavior is independent of language", () => {
  it("stm32 still refuses CAN with language cpp (UnsupportedBusError, bxCAN/FDCAN deferred)", () => {
    const json: DatasheetJson = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus: "CAN" },
    };
    expect(() => generateDriver(json, "stm32", { language: "cpp" })).toThrow(UnsupportedBusError);
  });

  it("esp32 still refuses an unknown bus with language cpp", () => {
    const json: DatasheetJson = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus: "unknown" },
    };
    expect(() => generateDriver(json, "esp32", { language: "cpp" })).toThrow(UnsupportedBusError);
  });

  it("stm32 still refuses an unknown bus with language cpp", () => {
    const json: DatasheetJson = {
      ...registerDatasheet("bme280.golden.json", "BME280"),
      protocol: { bus: "unknown" },
    };
    expect(() => generateDriver(json, "stm32", { language: "cpp" })).toThrow(UnsupportedBusError);
  });
});
