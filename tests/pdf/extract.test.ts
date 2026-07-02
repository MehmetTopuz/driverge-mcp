import { describe, expect, it } from "vitest";
import { analyzePdf } from "../../src/pdf/analyze";
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
});

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
