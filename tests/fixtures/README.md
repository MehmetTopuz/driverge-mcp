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

Tests that need a fixture skip themselves when the file is absent, so the suite
stays green on a fresh clone. The pure unit tests and the synthetic-PDF
integration tests (built with `pdf-lib`) need no fixtures at all.
