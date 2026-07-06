// B2 regression (session-16 review): free text lifted verbatim from the parsed
// datasheet — a register's `name` (bitFieldMacros, portable.ts ~L232) and
// `metadata.manufacturer` (AUTOGEN, portable.ts ~L21) — is embedded straight
// into a generated `/* ... */` block comment with no escaping. If that text
// itself contains a `*/`, the comment closes early and whatever text follows
// becomes real, uncommented C source — a comment-escape injection.
//
// Contract pinned here: no free-text field may ever let its content escape the
// comment it was placed in, in ANY generated file (header or source, C or cpp
// flavor). We verify this the same way validate_driver's lintDriver does: strip
// every block/line comment and every string/char literal, then assert the
// injected "poison" identifier does not survive in the remaining code text.
//
// NOTE: fill_in_brief is JSON prose, not C — it is deliberately NOT checked
// here; only the rendered file contents are in scope for a comment-escape bug.

import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import { generatePortableCppDriver } from "../../src/codegen/portable-cpp";
import type { DatasheetJson } from "../../src/schema/types";

// Mirrors the `strip` helper inside src/codegen/lint.ts's lintDriver EXACTLY
// (same four regexes, same order) — that function is not exported, so it is
// duplicated here on the test side rather than reaching into src/.
function stripCommentsAndLiterals(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ");
}

const EVIL_REGISTER_NAME = "EVIL */ int pwned; /*";
const EVIL_MANUFACTURER = "Nasty */ int mfr_pwned; /*";

/** Otherwise-benign register_map datasheet whose ONE register has a
 *  comment-escaping name (bitFieldMacros path). Non-empty bitFields is
 *  required — that is the branch that renders the register's bit-field
 *  header comment line at all. */
function datasheetWithEvilRegisterName(): DatasheetJson {
  return {
    metadata: {
      part: "BME280",
      manufacturer: "Bosch Sensortec",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x76"] },
    interface: {
      kind: "register_map",
      registers: [
        {
          name: EVIL_REGISTER_NAME,
          address: "0xF4",
          reset: "0x00",
          bitFields: [{ name: "mode", msb: 1, lsb: 0 }],
        },
      ],
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;
}

/** Otherwise-benign register_map datasheet with a benign register name but a
 *  comment-escaping manufacturer (AUTOGEN path). */
function datasheetWithEvilManufacturer(): DatasheetJson {
  return {
    metadata: {
      part: "BME280",
      manufacturer: EVIL_MANUFACTURER,
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x76"] },
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

function expectNoLeak(files: { path: string; content: string }[], poison: RegExp): void {
  for (const f of files) {
    const stripped = stripCommentsAndLiterals(f.content);
    expect(
      stripped,
      `${f.path} let the poisoned identifier escape its comment:\n---\n${f.content}\n---`,
    ).not.toMatch(poison);
  }
}

describe("B2 — comment-escape injection via free-text register/manufacturer fields", () => {
  describe("bitFieldMacros embeds a register name with an unescaped \"*/\" (portable C)", () => {
    it("never lets `pwned` escape into real code, in any generated file", () => {
      const art = generatePortableDriver(datasheetWithEvilRegisterName());
      expectNoLeak(art.files, /pwned/);
    });
  });

  describe("bitFieldMacros embeds a register name with an unescaped \"*/\" (portable cpp)", () => {
    it("never lets `pwned` escape into real code, in any generated file", () => {
      const art = generatePortableCppDriver(datasheetWithEvilRegisterName());
      expectNoLeak(art.files, /pwned/);
    });
  });

  describe("AUTOGEN embeds a manufacturer with an unescaped \"*/\" (portable C)", () => {
    it("never lets `mfr_pwned` escape into real code, in any generated file", () => {
      const art = generatePortableDriver(datasheetWithEvilManufacturer());
      expectNoLeak(art.files, /mfr_pwned/);
    });
  });

  describe("AUTOGEN embeds a manufacturer with an unescaped \"*/\" (portable cpp)", () => {
    it("never lets `mfr_pwned` escape into real code, in any generated file", () => {
      const art = generatePortableCppDriver(datasheetWithEvilManufacturer());
      expectNoLeak(art.files, /mfr_pwned/);
    });
  });
});
