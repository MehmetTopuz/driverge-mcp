import { describe, expect, it } from "vitest";
import { buildPageMap, labelPage } from "../../src/pdf/page-map";

describe("labelPage", () => {
  it("detects a register map heading", () => {
    expect(labelPage("5.2 Register Map\nctrl_meas 0xF4")).toContain("register_map");
  });

  it("detects electrical characteristics", () => {
    expect(labelPage("6 Electrical Characteristics")).toContain(
      "electrical_characteristics",
    );
  });

  it("detects a timing section", () => {
    expect(labelPage("Timing Diagram")).toContain("timing");
  });

  it("returns no labels for unrelated text", () => {
    expect(labelPage("Introduction and general overview")).toHaveLength(0);
  });
});

describe("buildPageMap", () => {
  it("maps labels to 1-based page numbers", () => {
    const map = buildPageMap([
      "Overview",
      "Register Map for the device",
      "Electrical Characteristics",
    ]);
    expect(map.register_map).toEqual([2]);
    expect(map.electrical_characteristics).toEqual([3]);
  });

  it("collects multiple pages under the same label", () => {
    const map = buildPageMap(["Register Map part 1", "Register Map part 2"]);
    expect(map.register_map).toEqual([1, 2]);
  });
});
