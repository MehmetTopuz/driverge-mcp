import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";

// Hand-verified L0 contract for the TCA6408A-Q1 (Texas Instruments) I2C GPIO
// expander — the field-test fixture (SCPS234A, 41 pages) that exposed two
// extraction gaps against the published server, both reproduced here against
// current src with the real PDF:
//
//   1. extractI2cAddresses doesn't understand TI's "NN (decimal), NN
//      (hexadecimal)" idiom (Table 8-3 "Address Reference", page 24), so
//      protocol.addresses is undefined today — see the new cases in
//      tests/pdf/command.test.ts.
//   2. No adapter recognizes TI's "Command Byte" register-table shape (Table
//      8-4, also page 24: 8 per-bit columns + a "(HEX)"-labeled command byte
//      + REGISTER + PROTOCOL + POWER-UP DEFAULT columns), so
//      interface.registers is empty today — see the new
//      src/pdf/ti-command-byte.ts adapter pinned by
//      tests/pdf/ti-command-byte.test.ts, chained into assembleDatasheet's
//      buildInterface after findTiRegisterMap.
//
// Skips on a fresh clone/machine that lacks the (git-ignored, like every other
// fixture PDF here — see tests/fixtures/README.md) local fixture file.
const FIXTURE = fileURLToPath(new URL("../fixtures/tca6408a-q1.pdf", import.meta.url));

// Table 8-4's 4 registers: address-only (no per-bit field breakdown — the
// Command Byte table documents which *register* a command byte selects, not
// that register's own bit layout), verbatim reset cells. "xxxx xxxx" is TI's
// don't-care/indeterminate-at-power-up idiom for the Input Port (it mirrors
// live pin state) and is NOT normalizable to a single hex byte, unlike the
// other three rows' concrete "1111 1111"/"0000 0000" patterns.
const EXPECTED_REGISTERS = [
  { name: "Input Port", address: "0x00", reset: "xxxx xxxx", bitFields: [] },
  { name: "Output Port", address: "0x01", reset: "0xFF", bitFields: [] },
  { name: "Polarity Inversion", address: "0x02", reset: "0x00", bitFields: [] },
  { name: "Configuration", address: "0x03", reset: "0xFF", bitFields: [] },
];

describe.skipIf(!existsSync(FIXTURE))(
  "TCA6408A-Q1 golden (TI address idiom + Command Byte table)",
  () => {
    it("detects part and manufacturer (already correct today — pinned alongside the two gaps below)", async () => {
      const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
      expect(json.metadata.part).toBe("TCA6408A");
      expect(json.metadata.manufacturer).toBe("Texas Instruments");
    });

    // FAILS today: extractI2cAddresses's hex/binary passes find nothing in
    // "L 32 (decimal), 20 (hexadecimal) H 33 (decimal), 21 (hexadecimal)", so
    // protocol.addresses is currently undefined. Text order is the L row
    // first, so 0x20 (not 0x21) must be the primary address[0].
    it("extracts both I2C target addresses from TI's decimal/hex address-reference idiom (Table 8-3)", async () => {
      const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
      expect(json.protocol.bus).toBe("I2C");
      expect(json.protocol.addresses).toEqual(["0x20", "0x21"]);
    });

    // FAILS today: interface.registers is [] because no adapter matches the
    // Command Byte table's shape.
    it("parses the Command Byte table (Table 8-4, page 24) into 4 address-only registers, in table order", async () => {
      const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
      expect(json.interface.kind).toBe("register_map");
      if (json.interface.kind !== "register_map") {
        throw new Error("expected register_map interface");
      }
      expect(json.interface.registers).toEqual(EXPECTED_REGISTERS);
    });

    // FAILS today: with registers still empty, deriveExtraction reports
    // "deferred" (register section detected, not auto-extracted). Once the
    // Command Byte table is parsed, 4 address-only registers with no bit
    // fields is exactly the "partial" case (registers present, incomplete).
    it("reports partial extraction (registers found, no bit fields) with page 24 among the detected pages", async () => {
      const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
      expect(json.extraction?.status).toBe("partial");
      expect(json.extraction?.detectedPages).toContain(24);
    });
  },
);
