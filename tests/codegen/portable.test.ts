import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import type { DatasheetJson } from "../../src/schema/types";
import { commandDatasheet, registerDatasheet, spiRegisterDatasheet } from "./helpers";

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
      "void hal_spi_transfer(const uint8_t *tx, uint16_t tx_len, uint8_t *rx, uint16_t rx_len);",
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
      "void hal_spi_transfer(const uint8_t *tx, uint16_t tx_len, uint8_t *rx, uint16_t rx_len);",
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
    expect(header).toContain("void hal_i2c_write(uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);");
    expect(header).toContain("void hal_i2c_read (uint8_t addr, uint8_t reg, uint8_t *data, uint16_t len);");
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
    expect(source).toContain("hal_i2c_read(dev->i2c_addr, reg, value, 1);");
    expect(source).not.toMatch(/HAL_I2C_|Wire\.|i2c_master_/);
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
