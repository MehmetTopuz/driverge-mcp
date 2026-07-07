# Changelog

All notable changes to Driverge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries are grouped by the commit area vocabulary from
[CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

Fixes surfaced by an end-to-end field test against the MPU-9250 Product
Specification (see the field report in `raw/DRIVERGE_ISSUES.md`).

### Breaking

- **Codegen:** the register-access thin-HAL seams now return `int` (**`0` on
  success, non-zero on a bus error**) instead of `void` — `hal_i2c_write`,
  `hal_i2c_read`, and `hal_spi_transfer` — and the generated
  `<part>_read_register`/`_write_register` (and command `send_command`)
  **propagate** that status instead of unconditionally returning `0`. A NACK or
  timeout now reaches the caller rather than being silently swallowed (the
  field test's garbage-read on a floating bus). Hand-written seam
  implementations must be updated to return a status; the native ESP32
  (`esp_err_t`) and STM32 (`HAL_OK`-mapped) seams do this already.

### Fixed

- **Parser:** I2C device-address extraction now recognizes **binary-notation**
  addresses (`b110100X`, `0b1101000`, `1101000b`) and **ranks the primary
  device address first**. The MPU-9250 writes its primary address only in binary
  (0x68/0x69) and a hex sub-address (0x0C) for the on-board AK8963 magnetometer,
  so the old hex-only scan grabbed the wrong one and hardcoded it into the
  driver; `protocol.addresses[0]` is now the real device address.
- **Parser:** part-number patterns for the InvenSense/TDK **MPU** and **ICM**
  families — "MPU-9250" (and MPU6050/ICM-20948/…) previously extracted an empty
  `metadata.part`.
- **Validation:** the "register map is partial — addresses without bit-field
  detail" warning is now **content-based** (fires only when no register carries
  any bit field) instead of keyed on `extraction.status`, removing a false
  positive on a host-completed map that already has bit fields.

### Added

- **MCP Server:** `validate_datasheet` called with **both** `ref` and `json`
  now **persists** the completed datasheet under that `ref` (overwriting the
  cached entry) and returns its fresh validation — closing the
  "deferred → host completes the map → generate" loop so the next
  `generate_driver(ref)` renders the real registers instead of a TODO stub.
- **Tests:** an MPU-9250 product-spec regression fixture/golden pinning the
  part number, primary-address ranking, and the expected register-map deferral.

### Docs

- **README:** the thin-HAL seam return contract (int, 0 = success), the
  deferred-datasheet completion loop via `validate_datasheet(ref, json)`, and
  Windows/`npx`/`.mcp.json` installation notes.

## [0.0.1] - 2026-07-07

Interim test release — publishes the current `main` to npm so it can be installed
via `npx driverge-mcp` for early hands-on testing, ahead of the official v0.1.0
launch. Contents = the accumulated changes below.

### Breaking

- **Codegen:** the SPI thin-HAL seam is now a single combined
  `hal_spi_transfer(tx, tx_len, rx, rx_len)` call (one call = one CS-framed
  transaction), replacing the `hal_spi_write`/`hal_spi_read` pair whose split
  register-reads could not hold CS across vendor transactions. Existing SPI
  seam implementations must be ported; `validate_driver` now rejects the
  retired pair.

### Security

- **MCP Server:** `generate_driver`'s `out_dir` is now confined under
  `DRIVERGE_OUT_ROOT` (default: the server's own cwd), rejecting any resolved
  path that escapes the allowed root.
- **Validation:** `validate_datasheet` guards against structurally invalid
  input up front, replacing crashes/unhandled exceptions with a clean
  "invalid datasheet JSON" error.
- **MCP Server:** fixed a TOCTOU race in `analyze_datasheet`'s file handling.
- **MCP Server:** the datasheet cache is now a bounded LRU (32 entries),
  preventing unbounded memory growth across repeated `analyze_datasheet` calls.
- Note: `pdfjs-dist` ≥ 6 removed the eval glyph code path upstream, so no
  `isEvalSupported` flag is needed to mitigate it here.

### Fixed

- **Codegen:** the `esp32` and `stm32` targets now refuse SPI parts with a
  clear `UnsupportedBusError` instead of silently emitting an uncompilable
  I2C-only seam.
- **Validation:** `validate_driver`'s brace/paren balance check no longer
  miscounts braces and parens that appear inside C string and char literals.
- **Parser:** bus detection tolerates pdfjs splitting the I²C superscript into
  separate tokens ("I 2 C"), so dual-variant sheets (MCP23017/MCP23S17) no
  longer misclassify as SPI and generate the wrong HAL seam.

### Changed

- **MCP Server:** `analyze_datasheet` now honors `manufacturer_hint` and
  `interface_kind_hint`, folding them into the cache ref so hinted and
  unhinted analyses of the same PDF don't collide.
- **MCP Server:** `validate_driver` no longer advertises an unused `target`
  input.
- **MCP Server:** the server now reports its version by reading
  `package.json` instead of a hardcoded string.
- **Parser:** `extractPages` now computes `hasImage` lazily, only walking a
  page's operator list when its text is sparse (below `MIN_TEXT_CHARS`) —
  the only case the classifier consults it for.

### Added

- **Codegen:** native SPI on the ESP32 (ESP-IDF `spi_master`, hardware CS) and
  STM32 (CubeHAL `HAL_SPI_*` + GPIO-framed CS) targets.
- **Parser + Codegen:** the UART bus family — a UART detection tier
  (UART/RS-232/RS-485/TTL-serial keywords, after I2C/SPI), a
  `hal_uart_write`/`hal_uart_read` seam, native ESP-IDF and CubeHAL UART seam
  implementations, and `framing_todo`: device-specific frame protocols are
  marked reasoning gaps for the host AI rather than guessed.
- **Schema + Parser + Codegen:** the CAN bus family — `"CAN"` joins the bus
  enum, strict two-factor CAN detection (explicit "CAN bus/2.0/FD" phrase, or
  uppercase CAN plus arbitration/DLC/controller/filter vocabulary), a
  `hal_can_transfer` seam, and a native ESP32 TWAI seam. STM32 CAN is deferred
  (bxCAN/FDCAN split).
- **Codegen + MCP Server:** `generate_driver` accepts `language: "c" | "cpp"`
  (default `"c"`, byte-identical to before). The C++ flavor renders a
  class-based `.hpp`/`.cpp` driver that keeps the same `#define` register
  constants and the same `extern "C"` thin-HAL seam, so native seam files and
  `validate_driver` work unchanged.
- **Parser:** a Maxim register-matrix adapter (`REGISTER | B7..B0 | REG ADDR |
  POR STATE` recap tables, e.g. MAX30102: 20 registers, 33 bit fields),
  handling multi-section pages, wrapped labels, and split two-line titles.
- **Parser:** vendor rules for Analog Devices, Maxim Integrated, and Melexis;
  part patterns for the ADXL/MAX/MLX and ST VL53 families; SMBus datasheets
  (e.g. MLX90614) now classify as I2C, matching the generated `hal_i2c_*` seam.
- **Tests:** four cross-vendor scorecard fixtures (ADXL345, PCA9685, MLX90614,
  MAX30102) with behavior goldens for the generic-extractor outputs.
- **Parser (L1–L5):** PDF type detection, keyword page map, manufacturer +
  interface-kind detection, register-table extraction (BME280 Bosch + MCP23017
  Microchip layouts), scoped command-set + protocol/CRC extraction (SHT3x
  Sensirion), and a datasheet validator over a frozen JSON-Schema contract.
- **MCP surface:** `analyze_datasheet`, `generate_driver`, `validate_driver`,
  `validate_datasheet` tools; `driverge://datasheet/<ref>` + `driverge://schema`
  resources; the `generate-driver` prompt; a content-stable `ref` cache.
- **Codegen:** deterministic portable thin-HAL driver skeletons (register-map and
  command-set) with `TODO(driverge)` markers and a `fill_in_brief`; native ESP32
  (ESP-IDF) and STM32 (CubeHAL) targets that pre-fill the seam.
- **CI:** GitHub Actions running lint, typecheck, tests, and build across
  Linux/macOS/Windows on Node 20 & 22.
- Project docs: full README, `SECURITY.md`, `CODE_OF_CONDUCT.md`, ESLint config.

[Unreleased]: https://github.com/MehmetTopuz/driverge-mcp/compare/v0.0.1...main
[0.0.1]: https://github.com/MehmetTopuz/driverge-mcp/releases/tag/v0.0.1
