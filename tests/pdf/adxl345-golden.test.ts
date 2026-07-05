import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findGenericRegisterTable } from "../../src/pdf/generic-register-table";
import golden from "../fixtures/adxl345.golden.json";

// Behavior-pin (Session 11 / Phase D). ADXL345 (Analog Devices) has no
// specialized adapter — findRegisterTable and findTiRegisterMap both find
// nothing, so findGenericRegisterTable's role-based fallback (Phase B/C) is
// what currently produces its 30-register, address-only map (see
// tests/scorecard/scorecard.snap.md: "adxl345.pdf | ... | 30 | 0 | ... |
// partial"). This golden locks TODAY's behavior so that wiring the new
// findMaximRegisterMap adapter into buildInterface's fallback chain (slotted
// BEFORE findGenericRegisterTable) cannot silently regress it — ADXL345's
// table doesn't match Maxim's REGISTER/B7..B0/REG ADDR/POR STATE shape, so the
// new adapter must find nothing here and fall through unchanged.
// Skips on a fresh clone lacking the git-ignored fixture PDF.
const FIXTURE = fileURLToPath(new URL("../fixtures/adxl345.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("ADXL345 golden register map (generic fallback)", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findGenericRegisterTable(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });
});
