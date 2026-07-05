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

Tests that need a fixture skip themselves when the file is absent, so the suite
stays green on a fresh clone. The pure unit tests and the synthetic-PDF
integration tests (built with `pdf-lib`) need no fixtures at all.
