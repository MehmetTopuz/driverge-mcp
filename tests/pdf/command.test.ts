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
