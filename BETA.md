# Driverge — Beta Testing Guide

Driverge is in **closed beta**. Thanks for helping shake it out on real parts and
real hardware — that is exactly the evidence the project needs to graduate to a
stable **v0.1.0**.

## What "closed beta" means

- Published to npm under the **`beta`** dist-tag. Install the beta build with:

  ```jsonc
  // .mcp.json / claude_desktop_config.json / .cursor/mcp.json
  { "mcpServers": { "driverge": { "command": "npx", "args": ["-y", "driverge-mcp@beta"] } } }
  ```

  Plain `driverge-mcp` (no `@beta`) resolves the npm `latest` tag, which
  deliberately lags the beta for now.
- **Generated drivers are reviewed drafts, not certified firmware.** Register
  addresses, init sequences, and compensation math must be checked against the
  datasheet before you flash them. Not safety-certified.
- What is and isn't proven yet is spelled out in the README's
  [Maturity & status](README.md#maturity--status) section.

## What ends the beta (graduation gate)

The beta becomes stable **v0.1.0** only when all of these are green — the field
you test contributes directly to them:

- [ ] **L2 native compile** — a generated driver builds clean under ESP-IDF
  (`idf.py build`) **and** STM32CubeIDE.
- [ ] **L3 Tier A** — the identity-register smoke test (below) passes on real
  hardware on **both** ESP32 and STM32, on at least one sensor.
- [ ] **L3 Tier B** — full read + sanity bounds pass on real hardware.
- [ ] **L4** — two different MCP clients produce identical output.
- [ ] No open **sev-1 correctness** bug in the field-report backlog.

## The one test worth running: identity-register smoke test

The single most valuable check: init the part, read its identity register, and
confirm it matches the datasheet. Passing it proves wiring, I²C address,
register-read path, byte order, and the HAL binding are all correct end to end.

| Sensor | Bus | Identity register | Expected | At-rest sanity |
|---|---|---|---|---|
| BME280 | I²C @0x76/0x77 | `0xD0` (id) | `0x60` | T 15–35 °C, P 950–1050 hPa, RH 20–80 % |
| BMP280 | I²C @0x76/0x77 | `0xD0` (id) | `0x58` | T/P only |
| MPU6050 | I²C @0x68/0x69 | `0x75` (WHO_AM_I) | `0x68` | one axis ≈ ±1 g, gyro ≈ 0 |

Typical flow to exercise: `analyze_datasheet` → `generate_driver` (portable, then
your native target) → let the host AI fill the `TODO(driverge)` markers →
`validate_driver` → build → flash → read the identity register.

## Sending a field report

Report **anything** — a wrong extraction, a bad address, a driver that didn't
compile, an install snag, or a clean success. The
[`raw/DRIVERGE_ISSUES.md`](../raw/DRIVERGE_ISSUES.md) MPU-9250 report is the
worked example; copy its shape.

During closed beta, send reports **privately**: email the maintainer
(see `package.json` → `author`), or, if you have repo access, add a new file
under `raw/` (e.g. `raw/DRIVERGE_ISSUES_<part>.md`) — the `raw/` folder is where
field reports live and get folded back into the project.

### Field-report template

```markdown
# Driverge field report — <PART> (<vendor>)

## Environment
| Item | Value |
|---|---|
| driverge-mcp | <version, e.g. 0.1.0-beta.1 (npx -y driverge-mcp@beta)> |
| MCP client | <Claude Code / Desktop / Cursor / …> |
| Node / npx | <versions> |
| OS | <e.g. Windows 11, PowerShell 5.1> |
| Datasheet | <title + page count + source URL> |
| Target / language | <portable | esp32 | stm32> / <c | cpp> |
| Toolchain (if built) | <ESP-IDF vX / CubeIDE vY> |

## Findings
| # | Finding | Category (tool / codegen / parser / install) | Severity |
|---|---|---|---|
| 1 | … | … | low / med / high |

## Per finding
### 1 — <short title>
- **Trigger:** <the exact tool call>
- **Observed:** <output / behavior>
- **Expected:** <what should have happened>
- **Impact / workaround:** <…>

## Extraction result
- counts (registers / bit-fields / commands):
- extraction.status: complete | partial | deferred | none
- part / manufacturer / bus / addresses detected:

## Hardware (if run)
- Compiled clean?  yes / no  (errors: …)
- Flashed?  yes / no
- Identity register read: reg <0x..> → got <0x..>, expected <0x..>
- Sanity values plausible?  yes / no

## What worked well
- …
```

Thanks — every report moves a checkbox on the graduation gate.
