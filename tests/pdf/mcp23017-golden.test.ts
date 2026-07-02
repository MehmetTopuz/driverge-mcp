import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findRegisterTable } from "../../src/pdf/register-table";
import golden from "../fixtures/mcp23017.golden.json";

// Hand-verified L0 contract for the MCP23017 (Microchip) register summary —
// TABLE 3-2, the first bit-field register table on the page (BANK = 1
// addresses). Exercises the Microchip layout: band-merged multi-line header,
// per-bit named cells, bare-hex addresses and binary reset values. Skips itself
// on a fresh clone that lacks the git-ignored datasheet PDF.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/mcp23017-datasheet.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("MCP23017 golden register map", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findRegisterTable(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });
});
