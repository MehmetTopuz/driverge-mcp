<p align="center">
  <img src="assets/Driverge-lockup.svg" alt="Driverge" width="360">
</p>
<p align="center"><em>Datasheet PDF → embedded C/C++ driver, from any MCP client.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/driverge-mcp"><img alt="npm" src="https://img.shields.io/npm/v/driverge-mcp"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="status" src="https://img.shields.io/badge/status-pre--release-orange">
  <img alt="mcp" src="https://img.shields.io/badge/MCP-server-black">
</p>

> 🚧 **Early pre-release** — [`driverge-mcp`](https://www.npmjs.com/package/driverge-mcp)
> is on npm, so the `npx driverge-mcp` install below works today. APIs and the
> JSON schema may still change before v0.1.0; expect rough edges.

---

## What is Driverge?

**Driverge is a client-agnostic [MCP](https://modelcontextprotocol.io) server**
that turns an IC datasheet PDF into an embedded C/C++ driver. It plugs into any
MCP-capable host — Claude Desktop, Claude Code (VS Code), Cursor, and others.

Its guiding principle: **deterministic code parses and validates; the host AI
reasons.** Driverge itself contains **no internal LLM and needs no API keys** — a
TypeScript pipeline extracts a *validated, structured JSON* model of the chip, and
the host AI you're already talking to fills in the reasoning-heavy parts (init
sequence, vendor quirks, docs). Your datasheet never leaves your machine.

## Why Driverge?

Bringing up a new sensor or IC means hand-transcribing dozens of register
addresses, bit-field masks, and command codes out of a 40-page PDF — slow work,
and a classic source of silent bugs (one wrong mask or transposed address and the
driver "works" but reads garbage). Driverge does that mechanical part
deterministically and leaves the reasoning to the AI you already use.

- **No hallucinated register maps.** Addresses, bit-field masks, and command codes
  are *extracted from the datasheet and validated* — not guessed. That's the
  failure mode of "just ask an LLM to write the whole driver"; here, invalid or
  incomplete data is rejected before it ever reaches code generation.
- **Bring your own client — no API keys, no lock-in.** Driverge is a plain MCP
  server with no embedded LLM. It runs inside whatever MCP client you already use
  (Claude Desktop, Claude Code, Cursor, …) and reasons with the model you're
  already paying for — no separate subscription or service.
- **Private & offline.** The datasheet is parsed locally and never uploaded — safe
  for NDA'd or unreleased parts.
- **Deterministic & reproducible.** The same PDF always yields the same JSON and
  the same driver skeleton — reviewable, diff-able, and testable, not a one-shot
  black box.
- **Portable by construction.** One driver core targets any platform through a
  five-function thin-HAL seam; the native targets (STM32, ESP32) pre-fill that
  seam for you — switch platforms without touching driver logic.
- **The AI does only what it's good at.** Register geometry is deterministic;
  init-sequence ordering, timing quirks, and compensation math need judgment.
  Driverge marks exactly those spots with `TODO(driverge)` and a `fill_in_brief`,
  the host AI completes them, then `validate_driver` checks the result.

**Good for:** quickly evaluating a new sensor, prototyping, porting an existing
driver to a different MCU, or just learning an unfamiliar chip's register map.

## What it does

1. **Analyze** a datasheet PDF → detect format, manufacturer, and interface kind
   (register-map vs. command-set), then extract registers / bit-fields (or
   commands + CRC) and the bus protocol into a **frozen JSON contract**, gated by
   a validator.
2. **Generate** a driver for a target platform: a deterministic **thin-HAL
   skeleton** — register/bit-field constants, the five-function thin-HAL seam,
   function stubs — with every reasoning gap marked `TODO(driverge)` plus a `fill_in_brief`
   telling the host AI exactly what to complete.
3. **Validate** the completed driver: thin-HAL purity, no leftover TODOs, register
   references exist, bit-field masks match the JSON.

### Supported targets

Every target specializes the same portable **[thin-HAL](https://en.wikipedia.org/wiki/Hardware_abstraction_layer)**
seam — the driver core is identical across platforms; only the seam implementation
changes.

| Target | Bus binding | Language | Status |
|---|---|---|---|
| **Portable (thin-HAL)** | user-implemented `hal_i2c_*` / `hal_spi_*` / `hal_delay_ms` | C | ✅ |
| **ESP32** | ESP-IDF `i2c_master_*` | C | ✅ |
| **STM32** | CubeHAL `HAL_I2C_Mem_Read/Write` | C | ✅ |
| **Arduino** | `Wire` / `SPI` | C++ | planned |

> ⚠️ **Generated code is a strong draft, not a certified driver.** Init sequences,
> compensation formulas, and timing quirks are completed by the host AI and
> **must be reviewed** before use on hardware. Not safety-certified.

## Concepts behind Driverge

Driverge splits driver-writing into two kinds of work: the **mechanical part**
(register addresses, masks, command tables — extracted and checked by
deterministic code) and the **judgment part** (init ordering, timing quirks,
compensation math — completed by the host AI). Everything below exists to keep
that boundary sharp.

```mermaid
flowchart LR
  PDF["Datasheet PDF"]
  subgraph D["Driverge — deterministic, no LLM"]
    A["analyze_datasheet<br>L1–L5 parse + validate"]
    J[("frozen JSON<br>cached under a ref")]
    G["generate_driver<br>thin-HAL skeleton +<br>TODO(driverge) markers"]
    V["validate_driver<br>static lint"]
  end
  subgraph H["Host AI — reasoning"]
    F["fill the TODOs: init sequence,<br>quirks, compensation docs"]
  end
  OUT["driver.c / driver.h"]
  PDF --> A --> J --> G --> F --> V
  V -->|pass| OUT
  V -->|fail| F
```

### Deterministic core, reasoning at the edge

Register geometry is mechanical: an address is right or wrong, a mask either
matches the datasheet or it doesn't. Driverge handles that part with plain
TypeScript — no internal LLM, no API keys, no sampling — so the output is the
same on every run. What genuinely needs judgment (in what order to poke the
registers, which timing quirk applies, how to document a compensation formula)
is left to the host AI you're already talking to.

### The frozen JSON contract

`analyze_datasheet` runs a five-stage pipeline (L1–L5): detect the PDF type,
map keyword pages, identify the manufacturer and interface kind, extract the
register table (or command set + CRC), and validate the result against a frozen
draft-07 [JSON-Schema contract](schemas/datasheet.schema.json) — also exposed
as the `driverge://schema` resource. Anything that fails validation is rejected
*before* code generation, so a bad extraction can never silently become a bad
driver.

### The `ref` handle

Parsing a datasheet yields a large JSON document; shuttling it through the chat
context on every call would be slow and lossy. Instead, the parsed model is
cached server-side under a content-stable `ref`, and the tools pass that handle
around. The same `ref` with a different `target` re-renders instantly with no
re-parse, and the full JSON stays readable at `driverge://datasheet/<ref>`.

### The thin-HAL seam

Generated drivers touch hardware through exactly five functions —
`hal_i2c_read` / `hal_i2c_write` (or the SPI pair) plus `hal_delay_ms` — and
nothing else. The driver core is therefore identical across platforms; a native
target (ESP32, STM32) just pre-fills the seam with the vendor calls.
`validate_driver` enforces this purity: a driver that calls a vendor peripheral
API outside the seam fails the lint.

### The fill-in loop

The skeleton marks every reasoning gap with a `TODO(driverge)` comment and
ships a `fill_in_brief` describing what belongs there. The host AI completes
the markers using the datasheet resource, then `validate_driver` statically
checks the result — no leftover TODOs, every register reference real, masks
matching the JSON — and the loop repeats until it passes.

## Installation

**Prerequisites:** Node.js LTS (≥ 18).

Add Driverge to your MCP client (no build step —
[npx](https://docs.npmjs.com/cli/commands/npx) fetches and runs it):

**Claude Desktop** — `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "driverge": { "command": "npx", "args": ["-y", "driverge-mcp"] }
  }
}
```

**Claude Code (VS Code)** — `.mcp.json` in your workspace root:
```json
{
  "mcpServers": {
    "driverge": { "command": "npx", "args": ["-y", "driverge-mcp"] }
  }
}
```

**Cursor** — `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "driverge": { "command": "npx", "args": ["-y", "driverge-mcp"] }
  }
}
```

Other clients (Codex, Gemini CLI, …) take the same `command` + `args` pair in
their own MCP config.

### Run from source (development)

To contribute, or to run the latest unreleased changes:

```bash
git clone https://github.com/MehmetTopuz/driverge-mcp.git
cd driverge-mcp
npm install
npm run build
```

Then point your client at the built entry point:
```json
{
  "mcpServers": {
    "driverge": { "command": "node", "args": ["/absolute/path/to/dist/server.js"] }
  }
}
```

## Usage

Give your MCP client a datasheet and ask it to build a driver. The typical flow:

1. **`analyze_datasheet`** — `{ "pdf_path": "/abs/path/bme280.pdf" }` → returns a
   compact summary and a `ref` handle; the full JSON is available as a resource.
2. **`generate_driver`** — `{ "ref": "…", "target": "portable" }` → returns the
   driver files + a `fill_in_brief`. (`out_dir` also writes them to disk.)
3. The host AI completes the `TODO(driverge)` markers using the brief and the
   `driverge://datasheet/<ref>` resource.
4. **`validate_driver`** — `{ "ref": "…", "files": [...] }` → static checks; loop
   until it passes.

Reusing the same `ref` with a different `target` re-renders with **no re-parse**.

### Worked example — BME280 → portable driver

> "Analyze the datasheet at `C:/ds/bme280.pdf` with driverge, then generate a
> portable driver."

Driverge parses the BME280 memory map (14 registers, bit-fields, I²C address),
validates it, and emits `bme280.h` / `bme280.c` — register `#define`s, bit-field
`MASK`/`SHIFT` macros, the thin-HAL seam, and the
`bme280_init/read_register/write_register` stubs. The host AI then fills the
init sequence and compensation docs from the datasheet prose.

### MCP surface

| Kind | Name | Purpose |
|---|---|---|
| Tool | `analyze_datasheet` | PDF → validated JSON, cached under a `ref` |
| Tool | `generate_driver` | `ref` + `target` → driver skeleton + `fill_in_brief` |
| Tool | `validate_driver` | static-lint a completed driver against its `ref` |
| Tool | `validate_datasheet` | re-run the L5 validator over a `ref` or JSON |
| Tool | `ping` | health check — confirms the server is running |
| Resource | `driverge://datasheet/<ref>` | full parsed JSON for an analyzed datasheet |
| Resource | `driverge://schema` | the frozen datasheet JSON-Schema contract |
| Prompt | `generate-driver` | guided analyze → generate → fill → validate flow |

## Roadmap

- **v0.x** — one reference sensor (BME280), portable thin-HAL core, MCP surface,
  multiple clients. ✅
- **v0.y** — native targets: ESP32 ✅, STM32 ✅, Arduino (next). *(current)*
- **v1.0** — multi-manufacturer coverage and a stable, versioned JSON schema.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, the commit convention, and
the test-driven workflow. Issues and PRs welcome.

## Security & disclaimer

Generated drivers are drafts intended for human review, not certified firmware —
see [SECURITY.md](SECURITY.md). Driverge runs locally and does not transmit your
datasheets.

## License

[MIT](LICENSE) © Mehmet Topuz
