import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { detectPart } from "../../src/pdf/part";

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

describe("detectPart", () => {
  it("picks the most frequent vendor part token", () => {
    expect(detectPart([page("TMAG5170-Q1 device. The TMAG5170 is a Hall sensor. TMAG5170")])).toBe("TMAG5170");
    expect(detectPart([page("DHT20 temperature and humidity sensor. DHT20 module.")])).toBe("DHT20");
    expect(detectPart([page("AEAT-8811-Q24 magnetic encoder")])).toBe("AEAT-8811");
    expect(detectPart([page("Infineon TLE5014SP16D angle sensor")])).toBe("TLE5014SP16D");
  });

  it("returns empty when no known part token is present", () => {
    expect(detectPart([page("A generic widget with no recognizable part number")])).toBe("");
  });

  // Phase A (evidenced quality fix): the scorecard shows part "—" for
  // vl53l3cx.pdf — PART_PATTERNS has no entry for ST's VL53 ToF family, so
  // detectPart falls back to "" and the slug falls back to "device".
  it("detects the ST VL53 ToF family (VL53L3CX, VL53L1X)", () => {
    expect(
      detectPart([
        page(
          "The VL53L3CX is a Time-of-Flight ranging sensor. VL53L3CX is available in a small " +
            "package. VL53L3CX register map follows.",
        ),
      ]),
    ).toBe("VL53L3CX");
    expect(
      detectPart([
        page(
          "The VL53L1X is a Time-of-Flight ranging sensor. VL53L1X is available in a small " +
            "package. VL53L1X register map follows.",
        ),
      ]),
    ).toBe("VL53L1X");
  });

  // Session 11 Phase C — cross-vendor scorecard evidence: adxl345.pdf,
  // max30102.pdf, and mlx90614.pdf all report part "" today because
  // PART_PATTERNS has no entry for the ADXL, MAX, or MLX families.
  it("detects Analog Devices' ADXL family (ADXL345)", () => {
    expect(
      detectPart([
        page(
          "The ADXL345 is a small, thin, low-power, 3-axis accelerometer. ADXL345 has high " +
            "resolution. ADXL345 register map follows.",
        ),
      ]),
    ).toBe("ADXL345");
  });

  it("detects Maxim Integrated's MAX family (MAX30102)", () => {
    expect(
      detectPart([
        page(
          "MAX30102 is an integrated pulse oximetry and heart-rate monitor module. MAX30102 " +
            "operates from 1.8V. MAX30102 combines two LEDs, a photodetector.",
        ),
      ]),
    ).toBe("MAX30102");
  });

  it("detects Melexis' MLX family (MLX90614)", () => {
    expect(
      detectPart([
        page(
          "The MLX90614 is an infrared thermometer for non-contact temperature measurements. " +
            "MLX90614 comes factory calibrated. MLX90614 SMBus compatible interface.",
        ),
      ]),
    ).toBe("MLX90614");
  });

  // MPU-9250 field test (raw/DRIVERGE_ISSUES.md, A3): PART_PATTERNS had no
  // InvenSense/TDK MPU/ICM entry, so "MPU-9250" was never matched and
  // metadata.part came back "". The hyphen in the datasheet's title spelling
  // ("MPU-9250") must be tolerated and preserved in the returned token.
  it("detects the InvenSense/TDK MPU family and keeps the hyphenated spelling (MPU-9250)", () => {
    expect(
      detectPart([
        page(
          "MPU-9250 Product Specification. The MPU-9250 is a 9-axis MotionTracking device. " +
            "MPU-9250 combines a gyroscope, accelerometer, and magnetometer.",
        ),
      ]),
    ).toBe("MPU-9250");
  });

  it("detects the MPU family written without a hyphen (MPU6050)", () => {
    expect(
      detectPart([page("The MPU6050 combines a 3-axis gyroscope and accelerometer. MPU6050 device.")]),
    ).toBe("MPU6050");
  });

  it("detects the InvenSense/TDK ICM family (ICM-20948)", () => {
    expect(
      detectPart([
        page(
          "ICM-20948 is the world's lowest-power 9-axis MEMS MotionTracking device. " +
            "ICM-20948 register map follows.",
        ),
      ]),
    ).toBe("ICM-20948");
  });

  // STM32 field tests (raw/stm32-test-results/, Session E): all three sessions
  // reported metadata.part "" because PART_PATTERNS had no onsemi FXL,
  // Microchip CAP12xx, or TI TUSS entry — the host AI had to fill the part in
  // by hand during the deferred loop.
  it("detects onsemi's FXL family (FXL6408)", () => {
    expect(
      detectPart([
        page(
          "The FXL6408 is a fully configurable 8-bit I2C-controlled GPIO expander. " +
            "FXL6408 offers 400 kHz Fast-mode operation. FXL6408 register map follows.",
        ),
      ]),
    ).toBe("FXL6408");
  });

  it("detects Microchip's CAP12xx touch family (CAP1206)", () => {
    expect(
      detectPart([
        page(
          "CAP1206 6-channel capacitive touch sensor. The CAP1206 contains six " +
            "capacitive touch sensor inputs. CAP1206 SMBus/I2C interface.",
        ),
      ]),
    ).toBe("CAP1206");
  });

  it("detects TI's TUSS ultrasonic family (TUSS4470)", () => {
    expect(
      detectPart([
        page(
          "TUSS4470 direct-drive ultrasonic sensor IC. The TUSS4470 integrates a " +
            "burst generator. TUSS4470 SPI register map follows.",
        ),
      ]),
    ).toBe("TUSS4470");
  });
});

const TMAG = fileURLToPath(new URL("../fixtures/tmag5170-q1.pdf", import.meta.url));

describe.skipIf(!existsSync(TMAG))("detectPart (real TMAG5170)", () => {
  it("extracts TMAG5170 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(TMAG)).pages)).toBe("TMAG5170");
  });
});

// Session E field-test fixtures — same skipIf convention as TMAG above.
const FXL = fileURLToPath(new URL("../fixtures/fxl6408.pdf", import.meta.url));
const CAP = fileURLToPath(new URL("../fixtures/cap1206.pdf", import.meta.url));
const TUSS = fileURLToPath(new URL("../fixtures/tuss4470.pdf", import.meta.url));

describe.skipIf(!existsSync(FXL))("detectPart (real FXL6408)", () => {
  it("extracts FXL6408 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(FXL)).pages)).toBe("FXL6408");
  });
});

describe.skipIf(!existsSync(CAP))("detectPart (real CAP1206)", () => {
  it("extracts CAP1206 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(CAP)).pages)).toBe("CAP1206");
  });
});

describe.skipIf(!existsSync(TUSS))("detectPart (real TUSS4470)", () => {
  it("extracts TUSS4470 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(TUSS)).pages)).toBe("TUSS4470");
  });
});
