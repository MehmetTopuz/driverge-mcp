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

// Session A: SPI seam redesign. One hal_spi_transfer() call == one CS-framed
// transaction, replacing the old hal_spi_write/hal_spi_read pair (see decisions:
// thin-hal-non-negotiable). ADXL345-shaped: a real SPI part whose register-read
// convention sets the address MSB (0x80 | reg) — exactly the quirk the
// quirks_todo must flag for the host AI to verify.
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

describe("generatePortableDriver — SPI combined-transfer seam (ADXL345-shaped)", () => {
  const art = generatePortableDriver(spiDatasheet());
  const header = art.files.find((f) => f.path === "adxl345.h")!.content;
  const source = art.files.find((f) => f.path === "adxl345.c")!.content;

  it("declares a single combined hal_spi_transfer seam function plus hal_delay_ms", () => {
    expect(header).toContain(
      "int hal_spi_transfer(const uint8_t *tx, uint16_t tx_len, uint8_t *rx, uint16_t rx_len);",
    );
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
  });

  it("never emits the retired two-function hal_spi_write/hal_spi_read seam", () => {
    expect(header).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(source).not.toMatch(/hal_spi_write|hal_spi_read/);
  });

  it("reads a register with a single hal_spi_transfer call (reg out, value in)", () => {
    expect(source).toContain("hal_spi_transfer(&reg, 1, value, 1);");
  });

  it("writes a register by building a 2-byte frame and one hal_spi_transfer call (no rx)", () => {
    expect(source).toContain("frame[0] = reg;");
    expect(source).toContain("frame[1] = value;");
    expect(source).toContain("hal_spi_transfer(frame, 2, NULL, 0);");
  });

  it("flags the register-address bit convention as a quirks_todo for the host AI to verify", () => {
    // Stable contract phrase — the implementer must include this exact substring
    // (case-insensitive) in fill_in_brief.quirks_todo for SPI parts, e.g. a note
    // that many chips set the register-address MSB for reads (ADXL345: 0x80 | reg).
    expect(art.fill_in_brief.quirks_todo).toMatch(/address bit convention/i);
  });
});

describe("generatePortableDriver — SPI seam on a realistic multi-register part (TMAG5170 golden)", () => {
  const json = spiRegisterDatasheet("tmag5170.golden.json", "TMAG5170");
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "tmag5170.h")!.content;
  const source = art.files.find((f) => f.path === "tmag5170.c")!.content;

  it("uses the combined hal_spi_transfer seam, never the retired write/read pair", () => {
    expect(header).toContain(
      "int hal_spi_transfer(const uint8_t *tx, uint16_t tx_len, uint8_t *rx, uint16_t rx_len);",
    );
    expect(header).not.toMatch(/hal_spi_write|hal_spi_read/);
    expect(source).not.toMatch(/hal_spi_write|hal_spi_read/);
  });

  it("routes read_register/write_register through hal_spi_transfer", () => {
    expect(source).toContain("hal_spi_transfer(&reg, 1, value, 1);");
    expect(source).toContain("hal_spi_transfer(frame, 2, NULL, 0);");
  });

  it("still flags the address bit convention quirk for this real part", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/address bit convention/i);
  });
});

// Session B — UART bus family. UART has NO universal register-access primitive
// (framing is device-specific: start bytes, command IDs, checksums — see
// decisions: thin-hal-non-negotiable), so the generated read/write (or
// send/read) bodies are a deliberate reasoning gap: a TODO(driverge) framing
// marker over the raw hal_uart_write/hal_uart_read seam, never a real transfer.
// fill_in_brief gains a NEW `framing_todo` field to hand that gap to the host AI.
describe("generatePortableDriver — UART thin-HAL seam (MHZ19-shaped CO2 sensor, register_map)", () => {
  const json = uartRegisterDatasheet("bme280.golden.json", "MHZ19");
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "mhz19.h")!.content;
  const source = art.files.find((f) => f.path === "mhz19.c")!.content;

  it("declares the hal_uart_write/hal_uart_read seam plus hal_delay_ms — no hal_i2c_*/hal_spi_* anywhere", () => {
    expect(header).toContain("void hal_uart_write(const uint8_t *data, uint16_t len);");
    expect(header).toContain(
      "uint16_t hal_uart_read(uint8_t *data, uint16_t len, uint32_t timeout_ms);",
    );
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
    expect(header).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_/);
  });

  it("documents hal_uart_write/hal_uart_read semantics next to the seam declarations", () => {
    const seamBlock = /\/\* Thin-HAL seam[\s\S]*?\/\* Driver handle/.exec(header)?.[0] ?? "";
    expect(seamBlock).toMatch(/hal_uart_write/);
    expect(seamBlock).toMatch(/blocking write/i);
    expect(seamBlock).toMatch(/len bytes/i);
    expect(seamBlock).toMatch(/hal_uart_read/);
    expect(seamBlock).toMatch(/up to.{0,10}len bytes/i);
    expect(seamBlock).toMatch(/timeout_ms/);
    expect(seamBlock).toMatch(/actually read/i);
  });

  it("leaves read_register/write_register as TODO(driverge) framing gaps naming both seam functions", () => {
    const readFn = /mhz19_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const writeFn = /mhz19_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toMatch(/hal_uart_write/);
    expect(readFn).toMatch(/hal_uart_read/);
    expect(writeFn).toContain("TODO(driverge)");
    expect(writeFn).toMatch(/frame/i);
    expect(writeFn).toMatch(/hal_uart_write/);
    expect(writeFn).toMatch(/hal_uart_read/);
  });

  it("adds a framing_todo naming both seam functions and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_read");
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

describe("generatePortableDriver — UART command_set (MHZ19-shaped CO2 sensor)", () => {
  const art = generatePortableDriver(uartCommandDatasheet());
  const header = art.files.find((f) => f.path === "mhz19.h")!.content;
  const source = art.files.find((f) => f.path === "mhz19.c")!.content;

  it("declares the hal_uart_write/hal_uart_read seam and never an I2C device-address macro", () => {
    expect(header).toContain("void hal_uart_write(const uint8_t *data, uint16_t len);");
    expect(header).toContain(
      "uint16_t hal_uart_read(uint8_t *data, uint16_t len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_/);
    expect(header).not.toMatch(/_I2C_ADDR/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_/);
  });

  it("leaves send_command/read_data as TODO(driverge) framing gaps naming both seam functions", () => {
    const sendFn = /mhz19_send_command\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const readFn = /mhz19_read_data\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(sendFn).toContain("TODO(driverge)");
    expect(sendFn).toMatch(/frame/i);
    expect(sendFn).toMatch(/hal_uart_write/);
    expect(sendFn).toMatch(/hal_uart_read/);
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toMatch(/hal_uart_write/);
    expect(readFn).toMatch(/hal_uart_read/);
  });

  it("adds a framing_todo naming both seam functions and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_read");
  });

  it("mentions checksum verification in quirks_todo", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/checksum/i);
  });
});

// Session C — CAN bus family (first pass). Like UART, CAN has NO universal
// register-access primitive (register/config access over CAN is device-specific:
// CANopen SDO, J1939 PGNs, raw message-ID schemes — see decisions:
// thin-hal-non-negotiable), so read_register/write_register are a deliberate
// TODO(driverge) framing gap over a SINGLE combined hal_can_transfer() seam call
// (unlike UART's two-function write/read pair — one CAN transfer sends a frame to
// an arbitration id and optionally waits for one response frame). STM32 is
// explicitly OUT of scope this pass (bxCAN/FDCAN family split); ESP32 gets a TWAI
// seam (see tests/codegen/esp32.test.ts).
const canDatasheetName = "CANTEMP";

describe("generatePortableDriver — CAN thin-HAL seam (CANTEMP-shaped, register_map)", () => {
  const json = canRegisterDatasheet("bme280.golden.json", canDatasheetName);
  const art = generatePortableDriver(json);
  const header = art.files.find((f) => f.path === "cantemp.h")!.content;
  const source = art.files.find((f) => f.path === "cantemp.c")!.content;

  it("declares the single combined hal_can_transfer seam plus hal_delay_ms — no hal_i2c_*/hal_spi_*/hal_uart_* anywhere", () => {
    expect(header).toContain(
      "int hal_can_transfer(uint32_t id, const uint8_t *tx, uint8_t tx_len, uint8_t *rx, uint8_t *rx_len, uint32_t timeout_ms);",
    );
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
    expect(header).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
  });

  it("documents hal_can_transfer semantics next to the seam declaration", () => {
    const seamBlock = /\/\* Thin-HAL seam[\s\S]*?\/\* Driver handle/.exec(header)?.[0] ?? "";
    expect(seamBlock).toMatch(/hal_can_transfer/);
    // Stable contract phrases the coder's comment must include (case-insensitive):
    // one call = one CAN frame sent to an arbitration id, 0 on success, and
    // rx_len's dual in/out role (in: caller-supplied buffer capacity; out:
    // bytes actually received).
    expect(seamBlock).toMatch(/one CAN frame/i);
    expect(seamBlock).toMatch(/arbitration id/i);
    expect(seamBlock).toMatch(/0 on success/i);
    expect(seamBlock).toMatch(/buffer capacity/i);
    expect(seamBlock).toMatch(/actually received/i);
  });

  it("leaves read_register/write_register as TODO(driverge) framing gaps naming hal_can_transfer", () => {
    const readFn = /cantemp_read_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const writeFn = /cantemp_write_register\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("hal_can_transfer");
    expect(writeFn).toContain("TODO(driverge)");
    expect(writeFn).toMatch(/frame/i);
    expect(writeFn).toContain("hal_can_transfer");
  });

  it("adds a framing_todo naming hal_can_transfer and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_can_transfer");
  });

  // Contract decision (documented for the coder): CAN's quirks_todo must name the
  // CAN-specific reasoning gap — which arbitration id / SDO index / message ID
  // maps to which register — NOT a generic "verify the checksum" line reused
  // verbatim from UART. Pin: /arbitration|SDO|message.?id/i. This is deliberately
  // an OR of near-synonymous CAN vocabulary (any one is an honest answer), not a
  // vague catch-all — plain checksum wording alone must NOT satisfy it.
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

describe("generatePortableDriver — CAN command_set (CANTEMP-shaped)", () => {
  const art = generatePortableDriver(canCommandDatasheet());
  const header = art.files.find((f) => f.path === "cantemp.h")!.content;
  const source = art.files.find((f) => f.path === "cantemp.c")!.content;

  it("declares the hal_can_transfer seam and never an I2C/UART device-address macro", () => {
    expect(header).toContain(
      "int hal_can_transfer(uint32_t id, const uint8_t *tx, uint8_t tx_len, uint8_t *rx, uint8_t *rx_len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
    expect(header).not.toMatch(/_I2C_ADDR/);
    expect(source).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
  });

  it("leaves send_command/read_data as TODO(driverge) framing gaps naming hal_can_transfer", () => {
    const sendFn = /cantemp_send_command\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    const readFn = /cantemp_read_data\([\s\S]*?\n\}/.exec(source)?.[0] ?? "";
    expect(sendFn).toContain("TODO(driverge)");
    expect(sendFn).toMatch(/frame/i);
    expect(sendFn).toContain("hal_can_transfer");
    expect(readFn).toContain("TODO(driverge)");
    expect(readFn).toMatch(/frame/i);
    expect(readFn).toContain("hal_can_transfer");
  });

  it("adds a framing_todo naming hal_can_transfer and mentioning framing", () => {
    expect(art.fill_in_brief.framing_todo).toBeDefined();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_can_transfer");
  });

  it("mentions arbitration id / SDO / message-ID reasoning in quirks_todo (CAN-specific wording)", () => {
    expect(art.fill_in_brief.quirks_todo).toMatch(/arbitration|SDO|message.?id/i);
  });
});

// Session C adds a second bus to this "no universal register-access primitive"
// family (CAN, alongside UART) — see the CAN-specific describe blocks above this
// one for the positive framing_todo pins; this block only re-confirms I2C/SPI
// still never get one.
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

describe("generatePortableDriver — register_map (BME280 golden)", () => {
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

  it("declares only the thin-HAL seam and routes reads/writes through it", () => {
    expect(header).toContain("int hal_i2c_write(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);");
    expect(header).toContain("int hal_i2c_read (uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);");
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
    expect(source).toContain("hal_i2c_read(dev->i2c_addr, reg, value, 1);");
    expect(source).not.toMatch(/HAL_I2C_|Wire\.|i2c_master_/);
  });

  // A7 (raw/DRIVERGE_ISSUES.md): the seam returns int (0 = success) and the
  // driver core PROPAGATES it — a NACK/bus error must reach the caller instead
  // of being swallowed by an unconditional `return 0`.
  it("propagates the I2C seam status out of read_register/write_register (no swallowed errors)", () => {
    expect(source).toContain("return hal_i2c_read(dev->i2c_addr, reg, value, 1);");
    expect(source).toContain("return hal_i2c_write(dev->i2c_addr, reg, &value, 1);");
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

describe("generatePortableDriver — command_set (SHT3x golden)", () => {
  const art = generatePortableDriver(commandDatasheet());
  const header = art.files.find((f) => f.path === "sht3x.h")!.content;
  const source = art.files.find((f) => f.path === "sht3x.c")!.content;

  it("emits command code + CRC constants", () => {
    expect(header).toContain("#define SHT3X_CMD_SOFT_RESET 0x30A2");
    expect(header).toContain("#define SHT3X_CMD_READ_OUT_OF_STATUS_REGISTER 0xF32D");
    expect(header).toContain("#define SHT3X_CRC_POLY 0x31");
    expect(header).toContain("#define SHT3X_CRC_INIT 0xFF");
  });

  it("emits a wire-correct send_command and a CRC stub behind TODO", () => {
    expect(header).toContain("int sht3x_send_command(sht3x_t *dev, uint16_t command);");
    expect(source).toContain("hal_i2c_write(dev->i2c_addr, msb, &lsb, 1);");
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
