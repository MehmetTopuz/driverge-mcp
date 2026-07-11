import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/tuss4470.golden.json";

// Hand-verified L0 contract for the TI TUSS4470 (Unit 3, STM32 field-test gap —
// see raw/stm32-test-results/TUSS4470_DRIVERGE_RAPORU.md §3.2). Today
// `analyze_datasheet` already extracts all 13 REG_USER registers (0x10-0x1E)
// with correct addresses, but THREE of the thirteen names carry glued
// description prose: "DEV_STAT Fault status bits", "DEVICE_ID Device ID",
// "REV_ID Revision ID" (confirmed against current src with the real PDF — see
// scratch investigation below for the exact root cause).
//
// Derived from a raw pdfjs positioned-text dump (page 23's "Table 7-5.
// REG_USER Registers"), NOT a visual PDF read.
//
// Root cause (worth recording — a naive read of the report alone doesn't
// explain WHY only 3 of 13 come back dirty): today's 13 registers come from
// src/pdf/generic-register-table.ts's ROLE-based fallback, not
// src/pdf/ti-register-map.ts — findTiRegisterMap's own `isHeader` requires the
// literal token "Offset" and its `OFFSET` regex only accepts bare-hex+"h"
// ("10h"); TUSS4470's Table 7-5 header reads "Address" (not "Offset") and its
// address cells already print "0x10" (not "10h"), so findTiRegisterMap never
// even recognizes this table's header, and assembleDatasheet's chain falls all
// the way through to the generic fallback. There, BOTH the "Acronym" column
// (x≈111) AND the "Register Name" description column (x≈269) normalize to the
// SAME "name" role (see generic-register-table.ts's ROLE_NAME regex matching
// both "acronym" and "register name"), so nearestCol glues whichever column a
// row's description text is geometrically closest to into the name. This
// happens to land on "other" (dropped) for 10 of 13 rows because a MERGED
// header band accidentally absorbs the "Table 7-5. REG_USER Registers" title
// line into the header (findHeader's forward-merge is anchored to the START
// row's y, not a rolling anchor, so it over-merges one row too many), injecting
// a spurious extra "other"-role column whose center happens to sit just right
// of "Register Name"'s — SHORT descriptions ("Fault status bits", "Device ID",
// "Revision ID") land left of that split point (still "name"), while LONGER
// ones ("Bandpass filter settings", "Log-amp configuration", ...) land right
// of it ("other", dropped) — a geometric coincidence, not a rule, which is
// exactly why a length-independent, symbolic trim rule (below) is the right
// fix rather than a column-geometry patch.
//
// This golden pins the EXPECTED shape once ti-register-map.ts is widened to
// recognize the "Address"-header + "0x.."-address TI variant (see the new
// cases in ti-register-map.test.ts) — routing through the acronym-first
// parser sidesteps the role-collision bug entirely, and a conservative trim
// rule (also pinned there) additionally guards against a datasheet where the
// Acronym cell itself arrives as ONE glued pdfjs item.
//
// Bit-field scope (orchestrator decision, revised from this file's first
// draft): routing TUSS4470 through findTiRegisterMap fires its pre-existing
// findTiFieldDescriptions enrichment over the per-register "Table 7-N.
// <ACRONYM> Register Field Descriptions" sections (Tables 7-7..7-19, pages
// 24-29 — one per register). TUSS4470 writes multi-bit ranges with a COLON
// ("5:0", "4:2") where TMAG5170 uses a hyphen ("14-12"); with the original
// hyphen-only BIT regex the enrichment would silently DROP every colon-range
// field while still picking up bare single-digit cells — a misleading
// "complete" over a partial, format-dependent bit list. Rather than pin that
// contamination (or suppress the enrichment), the colon dialect is fixed
// in-scope: ti-field-descriptions.ts's BIT regex accepts "msb:lsb" alongside
// "msb-lsb" (synthetic pin: the colon-dialect case in
// ti-field-descriptions.test.ts). This golden therefore pins the HONEST
// complete contract: all 38 named bit fields across the 13 registers,
// hand-derived from a raw pdfjs dump of pages 24-29 and cross-checked against
// the field report's §3.2 ground truth (RESERVED rows excluded per the
// extractor's contract; `reset` stays "" — the enrichment reads bit geometry,
// not the field tables' Reset column).
//
// Skips on a fresh clone/machine lacking the git-ignored fixture PDF (see
// tests/fixtures/README.md).
const FIXTURE = fileURLToPath(new URL("../fixtures/tuss4470.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("TUSS4470 golden register map (TI Table 7-5, name cleanup)", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extracts 13 clean REG_USER register names, no glued description prose", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));

    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }

    const registers = json.interface.registers;
    expect(registers.length).toBe(13);

    expect(registers.map((r) => r.name)).toEqual([
      "BPF_CONFIG_1",
      "BPF_CONFIG_2",
      "DEV_CTRL_1",
      "DEV_CTRL_2",
      "DEV_CTRL_3",
      "VDRV_CTRL",
      "ECHO_INT_CONFIG",
      "ZC_CONFIG",
      "BURST_PULSE",
      "TOF_CONFIG",
      "DEV_STAT",
      "DEVICE_ID",
      "REV_ID",
    ]);
    expect(registers.map((r) => r.address)).toEqual([
      "0x10",
      "0x11",
      "0x12",
      "0x13",
      "0x14",
      "0x16",
      "0x17",
      "0x18",
      "0x1A",
      "0x1B",
      "0x1C",
      "0x1D",
      "0x1E",
    ]);

    // None of the three previously-dirty names retain their glued prose tail.
    const byAddress = (address: string) => registers.find((r) => r.address === address);
    expect(byAddress("0x1C")?.name).not.toMatch(/fault|status bits/i);
    expect(byAddress("0x1D")?.name).not.toMatch(/device id$/i); // exact "DEVICE_ID" only
    expect(byAddress("0x1E")?.name).not.toMatch(/revision/i);
  });

  it("detects part/manufacturer/bus and reports complete extraction", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.metadata.part).toBe("TUSS4470");
    expect(json.metadata.manufacturer).toBe("Texas Instruments");
    expect(json.protocol.bus).toBe("SPI");
    expect(json.extraction?.status).toBe("complete");
  });

  it("enriches all 13 registers with their colon-dialect field tables (38 named fields)", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }
    const registers = json.interface.registers;

    // Every register has its own "Table 7-N" field section — none stay empty.
    expect(registers.every((r) => r.bitFields.length > 0)).toBe(true);
    expect(registers.reduce((n, r) => n + r.bitFields.length, 0)).toBe(38);

    const byAddress = (address: string) => registers.find((r) => r.address === address);

    // Colon multi-bit ranges parse as [msb:lsb] (the exact cells the
    // hyphen-only regex used to drop): "5:0", "4:2", "7:0".
    expect(byAddress("0x10")?.bitFields).toContainEqual({ name: "BPF_HPF_FREQ", msb: 5, lsb: 0 });
    expect(byAddress("0x14")?.bitFields).toEqual([
      { name: "DRV_PLS_FLT_DT", msb: 4, lsb: 2 },
      { name: "IO_MODE", msb: 1, lsb: 0 },
    ]);
    expect(byAddress("0x1D")?.bitFields).toEqual([{ name: "DEVICE_ID", msb: 7, lsb: 0 }]);

    // Bare single-digit cells keep working alongside the colon dialect.
    expect(byAddress("0x1C")?.bitFields).toEqual([
      { name: "VDRV_READY", msb: 3, lsb: 3 },
      { name: "PULSE_NUM_FLT", msb: 2, lsb: 2 },
      { name: "DRV_PULSE_FLT", msb: 1, lsb: 1 },
      { name: "EE_CRC_FLT", msb: 0, lsb: 0 },
    ]);

    // RESERVED rows never surface as named fields.
    expect(registers.some((r) => r.bitFields.some((f) => /^reserved$/i.test(f.name)))).toBe(false);
  });
});
