import { describe, expect, it } from "vitest";
import { classifyDocument, classifyPage } from "../../src/pdf/classify";

describe("classifyPage", () => {
  it("labels a page with enough text as 'text'", () => {
    expect(classifyPage({ textLength: 200, hasImage: false })).toBe("text");
  });

  it("labels a low-text page that has an image as 'scanned'", () => {
    expect(classifyPage({ textLength: 3, hasImage: true })).toBe("scanned");
  });

  it("labels a low-text page with no image as 'blank'", () => {
    expect(classifyPage({ textLength: 0, hasImage: false })).toBe("blank");
  });
});

describe("classifyDocument", () => {
  it("classifies all-text pages as text_based", () => {
    const { type } = classifyDocument([
      { textLength: 100, hasImage: false },
      { textLength: 80, hasImage: false },
    ]);
    expect(type).toBe("text_based");
  });

  it("classifies all-image pages as scanned", () => {
    const { type } = classifyDocument([
      { textLength: 0, hasImage: true },
      { textLength: 2, hasImage: true },
    ]);
    expect(type).toBe("scanned");
  });

  it("classifies a mix of text and scanned pages as mixed", () => {
    const { type } = classifyDocument([
      { textLength: 100, hasImage: false },
      { textLength: 0, hasImage: true },
    ]);
    expect(type).toBe("mixed");
  });

  it("ignores blank pages when deciding the document type", () => {
    const { type } = classifyDocument([
      { textLength: 100, hasImage: false },
      { textLength: 0, hasImage: false },
    ]);
    expect(type).toBe("text_based");
  });

  it("reports a per-page kind for every page", () => {
    const { pageKinds } = classifyDocument([
      { textLength: 100, hasImage: false },
      { textLength: 0, hasImage: true },
    ]);
    expect(pageKinds).toEqual(["text", "scanned"]);
  });
});
