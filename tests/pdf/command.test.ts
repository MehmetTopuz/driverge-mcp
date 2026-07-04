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
