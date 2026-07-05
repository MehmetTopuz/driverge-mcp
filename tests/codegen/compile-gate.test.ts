import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { generatePortableDriver } from "../../src/codegen/portable";
import {
  canRegisterDatasheet,
  commandDatasheet,
  hasGcc,
  registerDatasheet,
  spiRegisterDatasheet,
  uartRegisterDatasheet,
} from "./helpers";

// L2 compile gate: the generated portable skeleton must be valid C. We compile
// with `gcc -c` (no link) against the thin-HAL seam — the hal_* symbols stay
// undefined, which is fine at the compile stage. Skips where gcc is absent
// (fresh clone / CI without a toolchain).
const dirs: string[] = [];

function compileOK(files: { path: string; content: string }[], main: string): void {
  const dir = mkdtempSync(join(tmpdir(), "driverge-cc-"));
  dirs.push(dir);
  for (const f of files) writeFileSync(join(dir, f.path), f.content);
  // Throws (failing the test) on any compile error; stderr surfaces in the message.
  execFileSync("gcc", ["-std=c11", "-Wall", "-c", join(dir, main), "-o", join(dir, "out.o")]);
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasGcc())("portable driver compiles with gcc -c", () => {
  it("register_map skeleton (BME280)", () => {
    const art = generatePortableDriver(registerDatasheet("bme280.golden.json", "BME280"));
    expect(() => compileOK(art.files, "bme280.c")).not.toThrow();
  });

  it("command_set skeleton (SHT3x)", () => {
    const art = generatePortableDriver(commandDatasheet());
    expect(() => compileOK(art.files, "sht3x.c")).not.toThrow();
  });

  it("SPI register_map skeleton compiles with the combined hal_spi_transfer seam (TMAG5170)", () => {
    const art = generatePortableDriver(spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"));
    expect(() => compileOK(art.files, "tmag5170.c")).not.toThrow();
  });

  it("esp32 target — the portable CORE still compiles (the IDF seam is not gated)", () => {
    const art = generateDriver(registerDatasheet("bme280.golden.json", "BME280"), "esp32");
    // Only the core .c is compiled; bme280_hal_esp32.c needs the ESP-IDF headers
    // (that is the user's idf.py build / HIL step, not the in-repo gate).
    expect(() => compileOK(art.files, "bme280.c")).not.toThrow();
  });

  it("stm32 target — the portable CORE still compiles (the CubeHAL seam is not gated)", () => {
    const art = generateDriver(registerDatasheet("bme280.golden.json", "BME280"), "stm32");
    // bme280_hal_stm32.c needs the CubeHAL headers (the user's CubeIDE build).
    expect(() => compileOK(art.files, "bme280.c")).not.toThrow();
  });

  it("esp32 target — the portable CORE still compiles for a SPI part (native SPI support, Session A)", () => {
    const art = generateDriver(spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"), "esp32");
    // Only the core .c is compiled; tmag5170_hal_esp32.c needs the ESP-IDF spi_master
    // headers (the user's idf.py build / HIL step, not the in-repo gate).
    expect(() => compileOK(art.files, "tmag5170.c")).not.toThrow();
  });

  it("stm32 target — the portable CORE still compiles for a SPI part (native SPI support, Session A)", () => {
    const art = generateDriver(spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"), "stm32");
    // tmag5170_hal_stm32.c needs the CubeHAL headers (the user's CubeIDE build).
    expect(() => compileOK(art.files, "tmag5170.c")).not.toThrow();
  });

  it("UART register_map skeleton compiles with placeholder TODO(driverge) framing bodies (MHZ19-shaped, Session B)", () => {
    const art = generatePortableDriver(uartRegisterDatasheet("bme280.golden.json", "MHZ19"));
    expect(() => compileOK(art.files, "mhz19.c")).not.toThrow();
  });

  it("esp32 target — the portable CORE still compiles for a UART part (native UART support, Session B)", () => {
    const art = generateDriver(uartRegisterDatasheet("bme280.golden.json", "MHZ19"), "esp32");
    // Only the core .c is compiled; mhz19_hal_esp32.c needs the ESP-IDF UART
    // driver headers (the user's idf.py build / HIL step, not the in-repo gate).
    expect(() => compileOK(art.files, "mhz19.c")).not.toThrow();
  });

  it("stm32 target — the portable CORE still compiles for a UART part (native UART support, Session B)", () => {
    const art = generateDriver(uartRegisterDatasheet("bme280.golden.json", "MHZ19"), "stm32");
    // mhz19_hal_stm32.c needs the CubeHAL headers (the user's CubeIDE build).
    expect(() => compileOK(art.files, "mhz19.c")).not.toThrow();
  });

  it("CAN register_map skeleton compiles with placeholder TODO(driverge) framing bodies naming hal_can_transfer (Session C)", () => {
    const art = generatePortableDriver(canRegisterDatasheet("bme280.golden.json", "CANTEMP"));
    expect(() => compileOK(art.files, "cantemp.c")).not.toThrow();
  });

  it("esp32 target — the portable CORE still compiles for a CAN part (native CAN/TWAI support, Session C)", () => {
    const art = generateDriver(canRegisterDatasheet("bme280.golden.json", "CANTEMP"), "esp32");
    // Only the core .c is compiled; cantemp_hal_esp32.c needs the ESP-IDF TWAI
    // driver headers (the user's idf.py build / HIL step, not the in-repo gate).
    expect(() => compileOK(art.files, "cantemp.c")).not.toThrow();
  });
});
