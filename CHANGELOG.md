# Changelog

All notable changes to Driverge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries are grouped by the commit area vocabulary from
[CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

### Added

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
