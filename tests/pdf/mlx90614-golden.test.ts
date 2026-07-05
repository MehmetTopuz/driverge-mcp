import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findGenericRegisterTable } from "../../src/pdf/generic-register-table";
import golden from "../fixtures/mlx90614.golden.json";

// Behavior-pin (Session 11 / Phase D). MLX90614 (Melexis) has no specialized
// adapter either — findGenericRegisterTable's role-based fallback (Phase B/C)
// produces its 7-register, address-only EEPROM map (see
// tests/scorecard/scorecard.snap.md: "mlx90614.pdf | ... | 7 | 0 | ... |
// partial"). This golden locks TODAY's behavior against regressions from
// slotting the new findMaximRegisterMap adapter into buildInterface's fallback
// chain BEFORE findGenericRegisterTable — MLX90614's table doesn't match
// Maxim's REGISTER/B7..B0/REG ADDR/POR STATE shape, so the new adapter must
// find nothing here and fall through unchanged.
// Skips on a fresh clone lacking the git-ignored fixture PDF.
const FIXTURE = fileURLToPath(new URL("../fixtures/mlx90614.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("MLX90614 golden register map (generic fallback)", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findGenericRegisterTable(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });
});
