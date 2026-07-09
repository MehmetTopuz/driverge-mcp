// Security fix RED tests (2026-07-09) — define/macro injection via
// unvalidated free-text values spliced verbatim into generated `#define`
// lines. Two value families are affected here (register `r.address` and
// command `c.code` are ALREADY safe via HEX_ONLY in both generators — NOT
// re-tested here):
//
//   1. `protocol.addresses[0]` -> `#define <PREFIX>_I2C_ADDR <value>`
//      (portable.ts registerDriver ~L302 / commandDriver ~L502,
//      portable-cpp.ts registerDriverCpp ~L158 / commandDriverCpp ~L274) —
//      NO hex validation today: the raw string is spliced straight in.
//   2. command `crc.poly` / `crc.init` -> `#define <PREFIX>_CRC_POLY <value>`
//      / `_CRC_INIT <value>` (portable.ts commandDriver ~L536-537,
//      portable-cpp.ts commandDriverCpp ~L303-304) — same problem.
//
// This is a DIFFERENT bug from B2's comment-escape injection
// (tests/codegen/comment-injection.test.ts): there is no comment to escape
// from here. The poisoned value isn't defeating an escaping scheme, it is
// simply trusted outright with no format check at all, so an embedded
// newline in the JSON value lets an attacker-controlled datasheet splice an
// entirely new, live top-level C statement (a bogus #define, or a bare
// declaration) directly into the generated header — a source/macro
// injection, not a comment escape.
//
// Contract pinned here (Layer A — codegen boundary, defense-in-depth, per
// the orchestrator's spec): a non-hex addresses[0] or non-hex
// crc.poly/crc.init must NEVER reach a #define as a live value. A poisoned
// address must degrade to the EXISTING "unknown I2C address" TODO/0x00
// placeholder branch (registerDriver/commandDriver's `else` arm) — not just
// at the live #define, but everywhere the raw address would otherwise be
// echoed (e.g. the AUTOGEN bus-line comment), since the contract requires no
// injected content survive ANYWHERE in generated output. A poisoned crc must
// NOT emit the _CRC_POLY/_CRC_INIT block carrying the raw value (skipping
// the block, or a placeholder, is acceptable — the key invariant is that no
// injected content survives as code).
//
// NOTE: fill_in_brief is JSON prose, not C (crc_todo interpolates crc.poly
// into human-readable text) — like B2, it is deliberately NOT checked here;
// only `art.files` (the rendered file contents) are in scope.

import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import { generatePortableCppDriver } from "../../src/codegen/portable-cpp";
import type { DatasheetJson } from "../../src/schema/types";

// Mirrors the `strip` helper inside src/codegen/lint.ts's lintDriver EXACTLY
// (same four regexes, same order) — copied from
// tests/codegen/comment-injection.test.ts rather than reaching into src/
// (that function is not exported).
function stripCommentsAndLiterals(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ");
}

/** Same helper/shape as comment-injection.test.ts's expectNoLeak: after
 *  stripping every comment/string literal, the poisoned identifier must not
 *  survive as live code in any generated file. */
function expectNoLeak(files: { path: string; content: string }[], poison: RegExp): void {
  for (const f of files) {
    const stripped = stripCommentsAndLiterals(f.content);
    expect(
      stripped,
      `${f.path} let the poisoned identifier survive as live code:\n---\n${f.content}\n---`,
    ).not.toMatch(poison);
  }
}

const POISON_ADDR = "0x76\n#define ADDR_PWNED 1";
const POISON_POLY = "0x00\nint crc_pwned;";

/**
 * register_map datasheet whose ONE bus address is poisoned: non-hex, with an
 * embedded newline that (today) splices a bogus `#define ADDR_PWNED 1` line
 * straight into the header as live code. One register with a bit field so
 * the full emit path (registerConstants + bitFieldMacros) is genuinely
 * exercised, not just the address line.
 */
function registerDatasheetWithPoisonedAddress(): DatasheetJson {
  return {
    metadata: {
      part: "BME280",
      manufacturer: "Bosch Sensortec",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: [POISON_ADDR] },
    interface: {
      kind: "register_map",
      registers: [
        {
          name: "ctrl_meas",
          address: "0xF4",
          reset: "0x00",
          bitFields: [{ name: "mode", msb: 1, lsb: 0 }],
        },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;
}

/**
 * command_set datasheet with one data-returning command (responseWords set)
 * whose crc.poly is poisoned: non-hex, with an embedded newline that (today)
 * splices a bare `int crc_pwned;` global declaration straight into the
 * header as live code.
 */
function commandDatasheetWithPoisonedCrc(): DatasheetJson {
  return {
    metadata: {
      part: "SHT3x",
      manufacturer: "Sensirion",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x44"] },
    interface: {
      kind: "command_set",
      commands: [
        {
          name: "high_repeatability_measurement",
          code: "0x2C06",
          responseWords: 2,
          crc: { poly: POISON_POLY, init: "0x00", width: 8 },
        },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;
}

describe("define-injection — non-hex protocol.addresses[0] poisons the #define <PREFIX>_I2C_ADDR value", () => {
  describe("register_map (portable C)", () => {
    it("never lets ADDR_PWNED escape into live code, and falls back to the unknown-address 0x00 placeholder", () => {
      const art = generatePortableDriver(registerDatasheetWithPoisonedAddress());

      expectNoLeak(art.files, /ADDR_PWNED/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected #define ADDR_PWNED`).not.toMatch(
          /#define\s+ADDR_PWNED/,
        );
      }

      const header = art.files.find((f) => f.path.endsWith(".h"));
      expect(header, "no .h file generated").toBeDefined();
      // The existing "unknown I2C address" placeholder branch (registerDriver's
      // `else` arm) — a poisoned address must be treated exactly like a missing
      // one, not trusted as a live hex value.
      expect(header?.content).toMatch(
        /TODO\(driverge\): set the I2C device address \(not found in the datasheet parse\)/,
      );
      expect(header?.content).toMatch(/_I2C_ADDR 0x00/);
    });
  });

  describe("register_map (portable cpp)", () => {
    it("never lets ADDR_PWNED escape into live code, and falls back to the unknown-address 0x00 placeholder", () => {
      const art = generatePortableCppDriver(registerDatasheetWithPoisonedAddress());

      expectNoLeak(art.files, /ADDR_PWNED/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected #define ADDR_PWNED`).not.toMatch(
          /#define\s+ADDR_PWNED/,
        );
      }

      const header = art.files.find((f) => f.path.endsWith(".hpp"));
      expect(header, "no .hpp file generated").toBeDefined();
      expect(header?.content).toMatch(
        /TODO\(driverge\): set the I2C device address \(not found in the datasheet parse\)/,
      );
      expect(header?.content).toMatch(/_I2C_ADDR 0x00/);
    });
  });

  describe("command_set (portable C)", () => {
    it("never lets ADDR_PWNED escape into live code, and falls back to the unknown-address 0x00 placeholder", () => {
      const poisoned: DatasheetJson = {
        ...commandDatasheetWithPoisonedCrc(),
        protocol: { bus: "I2C", addresses: [POISON_ADDR] },
        interface: {
          kind: "command_set",
          commands: [{ name: "measure", code: "0x2C06", responseWords: 2 }],
        },
      } as unknown as DatasheetJson;
      const art = generatePortableDriver(poisoned);

      expectNoLeak(art.files, /ADDR_PWNED/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected #define ADDR_PWNED`).not.toMatch(
          /#define\s+ADDR_PWNED/,
        );
      }

      const header = art.files.find((f) => f.path.endsWith(".h"));
      expect(header?.content).toMatch(/TODO\(driverge\): set the I2C device address\./);
      expect(header?.content).toMatch(/_I2C_ADDR 0x00/);
    });
  });

  describe("command_set (portable cpp)", () => {
    it("never lets ADDR_PWNED escape into live code, and falls back to the unknown-address 0x00 placeholder", () => {
      const poisoned: DatasheetJson = {
        ...commandDatasheetWithPoisonedCrc(),
        protocol: { bus: "I2C", addresses: [POISON_ADDR] },
        interface: {
          kind: "command_set",
          commands: [{ name: "measure", code: "0x2C06", responseWords: 2 }],
        },
      } as unknown as DatasheetJson;
      const art = generatePortableCppDriver(poisoned);

      expectNoLeak(art.files, /ADDR_PWNED/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected #define ADDR_PWNED`).not.toMatch(
          /#define\s+ADDR_PWNED/,
        );
      }

      const header = art.files.find((f) => f.path.endsWith(".hpp"));
      expect(header?.content).toMatch(/TODO\(driverge\): set the I2C device address\./);
      expect(header?.content).toMatch(/_I2C_ADDR 0x00/);
    });
  });
});

describe("define-injection — non-hex command crc.poly poisons the #define <PREFIX>_CRC_POLY value", () => {
  describe("command_set (portable C)", () => {
    it("never lets crc_pwned escape into live code in any generated file", () => {
      const art = generatePortableDriver(commandDatasheetWithPoisonedCrc());

      expectNoLeak(art.files, /crc_pwned/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected bare declaration`).not.toMatch(
          /int\s+crc_pwned;/,
        );
      }
    });
  });

  describe("command_set (portable cpp)", () => {
    it("never lets crc_pwned escape into live code in any generated file", () => {
      const art = generatePortableCppDriver(commandDatasheetWithPoisonedCrc());

      expectNoLeak(art.files, /crc_pwned/);
      for (const f of art.files) {
        expect(f.content, `${f.path} contains an injected bare declaration`).not.toMatch(
          /int\s+crc_pwned;/,
        );
      }
    });
  });
});
