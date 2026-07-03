import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findTiRegisterMap } from "../../src/pdf/ti-register-map";
import golden from "../fixtures/tmag5170.golden.json";

// Hand-verified L0 contract for the TMAG5170 (TI) register map — the "Table 7-4.
// TMAG5170 Registers" summary (21 registers, offsets 0x00–0x14), extracted across
// the page-33/34 continued table. bitFields are empty (16-bit field extraction is
// a documented follow-up). Skips on a fresh clone lacking the git-ignored PDF.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/tmag5170-q1.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("TMAG5170 golden register map", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findTiRegisterMap(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });
});
