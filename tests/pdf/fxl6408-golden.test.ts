import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/fxl6408.golden.json";

// Hand-verified L0 contract for the onsemi FXL6408 (Unit 3, STM32 field-test
// gap — see raw/stm32-test-results/FXL6408-report.md). Today `analyze_datasheet`
// returns extraction "deferred" with `registers: []` for this fixture: no
// adapter in the assembleDatasheet chain (findRegisterTable/findTiRegisterMap/
// findTiCommandByteTable/findMaximRegisterMap/findGenericRegisterTable) matches
// Table 9's shape, and `manufacturer` comes back "generic"/confidence 0 (no
// onsemi entry in src/pdf/manufacturer.ts's VENDORS list at all).
//
// This golden was derived from a raw pdfjs positioned-text dump of page 9
// (Table 9. I2C REGISTER MAP), NOT from a visual PDF read — see the max30102
// golden's own history note for why that distinction matters. Two dump-driven
// findings worth flagging up front, since a naive/idealized reading of the
// table would get both wrong:
//
//   1. Table 9 is a Microchip-style PER-BIT table (a "Register | Address |
//      Type | Bit7..Bit0 | Reset Value" header band, with individual per-bit
//      cell names like "MF3"/"GPIO7"/"Out 7"/"In 7" — never `name[hi:lo]`
//      spans), but it carries an extra "Type" (R/W) column between Address and
//      Bit7 that the existing Microchip/BME280 adapter (register-table.ts) has
//      no concept of — its addrMax..bitMax boundary conflates Type into the
//      address capture, breaking `BARE_HEX` on the very first row ("01hR/W")
//      and explaining today's registers:[] (findRegisterTable returns
//      undefined for this page today, confirmed against current src). A
//      register names ALSO wrap across two physical lines for half of the 10
//      rows (e.g. "Device ID &" / "Ctrl", "Input Default" / "State") — the
//      existing adapter has no wrap-continuation handling and would break the
//      whole table body at the first continuation-only row even if the Type
//      column were fixed. This is why the plan calls for a NEW dedicated
//      src/pdf/onsemi-register-table.ts adapter rather than patching the
//      shared one.
//   2. Two register names contain a genuine glyph split: "Output High-Z"
//      (0x07) and "Pull-Down/Pull-Up" (0x0D) render their hyphens as a
//      SEPARATE positioned-text item using U+2212 MINUS SIGN (not the ASCII
//      U+002D hyphen), immediately glyph-adjacent (~0px gap) to the
//      surrounding letters — confirmed via a raw pdfjs item dump (x/width
//      inspection), not eyeballed. This golden pins the literal U+2212
//      character, glued with no inserted space (mirroring maxim-register-map's
//      established glyph-adjacency convention — see its GLYPH_ADJACENT_EPS).
//      0x0D's name additionally wraps across two physical lines ("Pull-Down/"
//      / "Pull-Up"); the two lines are joined with a single space, matching
//      every other cross-LINE title join in this codebase (e.g.
//      maxim-register-map's mergeSplitTitles) — the trailing space after the
//      "/" ("Pull−Down/ Pull−Up") looks a little odd printed, but is the
//      defensible, precedent-consistent reconstruction, not a guess.
//
// Reset values: Table 9 prints contiguous 8-digit binary strings with NO
// space ("10100010", not "1111 1111"), which register-table.ts's existing
// `normalizeReset` already handles (it strips whitespace before the /^[01]{8}$/
// check) — "10100010" -> "0xA2" etc. The two status registers (0x0F, 0x13)
// print the literal non-hex placeholder "XXXXXXXX", which normalizeReset's
// regex correctly leaves VERBATIM (falls through to `return raw`) — the
// schema's `reset` field is a free-form string for exactly this reason (see
// schemas/datasheet.schema.json's description, and
// wiki/decisions/json-schema-as-contract.md).
//
// Bit-field scope note (deviation, flagged per the Unit 3 task instructions):
// the field report's completed/validated JSON has "76 bit-fields" for these
// 10 registers, not the 80 (8 per register x 10) pinned below. The 4-field gap
// is 0x01 (Device ID & Ctrl) alone: the host AI consolidated Table 9's 3
// separate per-bit cells "MF3"/"MF2"/"MF1" into ONE 3-bit "MF" field, and
// "FW_rev3"/"FW_rev2"/"FW_rev1" into ONE 3-bit "FW_rev" field, by cross-
// referencing Table 10 (a SEPARATE per-register bit-description table later on
// the same page) -- 8-4 = 4 fields saved on 0x01, 76 = 4 + 8*9. Table-9-only
// extraction (matching this Unit's stated scope, "FXL6408 Table 9 düzeni", and
// matching the existing Microchip/MCP23017 perBit adapter's own convention of
// never consolidating multi-bit spans from a separate table) has no way to
// know MF/FW_rev are 3-bit groups without also parsing Table 10 — a
// substantially bigger feature nowhere else scoped in this unit's plan. This
// golden pins the mechanically-justified 80-single-bit-field reading and flags
// the deviation here rather than silently matching the report's post-processed
// count.
//
// Skips on a fresh clone/machine lacking the git-ignored fixture PDF (see
// tests/fixtures/README.md).
const FIXTURE = fileURLToPath(new URL("../fixtures/fxl6408.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("FXL6408 golden register map (onsemi Table 9)", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extraction is complete (bit-field detail present) — no longer deferred with registers: []", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));

    expect(json.extraction?.status).toBe("complete");
    expect(json.extraction?.detectedPages).toEqual([7, 9]);
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }

    const registers = json.interface.registers;
    expect(registers.length).toBe(10);

    const byAddress = (address: string) => registers.find((r) => r.address === address);

    // Non-sequential Table 9 addresses (odd steps of 2, per report §5) —
    // exactly these 10, in exactly this order.
    expect(registers.map((r) => r.address)).toEqual([
      "0x01",
      "0x03",
      "0x05",
      "0x07",
      "0x09",
      "0x0B",
      "0x0D",
      "0x0F",
      "0x11",
      "0x13",
    ]);

    // Resets exactly as report §5, including the two VERBATIM non-hex "XXXXXXXX"
    // placeholders (schema allows a free-form reset string).
    expect(byAddress("0x01")?.reset).toBe("0xA2");
    expect(byAddress("0x07")?.reset).toBe("0xFF");
    expect(byAddress("0x0B")?.reset).toBe("0xFF");
    expect(byAddress("0x0F")?.reset).toBe("XXXXXXXX");
    expect(byAddress("0x13")?.reset).toBe("XXXXXXXX");

    // Wrapped/glyph-split names reconstructed correctly (see file header).
    expect(byAddress("0x01")?.name).toBe("Device ID & Ctrl");
    expect(byAddress("0x09")?.name).toBe("Input Default State");
    expect(byAddress("0x07")?.name).toBe("Output High−Z");
    expect(byAddress("0x0D")?.name).toBe("Pull−Down/ Pull−Up");

    // No RESERVED filler row (the "02h, 04h, 06h, 08h, 0Ah, 0Ch, 0Eh, 10h,
    // 12h" recap row) ever escapes as a register.
    expect(registers.some((r) => /^reserved$/i.test(r.name))).toBe(false);
  });

  it("detects part and manufacturer — pins the new onsemi vendor signal", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.metadata.part).toBe("FXL6408");
    expect(json.metadata.manufacturer).toBe("onsemi");
    // The exact value is pinned in the golden (1, matching every other vendor
    // rule's copyright+domain double-strong-signal shape), but the CONTRACT
    // this test exists to pin is just "no longer 0" — see task note.
    expect(json.metadata.manufacturerConfidence).toBeGreaterThan(0);
  });
});
