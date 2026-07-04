import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdf, analyzePdfFile } from "../../src/pdf/analyze";
import { MIN_TEXT_CHARS } from "../../src/pdf/classify";
import { extractPages } from "../../src/pdf/extract";
import { makePdf } from "./helpers";

describe("extractPages", () => {
  it("extracts positioned text from a text PDF", async () => {
    const pdf = await makePdf([{ text: ["Register Map", "ctrl_meas 0xF4"] }]);
    const pages = await extractPages(pdf);
    expect(pages).toHaveLength(1);
    expect(pages[0].index).toBe(1);
    expect(pages[0].hasImage).toBe(false);
    expect(pages[0].text).toContain("Register Map");
    expect(pages[0].items.length).toBeGreaterThan(0);
    expect(typeof pages[0].items[0].x).toBe("number");
    expect(typeof pages[0].items[0].y).toBe("number");
  });

  it("flags an image-only page as having an image and no text", async () => {
    const pdf = await makePdf([{ image: true }]);
    const pages = await extractPages(pdf);
    expect(pages[0].hasImage).toBe(true);
    expect(pages[0].text).toBe("");
  });

  // Lazy hasImage (Session 10, Phase 4): the only consumer, classifyPage,
  // reads hasImage exclusively when textLength < MIN_TEXT_CHARS. A text-rich
  // page must therefore report hasImage === false unconditionally -- even
  // when it *does* paint a raster (e.g. a logo/figure) -- because computing
  // it there would only pay the getOperatorList() cost for a value nothing
  // reads. "false" on a texty page means "not computed", not "no image".
  it("does not compute hasImage for a text-rich page, even one that paints an image", async () => {
    const longText =
      "Register Map ctrl_meas 0xF4 — well past the MIN_TEXT_CHARS floor";
    const pdf = await makePdf([{ text: [longText], image: true }]);
    const pages = await extractPages(pdf);
    expect(pages[0].text.length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
    expect(pages[0].hasImage).toBe(false);
  });
});

// The committed BME280 fixture pages all carry both body text and page-chrome
// rasters (Bosch logo/figures), so it pins the "not computed" half of the
// lazy hasImage contract against a real datasheet, not just a synthetic one.
// It requires the (git-ignored) datasheet PDF, so the check skips itself on a
// fresh clone that lacks the fixture (see tests/fixtures/README.md).
const BME280_FIXTURE = fileURLToPath(
  new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url),
);

describe.skipIf(!existsSync(BME280_FIXTURE))(
  "extractPages lazy hasImage (BME280 fixture)",
  () => {
    it("reports hasImage === false for every text-rich page", async () => {
      const analysis = await analyzePdfFile(BME280_FIXTURE);
      const textyPages = analysis.pages.filter(
        (page) => page.text.length >= MIN_TEXT_CHARS,
      );
      // Sanity check on the fixture itself: BME280 is a text-based datasheet,
      // so most/all pages should clear the text floor.
      expect(textyPages.length).toBeGreaterThan(0);
      for (const page of textyPages) {
        expect(page.hasImage).toBe(false);
      }
    });

    // Regression pin: laziness must not change document-level classification.
    // (Register-map/golden content is covered by bme280-golden.test.ts; this
    // only pins the pdfType, which nothing else in the suite asserts for
    // this fixture.)
    it("still classifies the document as text_based", async () => {
      const analysis = await analyzePdfFile(BME280_FIXTURE);
      expect(analysis.type).toBe("text_based");
      expect(analysis.warnings).toHaveLength(0);
    });
  },
);

describe("analyzePdf", () => {
  it("classifies a text PDF as text_based with a page map and no warnings", async () => {
    const pdf = await makePdf([
      { text: ["Register Map", "ctrl_meas 0xF4"] },
      { text: ["Electrical Characteristics"] },
    ]);
    const result = await analyzePdf(pdf);
    expect(result.type).toBe("text_based");
    expect(result.pageCount).toBe(2);
    expect(result.pageMap.register_map).toEqual([1]);
    expect(result.warnings).toHaveLength(0);
  });

  it("classifies an image-only PDF as scanned and warns", async () => {
    const pdf = await makePdf([{ image: true }]);
    const result = await analyzePdf(pdf);
    expect(result.type).toBe("scanned");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("classifies a mixed PDF as mixed and warns", async () => {
    const pdf = await makePdf([
      { text: ["Register Map here", "some text content long enough"] },
      { image: true },
    ]);
    const result = await analyzePdf(pdf);
    expect(result.type).toBe("mixed");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
