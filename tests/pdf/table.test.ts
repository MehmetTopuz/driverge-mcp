import { describe, expect, it } from "vitest";
import { clusterRows } from "../../src/pdf/table";

const t = (str: string, x: number, y: number, width = 10) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

describe("clusterRows", () => {
  it("groups items with near-equal y into one row, sorted left-to-right", () => {
    // a/b share the top row (y 141/140); c is a lower row (y 100).
    const rows = clusterRows([t("b", 50, 140), t("a", 10, 141), t("c", 90, 100)]);
    expect(rows).toHaveLength(2);
    expect(rows[0].items.map((i) => i.str)).toEqual(["a", "b"]);
    expect(rows[1].items.map((i) => i.str)).toEqual(["c"]);
  });

  it("orders rows top-to-bottom (higher y first)", () => {
    const rows = clusterRows([t("low", 10, 20), t("high", 10, 200)]);
    expect(rows.map((r) => r.items[0].str)).toEqual(["high", "low"]);
  });

  it("ignores whitespace-only items", () => {
    const rows = clusterRows([t("x", 10, 100), t("   ", 20, 100)]);
    expect(rows[0].items.map((i) => i.str)).toEqual(["x"]);
  });
});
