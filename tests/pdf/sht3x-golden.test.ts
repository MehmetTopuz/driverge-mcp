import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { extractCommands, extractProtocol } from "../../src/pdf/command";
import { detectManufacturer } from "../../src/pdf/manufacturer";
import { validateDatasheet } from "../../src/schema/validate";
import golden from "../fixtures/sht3x.golden.json";

// User-verified scoped command_set contract for the SHT3x. PDF-gated: skips on a
// fresh clone that lacks the (git-ignored) datasheet.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/sht3x-datasheet.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("SHT3x command_set golden", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const manufacturer = detectManufacturer(analysis.pages);
    const protocol = extractProtocol(analysis.pages);
    const commands = extractCommands(analysis.pages);

    const datasheet = {
      metadata: {
        part: "SHT3x",
        manufacturer: manufacturer.manufacturer,
        manufacturerConfidence: manufacturer.confidence,
        pdfType: analysis.type,
        pageCount: analysis.pageCount,
      },
      protocol,
      interface: { kind: "command_set" as const, commands },
      validation: { valid: true, errors: [] as string[], warnings: [] as string[] },
    };
    datasheet.validation = validateDatasheet(datasheet);

    expect(datasheet).toEqual(golden);
  });
});
