import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { detectPart } from "../../src/pdf/part";

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

describe("detectPart", () => {
  it("picks the most frequent vendor part token", () => {
    expect(detectPart([page("TMAG5170-Q1 device. The TMAG5170 is a Hall sensor. TMAG5170")])).toBe("TMAG5170");
    expect(detectPart([page("DHT20 temperature and humidity sensor. DHT20 module.")])).toBe("DHT20");
    expect(detectPart([page("AEAT-8811-Q24 magnetic encoder")])).toBe("AEAT-8811");
    expect(detectPart([page("Infineon TLE5014SP16D angle sensor")])).toBe("TLE5014SP16D");
  });

  it("returns empty when no known part token is present", () => {
    expect(detectPart([page("A generic widget with no recognizable part number")])).toBe("");
  });
});

const TMAG = fileURLToPath(new URL("../fixtures/tmag5170-q1.pdf", import.meta.url));

describe.skipIf(!existsSync(TMAG))("detectPart (real TMAG5170)", () => {
  it("extracts TMAG5170 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(TMAG)).pages)).toBe("TMAG5170");
  });
});
