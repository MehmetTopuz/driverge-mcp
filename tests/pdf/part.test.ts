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

  // Phase A (evidenced quality fix): the scorecard shows part "—" for
  // vl53l3cx.pdf — PART_PATTERNS has no entry for ST's VL53 ToF family, so
  // detectPart falls back to "" and the slug falls back to "device".
  it("detects the ST VL53 ToF family (VL53L3CX, VL53L1X)", () => {
    expect(
      detectPart([
        page(
          "The VL53L3CX is a Time-of-Flight ranging sensor. VL53L3CX is available in a small " +
            "package. VL53L3CX register map follows.",
        ),
      ]),
    ).toBe("VL53L3CX");
    expect(
      detectPart([
        page(
          "The VL53L1X is a Time-of-Flight ranging sensor. VL53L1X is available in a small " +
            "package. VL53L1X register map follows.",
        ),
      ]),
    ).toBe("VL53L1X");
  });
});

const TMAG = fileURLToPath(new URL("../fixtures/tmag5170-q1.pdf", import.meta.url));

describe.skipIf(!existsSync(TMAG))("detectPart (real TMAG5170)", () => {
  it("extracts TMAG5170 from the datasheet", async () => {
    expect(detectPart((await analyzePdfFile(TMAG)).pages)).toBe("TMAG5170");
  });
});
