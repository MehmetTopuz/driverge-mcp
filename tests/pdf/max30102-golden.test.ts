import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/max30102.golden.json";

// Hand-verified L0 contract for the MAX30102 (Maxim) register-matrix table
// ("Register Maps and Descriptions", pages 10-22: REGISTER | B7..B0 | REG ADDR
// | POR STATE | R/W). Skips on a clone lacking the git-ignored fixture PDF
// (see tests/fixtures/README.md).
//
// This golden took three RED->GREEN rounds against the same fixture (Session
// 11 / Phase D) — worth a note here since each mistake was specific enough to
// regress silently if the contract were ever loosened back to a floor check:
//   1. floor only (>= 8 registers, a multi-bit field, non-`none` status) —
//      true before findMaximRegisterMap existed at all.
//   2. once wired in, a hand spot-check against the datasheet (cross-checked
//      via `pdftotext -layout` and the raw pdfjs positioned-text items) found
//      the adapter scanned only the FIRST register-recap header band per
//      page, silently dropping every register after the first section on any
//      page carrying two (0x04-0x07, 0x0A, 0x12, 0xFE, 0xFF were all
//      missing), plus a mis-folded TINT[7:0] (collapsed to a single bit) and
//      a truncated A_FULL_EN (kept only the middle fragment, "FULL_").
//   3. once those were fixed, three register *names* were still garbage —
//      "SpO 2" (the subscript "2" joined with a spurious space, and the
//      "Configuration" line dropped for sitting just past the wrap gap), and
//      "Multi-LED" / "Registers" as two different half-names for what is
//      really one Multi-LED Mode Control Registers section spanning both
//      0x11 and 0x12. These weren't cosmetic: a bad register name leaks
//      straight into generated macro names (a bare "Registers" becomes
//      MAX30102_REGISTERS_SLOT4_MASK).
const FIXTURE = fileURLToPath(new URL("../fixtures/max30102.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("MAX30102 golden register map", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extraction is complete with the three hand-verified name fixes and no leftover RESERVED rows", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));

    expect(json.extraction?.status).toBe("complete");
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }

    const registers = json.interface.registers;
    expect(registers.length).toBe(20);

    const byAddress = (address: string) => registers.find((r) => r.address === address);

    // SpO2 Configuration (0x0A): the split "SpO" + "2" token is joined
    // without an inserted space, and the second title line survives.
    expect(byAddress("0x0A")?.name).toBe("SpO2 Configuration");

    // Multi-LED Mode Control Registers (0x11/0x12): the 3-line shared title
    // now folds identically onto both sibling addresses.
    expect(byAddress("0x11")?.name).toBe("Multi-LED Mode Control Registers");
    expect(byAddress("0x12")?.name).toBe("Multi-LED Mode Control Registers");

    // No RESERVED filler rows (mangled range addresses) ever escape.
    expect(registers.some((r) => /^reserved$/i.test(r.name))).toBe(false);
  });
});
