import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CACHE_ENTRIES,
  clearDatasheetCache,
  getDatasheet,
  putDatasheet,
} from "../../src/mcp/cache";
import { registerDatasheet } from "../codegen/helpers";

// Contract: the datasheet cache is a bounded LRU (MAX_CACHE_ENTRIES entries) so a
// long-lived server process can't be grown without bound by repeated
// analyze_datasheet calls. Identity of the cached JSON doesn't matter here —
// only ref bookkeeping — so every entry reuses the same parsed BME280 fixture.
const json = registerDatasheet("bme280.golden.json", "BME280");

function put(ref: string): void {
  putDatasheet({ ref, pdfPath: `/x/${ref}.pdf`, json });
}

beforeEach(() => {
  clearDatasheetCache();
});

describe("Datasheet cache — bounded LRU", () => {
  it("exports MAX_CACHE_ENTRIES = 32", () => {
    expect(MAX_CACHE_ENTRIES).toBe(32);
  });

  it("evicts the oldest (first-inserted) ref once the cache exceeds MAX_CACHE_ENTRIES", () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) put(`ds_${i}`);

    put("ds_overflow");

    expect(getDatasheet("ds_0")).toBeUndefined();
    expect(getDatasheet("ds_1")).toBeDefined();
    expect(getDatasheet("ds_overflow")).toBeDefined();
  });

  it("getDatasheet refreshes recency, so a re-read oldest entry survives the next eviction", () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) put(`ds_${i}`);

    // Touching ds_0 must move it to the "recent" end, making ds_1 the new
    // eviction candidate instead.
    expect(getDatasheet("ds_0")).toBeDefined();

    put("ds_overflow");

    expect(getDatasheet("ds_0")).toBeDefined();
    expect(getDatasheet("ds_1")).toBeUndefined();
    expect(getDatasheet("ds_overflow")).toBeDefined();
  });
});
