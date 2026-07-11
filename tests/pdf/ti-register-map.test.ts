import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { findTiRegisterMap, parseTiRegisterMap } from "../../src/pdf/ti-register-map";

const t = (str: string, x: number, width: number, y: number) => ({
  str,
  x,
  y,
  width,
  height: 10,
});

// Mirrors TI's "Table 7-4. TMAG5170 Registers": Offset | Acronym | Register Name
// | Section. Offsets are bare hex + "h"; the acronym (col 2) is the register
// name. The trailing "0h = 1x …" row is a decoy (a bit-field value description
// that also starts with an offset) — the acronym rule must reject it.
function tiLikePage() {
  const items = [
    // header
    t("Offset", 60, 30, 100), t("Acronym", 120, 34, 100),
    t("Register Name", 200, 60, 100), t("Section", 340, 30, 100),
    // 0h DEVICE_CONFIG
    t("0h", 60, 12, 88), t("DEVICE_CONFIG", 120, 60, 88),
    t("Configure Device Operation Modes", 200, 130, 88), t("Go", 340, 12, 88),
    // 8h CONV_STATUS
    t("8h", 60, 12, 76), t("CONV_STATUS", 120, 52, 76),
    t("Conversion Status Register", 200, 110, 76), t("Go", 340, 12, 76),
    // 10h OSC_MONITOR
    t("10h", 60, 16, 64), t("OSC_MONITOR", 120, 52, 64),
    t("Conversion Result Register", 200, 110, 64), t("Go", 340, 12, 64),
    // decoy: "0h = 1x - 10Ksps" — offset but no acronym; parsing must stop here
    t("0h", 60, 12, 52), t("=", 120, 6, 52), t("1x - 10Ksps", 140, 60, 52),
  ];
  return { index: 33, text: "", items, hasImage: false };
}

describe("parseTiRegisterMap (synthetic TI Table 7-4 geometry)", () => {
  const table = parseTiRegisterMap(tiLikePage());

  it("reads offset+acronym rows and stops at the first non-register row", () => {
    expect(table?.registers.map((r) => r.name)).toEqual([
      "DEVICE_CONFIG",
      "CONV_STATUS",
      "OSC_MONITOR",
    ]);
  });

  it("normalizes the bare-hex offset to a 0x address", () => {
    expect(table?.registers.map((r) => r.address)).toEqual([
      "0x00",
      "0x08",
      "0x10",
    ]);
  });

  it("leaves reset/bitFields empty (summary table carries no field data)", () => {
    const dc = table?.registers.find((r) => r.name === "DEVICE_CONFIG");
    expect(dc?.reset).toBe("");
    expect(dc?.bitFields).toEqual([]);
  });
});

// Unit 3 (STM32 field test) — TUSS4470's "Table 7-5. REG_USER Registers" uses
// a DIFFERENT header/address dialect than TMAG5170's "Table 7-4" above: the
// offset column header reads "Address" (not "Offset"), and address cells
// already print "0x10" (not "10h"). Today neither `isHeader` nor `OFFSET`
// recognizes this shape, so findTiRegisterMap returns undefined for it
// entirely and assembleDatasheet falls through to the generic role-based
// fallback — which glues the Acronym and Register Name/Description columns
// together for some rows (see tuss4470-golden.test.ts's file header for the
// exact root cause). These tests pin the widened contract directly against
// parseTiRegisterMap, independent of the golden's end-to-end assertions.
function tiAddressFormatPage() {
  const items = [
    // header — "Address" (TUSS4470-style), not "Offset"
    t("Address", 60, 40, 100), t("Acronym", 120, 34, 100),
    t("Register Name", 200, 60, 100), t("Section", 340, 30, 100),
    // 0x10 BPF_CONFIG_1 — acronym and description are SEPARATE items, as real
    // pdfjs extraction produces (confirmed via a raw dump of the fixture);
    // regression: an already-clean, separately-itemized acronym must stay
    // exactly as printed, description ignored entirely.
    t("0x10", 60, 24, 88), t("BPF_CONFIG_1", 120, 60, 88),
    t("Bandpass filter settings", 200, 100, 88), t("Go", 340, 12, 88),
    // 0x1E REV_ID — same separate-items shape, single-word acronym.
    t("0x1E", 60, 24, 76), t("REV_ID", 120, 40, 76),
    t("Revision ID", 200, 60, 76), t("Go", 340, 12, 76),
  ];
  return { index: 23, text: "", items, hasImage: false };
}

describe("parseTiRegisterMap (Address-header + 0x.. offset format — TUSS4470-style widening)", () => {
  const table = parseTiRegisterMap(tiAddressFormatPage());

  it("recognizes the 'Address' header token as an offset-header synonym", () => {
    expect(table).not.toBeUndefined();
  });

  it("normalizes already-'0x..'-prefixed addresses (idempotent, not just bare-hex+h)", () => {
    expect(table?.registers.map((r) => r.address)).toEqual(["0x10", "0x1E"]);
  });

  it("reads the acronym cell as the name, ignoring the separate description column", () => {
    expect(table?.registers.map((r) => r.name)).toEqual(["BPF_CONFIG_1", "REV_ID"]);
  });
});

// Conservative name-trim rule (Unit 3 plan §3c): when a TI register-map name
// cell arrives as ONE glued pdfjs item pairing an ALL-CAPS identifier token
// with trailing human-readable description text, keep only the identifier.
// Isolated from the header/address-format widening above (uses the ALREADY-
// recognized "Offset"/"..h" TMAG5170 dialect) so this pins the trim rule as
// its own independent contract. Fixture values are the REAL dirty strings
// from the TUSS4470 field report (see
// raw/stm32-test-results/TUSS4470_DRIVERGE_RAPORU.md §3.2), not invented ones.
function tiGluedNamePage() {
  const items = [
    t("Offset", 60, 30, 100), t("Acronym", 120, 34, 100),
    t("Register Name", 200, 60, 100), t("Section", 340, 30, 100),
    // 1Ch DEV_STAT — acronym + trailing prose GLUED into one pdfjs item.
    t("1Ch", 60, 16, 88), t("DEV_STAT Fault status bits", 120, 140, 88), t("Go", 340, 12, 88),
    // 1Dh DEVICE_ID — same shape, a shorter Title-Case (not lowercase) tail —
    // the report's real example, so the rule must not require an all-lowercase
    // remainder.
    t("1Dh", 60, 16, 76), t("DEVICE_ID Device ID", 120, 110, 76), t("Go", 340, 12, 76),
    // 1Eh REV_ID — same shape again.
    t("1Eh", 60, 16, 64), t("REV_ID Revision ID", 120, 100, 64), t("Go", 340, 12, 64),
    // 1Fh ALL_CAPS_ONLY — a bare identifier with NO trailing prose at all:
    // must stay untouched (the rule only trims, never invents a change).
    t("1Fh", 60, 16, 52), t("ALL_CAPS_ONLY", 120, 80, 52), t("Go", 340, 12, 52),
  ];
  return { index: 23, text: "", items, hasImage: false };
}

describe("parseTiRegisterMap (conservative register-name trim — TUSS4470 field regression)", () => {
  const table = parseTiRegisterMap(tiGluedNamePage());

  it("trims 'IDENTIFIER prose tail' glued cells to just the leading ALL-CAPS identifier", () => {
    expect(table?.registers.map((r) => r.name)).toEqual([
      "DEV_STAT",
      "DEVICE_ID",
      "REV_ID",
      "ALL_CAPS_ONLY",
    ]);
  });

  it("leaves a bare identifier with no trailing prose untouched", () => {
    const bare = table?.registers.find((r) => r.address === "0x1F");
    expect(bare?.name).toBe("ALL_CAPS_ONLY");
  });

  it("still reads the addresses correctly alongside the trim", () => {
    expect(table?.registers.map((r) => r.address)).toEqual(["0x1C", "0x1D", "0x1E", "0x1F"]);
  });
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/tmag5170-q1.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("findTiRegisterMap (real TMAG5170)", () => {
  it("extracts the 21-register map across the continued table", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const table = findTiRegisterMap(analysis.pages);
    const byName = Object.fromEntries(
      (table?.registers ?? []).map((r) => [r.name, r.address]),
    );
    expect(byName.DEVICE_CONFIG).toBe("0x00");
    expect(byName.CONV_STATUS).toBe("0x08");
    expect(byName.OSC_MONITOR).toBe("0x10"); // first row of the continued page
    expect(byName.MAGNITUDE_RESULT).toBe("0x14"); // last register
    expect(table?.registers.length).toBe(21);
  });
});

// Unit 3 (STM32 field test) — real fixture. Pins findTiRegisterMap directly
// (lower-level than tuss4470-golden.test.ts's assembleDatasheet check) so a
// regression here points straight at this file rather than the whole pipeline.
const TUSS_FIXTURE = fileURLToPath(new URL("../fixtures/tuss4470.pdf", import.meta.url));

describe.skipIf(!existsSync(TUSS_FIXTURE))("findTiRegisterMap (real TUSS4470 — Address/0x.. dialect + name trim)", () => {
  it("recognizes the 'Address'-header Table 7-5 shape and returns all 13 clean REG_USER names", async () => {
    const analysis = await analyzePdfFile(TUSS_FIXTURE);
    const table = findTiRegisterMap(analysis.pages);
    expect(table).not.toBeUndefined();
    const byName = Object.fromEntries((table?.registers ?? []).map((r) => [r.name, r.address]));
    expect(byName.BPF_CONFIG_1).toBe("0x10");
    expect(byName.DEV_STAT).toBe("0x1C");
    expect(byName.DEVICE_ID).toBe("0x1D");
    expect(byName.REV_ID).toBe("0x1E");
    expect(table?.registers.length).toBe(13);
    // No leftover glued description prose anywhere in the name list.
    expect(table?.registers.every((r) => /^[A-Z][A-Z0-9_]*$/.test(r.name))).toBe(true);
  });
});
