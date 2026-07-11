import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import type { DatasheetJson } from "../../src/schema/types";
import {
  canRegisterDatasheet,
  commandDatasheet,
  registerDatasheet,
  spiRegisterDatasheet,
  uartRegisterDatasheet,
} from "./helpers";

const wide16Datasheet = (): DatasheetJson =>
  ({
    metadata: {
      part: "WIDE16",
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "SPI" },
    interface: {
      kind: "register_map",
      registers: [
        {
          name: "ctrl",
          address: "0x00",
          reset: "0x0000",
          width: 16,
          bitFields: [
            { name: "gain", msb: 11, lsb: 8 },
            { name: "en", msb: 0, lsb: 0 },
          ],
        },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  }) as unknown as DatasheetJson;

// Session E: seam prefixing + SPI full-duplex (2026-07-11 STM32 field-test
// findings, see raw/stm32-test-results/*.md + the approved plan). Every
// thin-HAL seam symbol becomes `<slug>_hal_*` (slug of json.metadata.part) —
// generic `hal_i2c_write`/`hal_delay_ms`/`hal_spi_transfer` collided at link
// in 2 of 3 field sessions (CAP1206+FXL6408, TUSS4470+FXL6408, both sharing
// `hal_delay_ms`). SPI additionally moves from a two-phase (tx_len, rx_len)
// half-duplex call to ONE full-duplex hal_spi_transfer(tx, rx, len) — the
// TUSS4470 report's real fix (`HAL_SPI_TransmitReceive`, single CS window).
//
// The read/write-body helpers below pin the SHAPE (one full-duplex transfer
// call, tx byte 0 = reg, tx byte 1 = 0x00 padding for reads, *value taken from
// rx[1], the seam's status propagated) without hard-coding variable names —
// the plan explicitly leaves naming to the implementer.

function assertFullDuplexRead(fnBody: string, seamName: string): void {
  const call = new RegExp(
    `(\\w+)\\s*=\\s*${seamName}\\(\\s*(\\w+)\\s*,\\s*(\\w+)\\s*,\\s*2\\s*\\)`,
  ).exec(fnBody);
  expect(
    call,
    `no "<status> = ${seamName}(<tx>, <rx>, 2)" call found in:\n${fnBody}`,
  ).toBeTruthy();
  const [, statusVar, txVar, rxVar] = call!;
  expect(fnBody).toMatch(new RegExp(`${txVar}\\[0\\]\\s*=\\s*reg`));
  expect(fnBody).toMatch(new RegExp(`${txVar}\\[1\\]\\s*=\\s*0x00`));
  expect(fnBody).toMatch(new RegExp(`\\*value\\s*=\\s*${rxVar}\\[1\\]`));
  expect(fnBody).toMatch(new RegExp(`return\\s+${statusVar}\\s*;`));
}

function assertFullDuplexWrite(fnBody: string, seamName: string): void {
  const direct = new RegExp(
    `return\\s+${seamName}\\(\\s*(\\w+)\\s*,\\s*(?:NULL|nullptr)\\s*,\\s*2\\s*\\)\\s*;`,
  ).exec(fnBody);
  const viaVar = new RegExp(
    `(\\w+)\\s*=\\s*${seamName}\\(\\s*(\\w+)\\s*,\\s*(?:NULL|nullptr)\\s*,\\s*2\\s*\\)[\\s\\S]*?return\\s+\\1\\s*;`,
  ).exec(fnBody);
  const match = direct ?? viaVar;
  expect(
    match,
    `no "${seamName}(<tx>, NULL, 2)" call with a propagated status found in:\n${fnBody}`,
  ).toBeTruthy();
  const txVar = direct ? direct[1] : viaVar![2];
  expect(fnBody).toMatch(new RegExp(`${txVar}\\[0\\]\\s*=\\s*reg`));
  expect(fnBody).toMatch(new RegExp(`${txVar}\\[1\\]\\s*=\\s*value`));
}

// ADXL345-shaped: a real SPI part whose register-read convention sets the
// address MSB (0x80 | reg) — exactly the quirk the quirks_todo must flag.
const spiDatasheet = (): DatasheetJson =>
  ({
    metadata: {
      part: "ADXL345",
      manufacturer: "Analog Devices",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "SPI" },
    interface: {
      kind: "register_map",
      registers: [
        { name: "DEVID", address: "0x00", reset: "0xE5", width: 8, bitFields: [] },
        {
          name: "POWER_CTL",
          address: "0x2D",
          reset: "0x00",
          width: 8,
          bitFields: [{ name: "MEASURE", msb: 3, lsb: 3 }],
        },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  }) as unknown as DatasheetJson;

describe("generatePortableDriver — SPI full-duplex prefixed seam (ADXL345-shaped)", () => {
  const art = generatePortableDriver(spiDatasheet());
  const header = art.files.find((f) => f.path === "adxl345.h")!.content;
  const source = art.files.find((f) => f.path === "adxl345.c")!.content;

  it("declares a single prefixed full-duplex adxl345_hal_spi_transfer seam plus adxl345_hal_delay_ms", () => {
    expect(header).toContain(
      "int adxl345_hal_spi_transfer(const uint8_t *tx, uint8_t *rx, uint16_t len);",
    );
    expect(header).toContain("void adxl345_hal_delay_ms (uint32_t ms);");
  });

  it("documents the full-duplex contract: CS-framed, len bytes, rx may be NULL, and the half-duplex write-then-read idiom via tx padding", () => {
    const seamBlock = /\/\* Thin-HAL seam[\s\S]*?\/\* Driver handle/.exec(header)?.[0] ?? "";
    expect(seamBlock).toMatch(/full.duplex/i);
    expect(seamBlock).toMatch(/CS.framed/i);
    expect(seamBlock).toMatch(/len bytes/i);
    expect(seamBlock).toMatch(/rx.*NULL/);
    expect(seamBlock).toMatch(/write.only/i);
    expect(seamBlock).toMatch(/dummy/i);
    expect(seamBlock).toMatch(/0x00/);
    expect(seamBlock).toMatch(/rx\[0\]/);
    expect(seamBlock).toMatch(/garbage/i);
  });

  it("never emits the retired two-function hal_spi_write/hal_spi_read seam, nor the old (tx_len, rx_len) half-duplex signature", () => {
    expect(header).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(source).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(header).not.toMatch(/tx_len|rx_len/);
  });

  it("never emits an unprefixed (bare) hal_spi_transfer or hal_delay_ms call", () => {
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\s*\(/);
    expect(source).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
  });

  it("reads a register via one full-duplex 2-byte adxl345_hal_spi_transfer call: tx={reg,0x00}, *value=rx[1]", () => {
    const readFn = /adxl345_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    assertFullDuplexRead(readFn, "adxl345_hal_spi_transfer");
  });

  it("writes a register via a 2-byte {reg,value} tx frame and NULL rx through adxl345_hal_spi_transfer", () => {
    const writeFn = /adxl345_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    assertFullDuplexWrite(writeFn, "adxl345_hal_spi_transfer");
  });

  it("flags the register-address bit convention as a quirks_todo for the host AI to verify", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/address bit convention/i);
  });

  it("is deterministic", () => {
    expect(generatePortableDriver(spiDatasheet()).files).toEqual(art.files);
  });
});

describe("generatePortableDriver — SPI full-duplex seam on a realistic multi-register part (TMAG5170 golden)", () => {
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "tmag5170.h")!.content;
  const source = art.files.find((f) => f.path === "tmag5170.c")!.content;

  it("uses the prefixed combined tmag5170_hal_spi_transfer seam, never the retired write/read pair or a bare name", () => {
    expect(header).toContain(
      "int tmag5170_hal_spi_transfer(const uint8_t *tx, uint8_t *rx, uint16_t len);",
    );
    expect(header).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
    expect(source).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(source).not.toMatch(/[^_a-zA-Z0-9]hal_spi_transfer\(/);
  });

  it("routes read_register/write_register through the full-duplex tmag5170_hal_spi_transfer seam", () => {
    const readFn = /tmag5170_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const writeFn = /tmag5170_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    assertFullDuplexRead(readFn, "tmag5170_hal_spi_transfer");
    assertFullDuplexWrite(writeFn, "tmag5170_hal_spi_transfer");
  });

  it("still flags the address bit convention quirk for this real part", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/address bit convention/i);
  });
});

// UART bus family: framing is device-specific, so read/write bodies are a
// TODO(driverge) reasoning gap over the raw hal_uart_write/hal_uart_read seam.
// Session E: both the declarations AND the framing-gap prose now name the
// per-driver PREFIXED seam functions (mhz19_hal_uart_write/read), not the
// bare hal_uart_write/read family.
describe("generatePortableDriver — UART thin-HAL prefixed seam (MHZ19-shaped CO2 sensor, register_map)", () => {
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "mhz19.h")!.content;
  const source = art.files.find((f) => f.path === "mhz19.c")!.content;

  it("declares the prefixed mhz19_hal_uart_write/mhz19_hal_uart_read seam plus mhz19_hal_delay_ms — no hal_i2c_*/hal_spi_* anywhere, and no bare hal_uart_*/hal_delay_ms", () => {
    expect(header).toContain("void mhz19_hal_uart_write(const uint8_t *data, uint16_t len);");
    expect(header).toContain(
      "uint16_t mhz19_hal_uart_read(uint8_t *data, uint16_t len, uint32_t timeout_ms);",
    );
    expect(header).toContain("void mhz19_hal_delay_ms (uint32_t ms);");
    expect(header).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_uart_write\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_uart_read\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\s*\(/);
  });

  it("documents mhz19_hal_uart_write/mhz19_hal_uart_read semantics next to the seam declarations", () => {
    const seamBlock = /\/\* Thin-HAL seam[\s\S]*?\/\* Driver handle/.exec(header)?.[0] ?? "";
    expect(seamBlock).toMatch(/mhz19_hal_uart_write/);
    expect(seamBlock).toMatch(/blocking write/i);
    expect(seamBlock).toMatch(/len bytes/i);
    expect(seamBlock).toMatch(/mhz19_hal_uart_read/);
    expect(seamBlock).toMatch(/up to.{0,10}len bytes/i);
    expect(seamBlock).toMatch(/timeout_ms/);
    expect(seamBlock).toMatch(/actually read/i);
  });

  it("leaves read_register/write_register as TODO(driverge) framing gaps naming both PREFIXED seam functions", () => {
    const readFn = /mhz19_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const writeFn = /mhz19_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("mhz19_hal_uart_write");
    expect(readFn).toContain("mhz19_hal_uart_read");
    expect(writeFn).toContain("TODO(driverge)");
    expect(writeFn).toMatch(/frame/i);
    expect(writeFn).toContain("mhz19_hal_uart_write");
    expect(writeFn).toContain("mhz19_hal_uart_read");
  });

  it("adds a framing_todo naming both PREFIXED seam functions and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("mhz19_hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("mhz19_hal_uart_read");
  });

  it("mentions checksum verification in quirks_todo", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/checksum/i);
  });

  it("is deterministic", () => {
    expect(generatePortableDriver(json).files).toEqual(art.files);
  });
});

const uartCommandDatasheet = (): DatasheetJson =>
  ({
    metadata: {
      part: "MHZ19",
      manufacturer: "Winsen",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "UART" },
    interface: {
      kind: "command_set",
      commands: [{ name: "read_co2_concentration", code: "0x86" }],
    },
    validation: { valid: true, errors: [], warnings: [] },
  }) as unknown as DatasheetJson;

describe("generatePortableDriver — UART command_set prefixed seam (MHZ19-shaped CO2 sensor)", () => {
  const art = generatePortableDriver(uartCommandDatasheet());
  const header = art.files.find((f) => f.path === "mhz19.h")!.content;
  const source = art.files.find((f) => f.path === "mhz19.c")!.content;

  it("declares the prefixed mhz19_hal_uart_write/mhz19_hal_uart_read seam and never an I2C device-address macro", () => {
    expect(header).toContain("void mhz19_hal_uart_write(const uint8_t *data, uint16_t len);");
    expect(header).toContain(
      "uint16_t mhz19_hal_uart_read(uint8_t *data, uint16_t len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(header).not.toMatch(/_I2C_ADDR/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_uart_write\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_uart_read\(/);
  });

  it("leaves send_command/read_data as TODO(driverge) framing gaps naming both PREFIXED seam functions", () => {
    const sendFn = /mhz19_send_command\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const readFn = /mhz19_read_data\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(sendFn).toContain("TODO(driverge)");
    expect(sendFn).toMatch(/frame/i);
    expect(sendFn).toContain("mhz19_hal_uart_write");
    expect(sendFn).toContain("mhz19_hal_uart_read");
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("mhz19_hal_uart_write");
    expect(readFn).toContain("mhz19_hal_uart_read");
  });

  it("adds a framing_todo naming both PREFIXED seam functions and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("mhz19_hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("mhz19_hal_uart_read");
  });

  it("mentions checksum verification in quirks_todo", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/checksum/i);
  });
});

// CAN bus family: like UART, no universal register-access primitive, so
// read/write are a TODO(driverge) framing gap over a single PREFIXED
// hal_can_transfer() seam call.
const canDatasheetName = "CANTEMP";

describe("generatePortableDriver — CAN thin-HAL prefixed seam (CANTEMP-shaped, register_map)", () => {
  const json = canRegisterDatasheet("bme280.golden.json", canDatasheetName);
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "cantemp.h")!.content;
  const source = art.files.find((f) => f.path === "cantemp.c")!.content;

  it("declares the single prefixed cantemp_hal_can_transfer seam plus cantemp_hal_delay_ms — no hal_i2c_*/hal_spi_*/hal_uart_* anywhere, and no bare cantemp seam names", () => {
    expect(header).toContain(
      "int cantemp_hal_can_transfer(uint32_t id, const uint8_t *tx, uint8_t tx_len, uint8_t *rx, uint8_t *rx_len, uint32_t timeout_ms);",
    );
    expect(header).toContain("void cantemp_hal_delay_ms (uint32_t ms);");
    expect(header).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_can_transfer\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\s*\(/);
  });

  it("documents cantemp_hal_can_transfer semantics next to the seam declaration", () => {
    const seamBlock = /\/\* Thin-HAL seam[\s\S]*?\/\* Driver handle/.exec(header)?.[0] ?? "";
    expect(seamBlock).toMatch(/cantemp_hal_can_transfer/);
    expect(seamBlock).toMatch(/one CAN frame/i);
    expect(seamBlock).toMatch(/arbitration id/i);
    expect(seamBlock).toMatch(/0 on success/i);
    expect(seamBlock).toMatch(/buffer capacity/i);
    expect(seamBlock).toMatch(/actually received/i);
  });

  it("leaves read_register/write_register as TODO(driverge) framing gaps naming the PREFIXED cantemp_hal_can_transfer", () => {
    const readFn = /cantemp_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const writeFn = /cantemp_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("cantemp_hal_can_transfer");
    expect(writeFn).toContain("TODO(driverge)");
    expect(writeFn).toMatch(/frame/i);
    expect(writeFn).toContain("cantemp_hal_can_transfer");
  });

  it("adds a framing_todo naming the PREFIXED cantemp_hal_can_transfer and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("cantemp_hal_can_transfer");
  });

  it("mentions arbitration id / SDO / message-ID reasoning in quirks_todo (CAN-specific wording, not generic checksum wording)", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/arbitration|SDO|message.?id/i);
  });

  it("is deterministic", () => {
    expect(generatePortableDriver(json).files).toEqual(art.files);
  });
});

const canCommandDatasheet = (): DatasheetJson =>
  ({
    metadata: {
      part: canDatasheetName,
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
  }) as unknown as DatasheetJson;

describe("generatePortableDriver — CAN command_set prefixed seam (CANTEMP-shaped)", () => {
  const art = generatePortableDriver(canCommandDatasheet());
  const header = art.files.find((f) => f.path === "cantemp.h")!.content;
  const source = art.files.find((f) => f.path === "cantemp.c")!.content;

  it("declares the prefixed cantemp_hal_can_transfer seam and never an I2C/UART device-address macro", () => {
    expect(header).toContain(
      "int cantemp_hal_can_transfer(uint32_t id, const uint8_t *tx, uint8_t tx_len, uint8_t *rx, uint8_t *rx_len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(header).not.toMatch(/_I2C_ADDR/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_can_transfer\(/);
  });

  it("leaves send_command/read_data as TODO(driverge) framing gaps naming the PREFIXED cantemp_hal_can_transfer", () => {
    const sendFn = /cantemp_send_command\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const readFn = /cantemp_read_data\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(sendFn).toContain("TODO(driverge)");
    expect(sendFn).toMatch(/frame/i);
    expect(sendFn).toContain("cantemp_hal_can_transfer");
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("cantemp_hal_can_transfer");
  });

  it("adds a framing_todo naming the PREFIXED cantemp_hal_can_transfer and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("cantemp_hal_can_transfer");
  });

  it("mentions arbitration id / SDO / message-ID reasoning in quirks_todo (CAN-specific wording)", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/arbitration|SDO|message.?id/i);
  });
});

describe("generatePortableDriver — framing_todo is a UART/CAN-only reasoning gap (absent for I2C/SPI)", () => {
  it("is undefined for an I2C register_map part (BME280)", () => {
    const art = generatePortableDriver(registerDatasheet("bme280.golden.json", "BME280"));
    expect(art.fill_in_brief.framing_todo).toBeUndefined();
  });

  it("is undefined for an SPI register_map part (TMAG5170)", () => {
    const art = generatePortableDriver(spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170"));
    expect(art.fill_in_brief.framing_todo).toBeUndefined();
  });

  it("is undefined for an I2C command_set part (SHT3x)", () => {
    const art = generatePortableDriver(commandDatasheet());
    expect(art.fill_in_brief.framing_todo).toBeUndefined();
  });
});

describe("generatePortableDriver — register_map (BME280 golden), I2C prefixed seam", () => {
  const json = registerDatasheet("bme280.golden.json", "BME280");
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "bme280.h")!.content;
  const source = art.files.find((f) => f.path === "bme280.c")!.content;

  it("emits the two driver files named from the part", () => {
    expect(art.files.map((f) => f.path)).toEqual(["bme280.h", "bme280.c"]);
  });

  it("emits register address constants (skipping range pseudo-registers)", () => {
    expect(header).toContain("#define BME280_REG_ID 0xD0");
    expect(header).toContain("#define BME280_REG_CTRL_MEAS 0xF4");
    // "calib00..calib25" (address "0x88…0xA1") is a range — not a clean #define.
    expect(header).not.toContain("CALIB00");
  });

  it("computes bit-field mask + shift from JSON geometry", () => {
    expect(header).toContain("#define BME280_CTRL_MEAS_OSRS_T_MASK  0xE0");
    expect(header).toContain("#define BME280_CTRL_MEAS_OSRS_T_SHIFT 5");
    expect(header).toContain("#define BME280_CONFIG_SPI3W_EN_MASK  0x01");
    expect(header).toContain("#define BME280_STATUS_MEASURING_MASK  0x08");
    expect(header).toContain("#define BME280_STATUS_MEASURING_SHIFT 3");
  });

  it("declares only the PREFIXED thin-HAL seam and routes reads/writes through it — no bare hal_i2c_*/hal_delay_ms", () => {
    expect(header).toContain(
      "int bme280_hal_i2c_write(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);",
    );
    expect(header).toContain(
      "int bme280_hal_i2c_read (uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);",
    );
    expect(header).toContain("void bme280_hal_delay_ms (uint32_t ms);");
    expect(source).toContain("bme280_hal_i2c_read(dev->i2c_addr, reg, value, 1);");
    expect(source).not.toMatch(/HAL_I2C_|Wire\.|i2c_master_/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_read\s*\(/);
    expect(header).not.toMatch(/[^_a-zA-Z0-9]hal_delay_ms\s*\(/);
  });

  // A7 (raw/DRIVERGE_ISSUES.md): the seam returns int (0 = success) and the
  // driver core PROPAGATES it — a NACK/bus error must reach the caller instead
  // of being swallowed by an unconditional `return 0`.
  it("propagates the PREFIXED I2C seam status out of read_register/write_register (no swallowed errors)", () => {
    expect(source).toContain("return bme280_hal_i2c_read(dev->i2c_addr, reg, value, 1);");
    expect(source).toContain("return bme280_hal_i2c_write(dev->i2c_addr, reg, &value, 1);");
  });

  it("marks reasoning gaps with TODO(driverge) and a matching brief", () => {
    expect(source).toContain("TODO(driverge)");
    expect(art.fill_in_brief.init_sequence_todo).toMatch(/BME280/);
    expect(art.fill_in_brief).toHaveProperty("quirks_todo");
    expect(art.fill_in_brief).toHaveProperty("doc_todo");
  });

  it("is deterministic (no timestamps / stable ordering)", () => {
    const again = generatePortableDriver(json);
    expect(again.files).toEqual(art.files);
  });
});

describe("generatePortableDriver — command_set (SHT3x golden), I2C prefixed seam", () => {
  const art = generatePortableDriver(commandDatasheet());
  const header = art.files.find((f) => f.path === "sht3x.h")!.content;
  const source = art.files.find((f) => f.path === "sht3x.c")!.content;

  it("emits command code + CRC constants", () => {
    expect(header).toContain("#define SHT3X_CMD_SOFT_RESET 0x30A2");
    expect(header).toContain("#define SHT3X_CMD_READ_OUT_OF_STATUS_REGISTER 0xF32D");
    expect(header).toContain("#define SHT3X_CRC_POLY 0x31");
    expect(header).toContain("#define SHT3X_CRC_INIT 0xFF");
  });

  it("emits a wire-correct send_command through the PREFIXED sht3x_hal_i2c_write seam and a CRC stub behind TODO", () => {
    expect(header).toContain("int sht3x_send_command(sht3x_t *dev, uint16_t command);");
    expect(source).toContain("sht3x_hal_i2c_write(dev->i2c_addr, msb, &lsb, 1);");
    expect(source).not.toMatch(/[^_a-zA-Z0-9]hal_i2c_write\(/);
    expect(source).toContain("uint8_t sht3x_crc8(const uint8_t *data, uint16_t len)");
    expect(art.fill_in_brief.crc_todo).toMatch(/CRC-8/);
  });
});

// Phase 4: prose-extracted commands (e.g. DHT20 trigger_measurement 0xAC) can
// carry a `params` byte sequence the datasheet spells out in a follow-up
// sentence ("first byte is 0x33, ... second byte is 0x00"). The generated
// #define must surface those bytes as a same-line comment so the host AI (and
// a human reviewer) sees them without having to re-open the datasheet.
const paramsDatasheet = (): DatasheetJson =>
  ({
    metadata: {
      part: "DHT20",
      manufacturer: "Aosong",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x38"] },
    interface: {
      kind: "command_set",
      commands: [
        { name: "trigger_measurement", code: "0xAC", params: ["0x33", "0x00"] },
        { name: "status", code: "0x71" },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  }) as unknown as DatasheetJson;

describe("generatePortableDriver — command_set params comment (DHT20-shaped)", () => {
  it("emits the params byte sequence as a same-line comment on the command #define", () => {
    const art = generatePortableDriver(paramsDatasheet());
    const header = art.files.find((f) => f.path === "dht20.h")!.content;
    const line = header
      .split("\n")
      .find((l) => l.includes("DHT20_CMD_TRIGGER_MEASUREMENT"));
    expect(line).toBeDefined();
    expect(line).toMatch(
      /^#define DHT20_CMD_TRIGGER_MEASUREMENT 0xAC\s+\/\* params: 0x33, 0x00 \*\/$/,
    );
    // The param-less command on the same driver must NOT gain a stray comment.
    const statusLine = header.split("\n").find((l) => l.includes("DHT20_CMD_STATUS"));
    expect(statusLine).toBe("#define DHT20_CMD_STATUS 0x71");
  });
});

describe("generatePortableDriver — 16-bit register width", () => {
  const header = generatePortableDriver(wide16Datasheet()).files[0].content;

  it("emits width-correct 16-bit bit-field masks (4 hex digits)", () => {
    expect(header).toContain("#define WIDE16_CTRL_GAIN_MASK  0x0F00");
    expect(header).toContain("#define WIDE16_CTRL_GAIN_SHIFT 8");
    expect(header).toContain("#define WIDE16_CTRL_EN_MASK  0x0001");
  });

  it("annotates the register width", () => {
    expect(header).toMatch(/16-bit register/);
  });
});
