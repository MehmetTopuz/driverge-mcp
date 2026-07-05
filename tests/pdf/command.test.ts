import { describe, expect, it } from "vitest";
import { extractCommands, extractCrc, extractProtocol } from "../../src/pdf/command";

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

const SYNTH = page(
  "The sensor communicates over I2C. The I2C address is 0x44 (default) or 0x45. " +
    "Checksum: Polynomial 0x31 (x 8 + x 5 + x 4 + 1) Initialization 0xFF Reflect input False. " +
    "Command Hex Code Soft Reset 0x30A2 Table 14 describes the soft reset. " +
    "Command Hex Code Break 0x3093 Table 13 stops periodic mode. " +
    "e.g. 0x2C06: high repeatability measurement with clock stretching enabled. " +
    "The general call address 0x0006 resets all devices. " +
    "CRC (0xBEEF) = 0x92 is only a checksum example.",
);

describe("extractProtocol", () => {
  it("detects the I2C bus and device addresses", () => {
    const p = extractProtocol([SYNTH]);
    expect(p.bus).toBe("I2C");
    expect(p.addresses).toEqual(["0x44", "0x45"]);
  });

  it("reports SPI (incl. Infineon SSC) and emits NO addresses on an SPI part", () => {
    // "register address 0x10" would be a false I2C address if not gated on bus.
    const p = extractProtocol([
      page("The device uses an SSC serial interface. Register address 0x10 holds config."),
    ]);
    expect(p.bus).toBe("SPI");
    expect(p.addresses).toBeUndefined();
  });

  // Phase A (evidenced quality fix): pdfjs splits the "I²C" superscript into
  // separate tokens, so a page's normalized text reads "I 2 C" instead of
  // "I2C"/"I²C". The bus regex must tolerate a single optional space between
  // I/2/C, and address extraction (gated on bus === "I2C") must fire the same
  // way it does for the plain-text form. Real case: dual-variant sheets like
  // MCP23017 (I2C) / MCP23S17 (SPI) render the I2C variant's mark this way.
  it("detects a token-split 'I 2 C' bus (pdfjs superscript split) and gates address extraction the same way", () => {
    const p = extractProtocol([
      page("The I 2 C interface supports fast mode. The I 2 C address is 0x20 by default."),
    ]);
    expect(p.bus).toBe("I2C");
    expect(p.addresses).toEqual(["0x20"]);
  });

  // The MCP23017/MCP23S17 dual-variant scenario: the same sheet documents both
  // the I2C part (rendered token-split) and the SPI part. I2C must win — this
  // is the actual scorecard bug (bus reported as SPI for an I2C part).
  it("prefers I2C when a token-split 'I 2 C' AND a plain 'SPI' both appear on the sheet (MCP23017/MCP23S17 scenario)", () => {
    const p = extractProtocol([
      page(
        "This family is offered in two interface variants: the MCP23017 with an I 2 C interface, " +
          "and the MCP23S17 with an SPI interface.",
      ),
    ]);
    expect(p.bus).toBe("I2C");
  });

  // Negative guard: the token-split regex must stay anchored with a trailing
  // word boundary on C, or it will overmatch text like "I 2 CHANNELS" (C is
  // immediately followed by more letters, not a word boundary). No other bus
  // keyword appears here, so a correct implementation reports "unknown".
  it("does not false-positive on 'I 2 CHANNELS' — C directly followed by letters is not a word boundary", () => {
    const p = extractProtocol([
      page("See APPENDIX I 2 CHANNELS for the full pin list of this device."),
    ]);
    expect(p.bus).toBe("unknown");
  });

  // Regression pins for the literal (non-split) forms the token-split fix must
  // not disturb: plain "I2C", unicode "I²C", plain "SPI", and Infineon "SPC".
  it("still detects bus from plain 'I2C', unicode 'I²C', plain 'SPI', and Infineon 'SPC' (regression pins)", () => {
    expect(extractProtocol([page("Uses I2C for communication.")]).bus).toBe("I2C");
    expect(extractProtocol([page("The 7-bit I²C device address is 0x38.")]).bus).toBe("I2C");
    expect(extractProtocol([page("The device communicates via SPI only.")]).bus).toBe("SPI");
    expect(extractProtocol([page("Sensor uses an SPC synchronous serial interface.")]).bus).toBe(
      "SPI",
    );
  });

  // Session 11 Phase C — cross-vendor scorecard evidence: mlx90614.pdf reports
  // bus "unknown" because its sheet describes the interface as "SMBus" and
  // never spells out "I2C" (MLX90614 is an I2C-compatible SMBus device), so
  // codegen would otherwise emit the wrong HAL seam for it. SMBus is a
  // superset-compatible protocol of I2C, so it must be classified as "I2C".
  it("classifies a lone SMBus mention (no other bus keyword) as I2C (MLX90614 scenario)", () => {
    const p = extractProtocol([
      page("The device communicates using the SMBus protocol for register access."),
    ]);
    expect(p.bus).toBe("I2C");
  });

  it("prefers I2C when SMBus AND a plain 'SPI' both appear on the sheet (same precedence as I2C itself)", () => {
    const p = extractProtocol([
      page(
        "This device supports both SMBus and SPI interface modes; SMBus is the default and " +
          "SPI is optional for high-speed applications.",
      ),
    ]);
    expect(p.bus).toBe("I2C");
  });

  it("gates address extraction on SMBus sheets the same way it does for I2C (MLX90614's 0x5A default address)", () => {
    const p = extractProtocol([
      page("The device communicates over SMBus. The SMBus address is 0x5A by default."),
    ]);
    expect(p.bus).toBe("I2C");
    expect(p.addresses).toEqual(["0x5A"]);
  });

  // Session B — UART bus family. The UART tier sits AFTER the I2C and SPI tiers,
  // so a sheet documenting multiple interface variants still resolves I2C/SPI
  // first (see the precedence guards below). MH-Z19-style CO2 sensors and
  // PMS5003-style particulate sensors are plain "UART"/TTL-serial parts with no
  // universal register-access primitive — see decisions: thin-hal-non-negotiable.
  it("detects the UART bus from a plain 'UART' mention (MH-Z19-style CO2 sensor)", () => {
    const p = extractProtocol([
      page("The sensor outputs data via UART (TTL level) at 9600 baud, 8-N-1."),
    ]);
    expect(p.bus).toBe("UART");
  });

  it("detects the UART bus from 'RS-232' and 'RS485' (with/without the hyphen)", () => {
    expect(extractProtocol([page("This module supports RS-232 serial communication.")]).bus).toBe(
      "UART",
    );
    expect(extractProtocol([page("An RS485 interface option is also available.")]).bus).toBe(
      "UART",
    );
  });

  it("detects the UART bus from 'TTL serial' phrasing", () => {
    const p = extractProtocol([
      page("Connect the module using a TTL serial to USB adapter for testing."),
    ]);
    expect(p.bus).toBe("UART");
  });

  it("extracts NO addresses for a UART part — the address gate stays I2C-only", () => {
    const p = extractProtocol([
      page("Communicates over UART. The default address 0x21 is a register offset, not a bus address."),
    ]);
    expect(p.bus).toBe("UART");
    expect(p.addresses).toBeUndefined();
  });

  it("resolves I2C when a page mentions both I2C and UART (I2C tier wins, evaluated first)", () => {
    const p = extractProtocol([
      page("This part supports both I2C and UART interfaces; select the mode via the ADDR pin."),
    ]);
    expect(p.bus).toBe("I2C");
  });

  it("resolves SPI when a page mentions both SPI and UART (SPI tier wins over UART)", () => {
    const p = extractProtocol([
      page("This part supports both SPI and UART interfaces; select the mode via a strap pin."),
    ]);
    expect(p.bus).toBe("SPI");
  });

  // Session C — CAN bus family (first pass). The CAN tier sits AFTER I2C/SPI/UART
  // — a sheet documenting multiple interface variants still resolves those first
  // (see the precedence pins below). "CAN" is both an uppercase bus keyword AND a
  // common English modal verb ("the sensor CAN operate..."), so detection
  // requires strict context: either an explicit "CAN bus"/"CAN 2.0[AB]"/"CAN FD"
  // phrase, or a bare uppercase "CAN" co-occurring with strong CAN vocabulary
  // (arbitration, DLC, "CAN controller", acceptance filter). CAN also has no
  // universal register-access primitive on the wire — like UART, register/config
  // access is device-specific (CANopen SDO, J1939 PGNs, message-ID schemes) — so,
  // like UART, address extraction stays gated on I2C only below.

  it("does NOT resolve CAN from an uppercase 'CAN' modal verb with no CAN-bus context (mandatory false-positive pin)", () => {
    const p = extractProtocol([page("THE SENSOR CAN OPERATE IN LOW POWER MODE.")]);
    expect(p.bus).toBe("unknown");
  });

  it("does NOT resolve CAN from a lowercase 'can' modal verb — I2C still wins (mandatory false-positive pin)", () => {
    const p = extractProtocol([page("The device can be configured over I2C.")]);
    expect(p.bus).toBe("I2C");
  });

  it("resolves I2C when a page mentions both I2C and CAN (I2C tier wins, evaluated first; mandatory pin)", () => {
    const p = extractProtocol([
      page(
        "This part supports both an I2C interface and a CAN bus interface; select the mode via a strap pin.",
      ),
    ]);
    expect(p.bus).toBe("I2C");
  });

  it("resolves UART when a page mentions both UART and CAN (UART tier wins over CAN; mandatory pin)", () => {
    const p = extractProtocol([
      page(
        "This part supports both a UART interface and a CAN bus interface; select the mode via a strap pin.",
      ),
    ]);
    expect(p.bus).toBe("UART");
  });

  it("detects CAN from an explicit 'CAN bus interface' phrase", () => {
    const p = extractProtocol([
      page("The node communicates over a CAN bus interface at up to 1 Mbit/s."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from 'CAN 2.0B compliant controller with acceptance filters'", () => {
    const p = extractProtocol([
      page("This device integrates a CAN 2.0B compliant controller with acceptance filters."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from a bare 'CAN FD' mention", () => {
    const p = extractProtocol([page("The transceiver supports CAN FD for higher throughput.")]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from an uppercase 'CAN' co-occurring with 'arbitration' (no explicit bus/2.0/FD suffix)", () => {
    const p = extractProtocol([
      page("The CAN peripheral resolves arbitration between competing nodes on the network."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from an uppercase 'CAN' co-occurring with 'DLC'", () => {
    const p = extractProtocol([
      page("Each CAN frame's DLC field specifies the number of data bytes, from 0 to 8."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from an uppercase 'CAN' co-occurring with 'acceptance filter'", () => {
    const p = extractProtocol([
      page("Configure the CAN peripheral's acceptance filter to receive only the desired message IDs."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("detects CAN from the 'CAN controller' phrase alone (its own vocabulary co-occurrence)", () => {
    const p = extractProtocol([
      page("This automotive-grade device includes an integrated CAN controller for in-vehicle networking."),
    ]);
    expect(p.bus).toBe("CAN");
  });

  it("does NOT resolve CAN from lowercase 'can' even when 'arbitration' appears nearby (case-sensitivity guard)", () => {
    const p = extractProtocol([
      page("Multiple masters can share the bus; arbitration between them is handled by the protocol."),
    ]);
    expect(p.bus).toBe("unknown");
  });

  it("extracts NO addresses for a CAN part — the address gate stays I2C-only", () => {
    const p = extractProtocol([
      page(
        "Communicates over a CAN bus interface. The default address 0x21 is a register offset, not a bus address.",
      ),
    ]);
    expect(p.bus).toBe("CAN");
    expect(p.addresses).toBeUndefined();
  });

  it("still resolves unknown for plain unrelated text with no bus keyword at all", () => {
    const p = extractProtocol([page("This appendix lists mechanical dimensions and pinout only.")]);
    expect(p.bus).toBe("unknown");
  });
});

describe("extractCrc", () => {
  it("parses the CRC-8 parameters", () => {
    expect(extractCrc([SYNTH])).toEqual({ poly: "0x31", init: "0xFF", width: 8 });
  });

  // Phase 4b generalization: DHT20/Aosong spells the same CRC-8 params as
  // "the initial value of CRC is 0XFF" (not "Initialization 0xNN") and the
  // polynomial as a superscript expression "1+X 4 +X 5 +X 8" (as pdfjs
  // extracts x^8 + x^5 + x^4 + 1), rather than an explicit "Polynomial 0xNN".
  // Dropping the implicit leading x^8 and setting bits {5,4,0} yields 0x31 —
  // the SAME truncated poly SHT3x already reports.
  it("parses the DHT20-style prose CRC (initial-value phrasing + polynomial expression)", () => {
    const text =
      "The measurement returns six bytes then a CRC byte. The initial value of CRC is 0XFF, " +
      "and the CRC8 check polynomial is: CRC [7:0] = 1+X 4 +X 5 +X 8. Then compute values.";
    expect(extractCrc([page(text)])).toEqual({ poly: "0x31", init: "0xFF", width: 8 });
  });

  // Isolates the polynomial-expression parsing from the init-phrasing: this
  // page's ONLY poly signal is the expression form (no explicit
  // "polynomial 0xNN" anywhere), so a pass that only special-cases the
  // explicit hex form would fail here.
  it("parses a bare polynomial-expression with no explicit-hex poly form present", () => {
    const text = "Polynomial is: G(x) = 1+X 4 +X 5 +X 8. Initialization 0xFF.";
    expect(extractCrc([page(text)])).toEqual({ poly: "0x31", init: "0xFF", width: 8 });
  });
});

describe("extractCommands", () => {
  const cmds = extractCommands([SYNTH]);
  const byCode = Object.fromEntries(cmds.map((c) => [c.code, c]));

  it("extracts standalone commands with normalized names and uppercased codes", () => {
    expect(byCode["0x30A2"]?.name).toBe("soft_reset");
    expect(byCode["0x3093"]?.name).toBe("break");
  });

  it("extracts a measurement command from the e.g. example and attaches CRC", () => {
    expect(byCode["0x2C06"]).toBeDefined();
    expect(byCode["0x2C06"]?.crc).toEqual({ poly: "0x31", init: "0xFF", width: 8 });
  });

  it("does not treat the CRC example value as a command", () => {
    expect(byCode["0xBEEF"]).toBeUndefined();
  });
});
