# Changelog

All notable changes to Driverge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries are grouped by the commit area vocabulary from
[CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

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

[Unreleased]: https://github.com/MehmetTopuz/driverge-mcp/commits/main
