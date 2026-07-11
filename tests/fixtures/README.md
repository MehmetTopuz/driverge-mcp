# Test fixtures

Datasheet PDFs used by the parser tests live here **locally only** — they are
copyrighted vendor documents and are git-ignored (`*.pdf`), so they never enter
the repo or the npm tarball.

To run the datasheet-driven tests, drop the PDFs here with these names:

| File | Device | Source |
| --- | --- | --- |
| `bst-bme280-ds002.pdf` | Bosch BME280 (register sensor, I2C/SPI) | Bosch Sensortec datasheet |
| `sht3x-datasheet.pdf` | Sensirion SHT3x (command-set device) | Sensirion datasheet |
| `mcp23017-datasheet.pdf` | Microchip MCP23017 (I/O expander) | Microchip datasheet |
| `tmag5170-q1.pdf` | TI TMAG5170 (3D Hall-effect sensor) | Texas Instruments datasheet |
| `AEAT-8811-Q24_DS.pdf` | Broadcom AEAT-8811 (magnetic encoder) | Broadcom datasheet |
| `infineon-tle5014sp16d-e0002-datasheet-en.pdf` | Infineon TLE5014 (angle sensor) | Infineon datasheet |
| `5193_DHT20.pdf` | Aosong DHT20 (humidity/temp sensor) | Aosong datasheet |
| `lsm6dsrx.pdf` | ST LSM6DSRX (IMU) | STMicroelectronics datasheet |
| `vl53l3cx.pdf` | ST VL53L3CX (ToF sensor) | STMicroelectronics datasheet |
| `adxl345.pdf` | Analog Devices ADXL345 (accelerometer) | Analog Devices datasheet (SparkFun mirror) |
| `pca9685.pdf` | NXP PCA9685 (PWM/LED controller) | NXP datasheet (Adafruit mirror) |
| `mlx90614.pdf` | Melexis MLX90614 (IR temperature sensor) | Melexis datasheet (melexis.com) |
| `max30102.pdf` | Maxim MAX30102 (pulse oximeter/heart-rate sensor) | Analog Devices/Maxim datasheet (MikroE mirror) |
| `mpu9250.pdf` | InvenSense/TDK MPU-9250 (9-axis IMU, I2C/SPI) | InvenSense Product Specification PS-MPU-9250A-01 |
| `tca6408a-q1.pdf` | TI TCA6408A-Q1 (I2C GPIO expander) | Texas Instruments datasheet (SCPS234A) — field-test fixture for the TI decimal/hex address idiom and the "Command Byte" register-table shape |
| `fxl6408.pdf` | onsemi FXL6408 (I2C GPIO expander) | onsemi datasheet (FXL6408-D) — field-test fixture for the onsemi Table 9 register layout (non-sequential addresses 0x01–0x13, verbatim "XXXXXXXX" reset cells); see `raw/stm32-test-results/FXL6408-report.md`. Golden: `fxl6408.golden.json` / `tests/pdf/fxl6408-golden.test.ts` (Unit 3, RED — pins 10 registers + the new onsemi manufacturer signal; a dedicated `src/pdf/onsemi-register-table.ts` extractor is expected to turn it GREEN) |
| `cap1206.pdf` | Microchip CAP1206 (I2C capacitive touch, 6-channel) | Microchip datasheet (DS00001567B) — field-test fixture for the Microchip long-summary register table (Table 5-1: Address/Register/R-W/Default, no bit-field column) and the `<slug>_hal_*` per-driver seam-prefixing regression (this was the SECOND I2C driver in the same firmware image — see `raw/stm32-test-results/CAP1206-report.md` §6). Golden: `cap1206.golden.json` / `tests/pdf/cap1206-golden.test.ts` (Unit 3, RED — pins the full 55-register set spanning Table 5-1's 3 continuation pages, superseding today's 4/55) |
| `tuss4470.pdf` | TI TUSS4470 (SPI ultrasonic transducer driver/AFE) | Texas Instruments datasheet (SLDS251A) — field-test fixture for the full-duplex SPI seam contract (`hal_spi_transfer(tx, rx, len)`, single CS-framed `HAL_SPI_TransmitReceive` window) and the missing seam companion header; see `raw/stm32-test-results/TUSS4470_DRIVERGE_RAPORU.md` §5–6. Golden: `tuss4470.golden.json` / `tests/pdf/tuss4470-golden.test.ts` (Unit 3, RED — pins the 13 REG_USER register names with the 3 glued-description names cleaned up; see also the widened `tests/pdf/ti-register-map.test.ts`) |

Tests that need a fixture skip themselves when the file is absent, so the suite
stays green on a fresh clone. The pure unit tests and the synthetic-PDF
integration tests (built with `pdf-lib`) need no fixtures at all.
