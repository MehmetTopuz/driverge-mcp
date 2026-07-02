import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findRegisterTable } from "../../src/pdf/register-table";
import golden from "../fixtures/bme280.golden.json";

// The committed golden is the hand-verified L0 contract for the BME280 memory
// map. It requires the (git-ignored) datasheet PDF to regenerate, so the check
// skips itself on a fresh clone that lacks the fixture.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("BME280 golden register map", () => {
  it("parser output matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findRegisterTable(analysis.pages);
    expect(table?.page).toBe(golden.sourcePage);
    expect(table?.registers).toEqual(golden.registers);
  });
});
