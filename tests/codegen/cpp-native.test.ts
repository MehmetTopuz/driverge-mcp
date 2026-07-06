import { describe, expect, it } from "vitest";
import { generateDriver, UnsupportedBusError } from "../../src/codegen";
import type { DatasheetJson } from "../../src/schema/types";
import { registerDatasheet, spiRegisterDatasheet } from "./helpers";

// Session D §3: native targets + language cpp. A native target (esp32/stm32)
// does not replace the thin HAL — it pre-fills the seam — so with
// language:"cpp" the artifact is the cpp CORE (.hpp/.cpp) plus a seam file.
//
// Contract amendment (orchestrator, post-GREEN 4b3da14/d576ba6): the seam
// canNOT stay byte-identical to the "c" run's `_hal_<target>.c` file, because
// that file does `#include "<slug>.h"` — which does not exist in a cpp
// bundle. With language "cpp" the seam becomes `<slug>_hal_<target>.cpp` and
// its project include is `#include "<slug>.hpp"`; everything else in the seam
// content stays identical to the "c" run modulo exactly those two
// substitutions (path extension + include line — and, optionally, a header
// comment that happens to mention the seam's own filename, which MAY also
// reflect .cpp but isn't required to). Rationale: the .hpp declares the hal_*
// seam inside `extern "C"`, so compiling the seam as C++ still emits
// C-linkage definitions that the class methods can call — vendor SDKs
// (ESP-IDF, CubeMX C++ projects) compile .cpp sources natively, so this
// costs nothing.
//
// normalizeSeam() below folds both allowed substitution spots (the seam's own
// filename, and the core-header include target) to placeholder tokens before
// comparing the "c" and "cpp" seam contents — so this pin still catches any
// OTHER unintended drift between the two runs, while tolerating the two
// explicitly-allowed differences (and being agnostic to whether the optional
// filename-in-comment tweak happened).
function normalizeSeam(content: string, slugName: string, target: "esp32" | "stm32"): string {
  return content
    .replace(new RegExp(`${slugName}_hal_${target}\\.(?:c|cpp)`, "g"), `${slugName}_hal_${target}.<EXT>`)
    .replace(new RegExp(`#include "${slugName}\\.(?:h|hpp)"`, "g"), `#include "${slugName}.<CORE_EXT>"`);
}

describe("generateDriver target=esp32, language=cpp (I2C, BME280)", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const cArt = generateDriver(json, "esp32");
  const cppArt = generateDriver(json, "esp32", { language: "cpp" });

  it("emits the cpp core files plus a `.cpp` ESP-IDF seam file (not .c)", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "bme280.hpp",
      "bme280.cpp",
      "bme280_hal_esp32.cpp",
    ]);
  });

  it('the seam #include\'s "bme280.hpp" (not "bme280.h")', () => {
    const seam = cppArt.files.find((f) => f.path === "bme280_hal_esp32.cpp")!.content;
    expect(seam).toContain('#include "bme280.hpp"');
    expect(seam).not.toContain('#include "bme280.h"');
  });

  // The regression pin that would have caught the original defect: a real
  // build fails if anything in the cpp bundle still points at a nonexistent
  // "bme280.h" (there is no .h file in a cpp bundle at all).
  it('the cpp bundle has NO .h file, and the string "bme280.h" appears nowhere in any file', () => {
    expect(cppArt.files.some((f) => f.path.endsWith(".h"))).toBe(false);
    for (const f of cppArt.files) {
      expect(f.content).not.toContain('"bme280.h"');
    }
  });

  it("the seam content is otherwise identical to the language:'c' run's seam (modulo the two allowed substitutions)", () => {
    const cSeam = cArt.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "bme280_hal_esp32.cpp")!.content;
    expect(normalizeSeam(cppSeam, "bme280", "esp32")).toEqual(normalizeSeam(cSeam, "bme280", "esp32"));
  });

  it("the cpp core never leaks ESP-IDF calls (thin-HAL unchanged)", () => {
    const core = cppArt.files.find((f) => f.path === "bme280.cpp")!.content;
    expect(core).not.toMatch(/i2c_master_|vTaskDelay|driver\/i2c/);
  });

  it("is deterministic", () => {
    expect(generateDriver(json, "esp32", { language: "cpp" }).files).toEqual(cppArt.files);
  });

  it("the language:'c' run's seam stays exactly as today (.c, #include \"bme280.h\")", () => {
    const cSeam = cArt.files.find((f) => f.path === "bme280_hal_esp32.c")!.content;
    expect(cArt.files.map((f) => f.path)).toEqual(["bme280.h", "bme280.c", "bme280_hal_esp32.c"]);
    expect(cSeam).toContain('#include "bme280.h"');
  });
});

describe("generateDriver target=esp32, language=cpp (a second I2C bundle sanity check)", () => {
  it("emits the cpp core plus the .cpp ESP-IDF seam (no .h file anywhere)", () => {
    const json = registerDatasheet("bme280.golden.json", "BME280");
    const art = generateDriver(json, "esp32", { language: "cpp" });
    const paths = art.files.map((f) => f.path);
    expect(paths).toContain("bme280_hal_esp32.cpp");
    expect(paths).toContain("bme280.hpp");
    expect(paths).toContain("bme280.cpp");
    expect(paths.some((p) => p.endsWith(".h"))).toBe(false);
  });
});

describe("generateDriver target=stm32, language=cpp (SPI, TMAG5170 — Session A SPI seam)", () => {
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  const cArt = generateDriver(json, "stm32");
  const cppArt = generateDriver(json, "stm32", { language: "cpp" });

  it("emits the cpp core files plus a `.cpp` CubeHAL SPI seam file (not .c)", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "tmag5170.hpp",
      "tmag5170.cpp",
      "tmag5170_hal_stm32.cpp",
    ]);
  });

  it('the seam #include\'s "tmag5170.hpp" (not "tmag5170.h")', () => {
    const seam = cppArt.files.find((f) => f.path === "tmag5170_hal_stm32.cpp")!.content;
    expect(seam).toContain('#include "tmag5170.hpp"');
    expect(seam).not.toContain('#include "tmag5170.h"');
  });

  it('the cpp bundle has NO .h file, and the string "tmag5170.h" appears nowhere in any file', () => {
    expect(cppArt.files.some((f) => f.path.endsWith(".h"))).toBe(false);
    for (const f of cppArt.files) {
      expect(f.content).not.toContain('"tmag5170.h"');
    }
  });

  it("the seam content is otherwise identical to the language:'c' run's seam (modulo the two allowed substitutions)", () => {
    const cSeam = cArt.files.find((f) => f.path === "tmag5170_hal_stm32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "tmag5170_hal_stm32.cpp")!.content;
    expect(normalizeSeam(cppSeam, "tmag5170", "stm32")).toEqual(
      normalizeSeam(cSeam, "tmag5170", "stm32"),
    );
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

  it("emits the cpp core files plus a `.cpp` CubeHAL I2C seam file (not .c)", () => {
    expect(cppArt.files.map((f) => f.path)).toEqual([
      "bme280.hpp",
      "bme280.cpp",
      "bme280_hal_stm32.cpp",
    ]);
  });

  it('the seam #include\'s "bme280.hpp" (not "bme280.h"), and no .h file exists in the bundle', () => {
    const seam = cppArt.files.find((f) => f.path === "bme280_hal_stm32.cpp")!.content;
    expect(seam).toContain('#include "bme280.hpp"');
    expect(seam).not.toContain('#include "bme280.h"');
    expect(cppArt.files.some((f) => f.path.endsWith(".h"))).toBe(false);
  });

  it("the seam content is otherwise identical to the language:'c' run's seam (modulo the two allowed substitutions)", () => {
    const cSeam = cArt.files.find((f) => f.path === "bme280_hal_stm32.c")!.content;
    const cppSeam = cppArt.files.find((f) => f.path === "bme280_hal_stm32.cpp")!.content;
    expect(normalizeSeam(cppSeam, "bme280", "stm32")).toEqual(normalizeSeam(cSeam, "bme280", "stm32"));
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
