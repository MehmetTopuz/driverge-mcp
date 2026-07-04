import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import type { DatasheetJson } from "../../src/schema/types";
import { commandDatasheet, registerDatasheet } from "./helpers";

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
