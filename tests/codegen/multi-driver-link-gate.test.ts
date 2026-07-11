import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { hasGcc, registerDatasheet, spiRegisterDatasheet } from "./helpers";

// L2 regression gate — the EXACT field failure from raw/stm32-test-results/
// (CAP1206-report.md §6, TUSS4470_DRIVERGE_RAPORU.md §6): driverge-mcp
// 0.1.0-beta.2 emitted GENERIC, unprefixed STM32 seam globals
// (`hal_i2c_write`, `hal_delay_ms`, `hal_spi_transfer`, ...). A project with
// TWO Driverge drivers (one I2C, one SPI) always shared `hal_delay_ms`
// (common to every bus) and, when both were I2C, the whole hal_i2c_* pair —
// a real STM32 link failure: "multiple definition of `hal_delay_ms'".
//
// This gate reproduces that exact scenario at the host-compiler level: two
// DIFFERENT parts (one I2C register_map, one SPI register_map) generated for
// target=stm32, all four .c files (2 cores + 2 seams) compiled, then LINKED
// together (plus a trivial main). Under the OLD (unprefixed) contract this
// link fails with "multiple definition of `hal_delay_ms'" (and, since both
// parts are on different buses here, that symbol alone is enough to
// reproduce the TUSS4470 report's failure). Under the NEW per-driver-prefixed
// contract (`<slug>_hal_*`) every seam symbol name embeds the part's own
// slug, so the two seam files share NO external symbol name and the link
// must succeed cleanly — matching the CAP1206 report's `nm`-verified "shared
// defined symbols between them: (none)" outcome.
//
// A minimal, hand-written CubeHAL stub `main.h` stands in for the real
// STM32Cube HAL headers (no real toolchain/HAL available in CI); it declares
// enough of both the OLD and NEW SPI seam bodies' CubeHAL surface
// (HAL_SPI_Transmit/Receive AND HAL_SPI_TransmitReceive) so this gate keeps
// working across the RED -> GREEN transition without needing to change the
// stub.

const FAKE_CUBE_MAIN_H = `#ifndef MAIN_H
#define MAIN_H

#include <stdint.h>

typedef enum { HAL_OK = 0, HAL_ERROR = 1, HAL_BUSY = 2, HAL_TIMEOUT = 3 } HAL_StatusTypeDef;
typedef struct { int _dummy; } I2C_HandleTypeDef;
typedef struct { int _dummy; } SPI_HandleTypeDef;
typedef struct { int _dummy; } UART_HandleTypeDef;
typedef struct { int _dummy; } GPIO_TypeDef;
typedef uint16_t GPIO_PinState;

#define GPIO_PIN_RESET 0
#define GPIO_PIN_SET 1
#define I2C_MEMADD_SIZE_8BIT 1

HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *hi2c, uint16_t DevAddress, uint16_t MemAddress,
    uint16_t MemAddSize, uint8_t *pData, uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_I2C_Mem_Read(I2C_HandleTypeDef *hi2c, uint16_t DevAddress, uint16_t MemAddress,
    uint16_t MemAddSize, uint8_t *pData, uint16_t Size, uint32_t Timeout);

HAL_StatusTypeDef HAL_SPI_Transmit(SPI_HandleTypeDef *hspi, uint8_t *pData, uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_SPI_Receive(SPI_HandleTypeDef *hspi, uint8_t *pData, uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_SPI_TransmitReceive(SPI_HandleTypeDef *hspi, uint8_t *pTxData, uint8_t *pRxData,
    uint16_t Size, uint32_t Timeout);

HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size, uint32_t Timeout);
HAL_StatusTypeDef HAL_UART_Receive(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size, uint32_t Timeout);

void HAL_GPIO_WritePin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin, GPIO_PinState PinState);
void HAL_Delay(uint32_t Delay);

#endif /* MAIN_H */
`;

// Trivial DEFINITIONS for every prototype in FAKE_CUBE_MAIN_H. Without this,
// the link would fail with "undefined reference to HAL_I2C_Mem_Write" etc.
// forever, regardless of whether the seam symbols are prefixed — that would
// make the gate red for the WRONG reason (missing stub, not the field-test
// seam-collision bug) even after the coder's fix. This stub's own function
// names are vendor CubeHAL names (never per-driver-prefixed on purpose) —
// there is exactly one of each in the whole link, so it never collides.
const FAKE_CUBEHAL_STUB_C = `#include "main.h"

HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *hi2c, uint16_t DevAddress, uint16_t MemAddress,
    uint16_t MemAddSize, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)hi2c; (void)DevAddress; (void)MemAddress; (void)MemAddSize; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_I2C_Mem_Read(I2C_HandleTypeDef *hi2c, uint16_t DevAddress, uint16_t MemAddress,
    uint16_t MemAddSize, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)hi2c; (void)DevAddress; (void)MemAddress; (void)MemAddSize; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_SPI_Transmit(SPI_HandleTypeDef *hspi, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)hspi; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_SPI_Receive(SPI_HandleTypeDef *hspi, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)hspi; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_SPI_TransmitReceive(SPI_HandleTypeDef *hspi, uint8_t *pTxData, uint8_t *pRxData,
    uint16_t Size, uint32_t Timeout) {
    (void)hspi; (void)pTxData; (void)pRxData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)huart; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

HAL_StatusTypeDef HAL_UART_Receive(UART_HandleTypeDef *huart, uint8_t *pData, uint16_t Size, uint32_t Timeout) {
    (void)huart; (void)pData; (void)Size; (void)Timeout;
    return HAL_OK;
}

void HAL_GPIO_WritePin(GPIO_TypeDef *GPIOx, uint16_t GPIO_Pin, GPIO_PinState PinState) {
    (void)GPIOx; (void)GPIO_Pin; (void)PinState;
}

void HAL_Delay(uint32_t Delay) {
    (void)Delay;
}
`;

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function compileObj(dir: string, srcPath: string): string {
  const obj = join(dir, srcPath.replace(/\.c$/, ".o"));
  try {
    execFileSync("gcc", ["-std=c11", "-c", join(dir, srcPath), "-o", obj]);
  } catch (err) {
    const e = err as { stderr?: Buffer; message: string };
    throw new Error(`compiling ${srcPath} failed:\n${e.stderr ? e.stderr.toString() : e.message}`);
  }
  return obj;
}

function link(objs: string[], out: string): void {
  try {
    execFileSync("gcc", [...objs, "-o", out]);
  } catch (err) {
    const e = err as { stderr?: Buffer; message: string };
    throw new Error(
      `link failed — two Driverge stm32 drivers collided at link (the exact\n` +
        `TUSS4470/CAP1206 field-test regression):\n${e.stderr ? e.stderr.toString() : e.message}`,
    );
  }
}

describe.skipIf(!hasGcc())(
  "multi-driver link gate — two stm32 drivers (I2C + SPI) must not collide at link (regression: raw/stm32-test-results §6)",
  () => {
    it("links cleanly: the two drivers' seam symbol sets are disjoint (no `multiple definition` at link)", () => {
      const i2cJson = registerDatasheet("bme280.golden.json", "CAP1206");
      const spiJson = spiRegisterDatasheet("tmag5170.golden.json", "TUSS4470");
      const i2cArt = generateDriver(i2cJson, "stm32");
      const spiArt = generateDriver(spiJson, "stm32");

      const dir = mkdtempSync(join(tmpdir(), "driverge-link-"));
      dirs.push(dir);

      writeFileSync(join(dir, "main.h"), FAKE_CUBE_MAIN_H);
      writeFileSync(join(dir, "cubehal_stub.c"), FAKE_CUBEHAL_STUB_C);
      writeFileSync(join(dir, "app_main.c"), "int main(void) { return 0; }\n");

      const allFiles = [...i2cArt.files, ...spiArt.files];
      for (const f of allFiles) writeFileSync(join(dir, f.path), f.content);

      const objs: string[] = [];
      for (const f of allFiles) {
        if (!f.path.endsWith(".c")) continue; // headers aren't compiled directly
        objs.push(compileObj(dir, f.path));
      }
      objs.push(compileObj(dir, "cubehal_stub.c"));
      objs.push(compileObj(dir, "app_main.c"));

      expect(() => link(objs, join(dir, "driverge-link-gate.exe"))).not.toThrow();
    });
  },
);
