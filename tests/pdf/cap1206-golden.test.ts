import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/cap1206.golden.json";

// Hand-verified L0 contract for the Microchip CAP1206 (Unit 3, STM32 field-test
// gap — see raw/stm32-test-results/CAP1206-report.md). Today `analyze_datasheet`
// returns extraction "partial" with only 4 of 55 registers (Main Control 0x00,
// General Status 0x02, Sensor Input Status 0x03, Noise Flag Status 0x0A — all
// with reset: "" even though Table 5-1 prints a Default Value column), because
// findGenericRegisterTable only ever reads the FIRST page (page 3, per today's
// detectedPages) that clears its MIN_ROWS floor and never accumulates the
// table's continuation pages — confirmed against current src with the real PDF.
//
// This golden was derived from a raw pdfjs positioned-text dump, NOT a visual
// PDF read (see max30102-golden.test.ts's own history note for why that
// matters). Key findings from the dump, worth flagging since they contradict a
// naive reading of the plan/report:
//
//   - TABLE 5-1: REGISTER SET IN HEXADECIMAL ORDER is a SIX-column table
//     (Register Address | R/W | Register Name | Function | Default Value |
//     Page) — not the four-column Address/Register/R-W/Default shape the plan
//     doc sketches. The extra "Function" (prose description) and "Page"
//     (cross-reference) columns are ignored here; only Address/Register
//     Name/Default Value are pinned, matching the task's stated scope
//     ("bit detail lives in later sections and is OUT of scope" — Function
//     prose is exactly that later-section pointer, not bit detail, but is
//     likewise not part of this contract).
//   - The table spans THREE pages (21, 22, 23 — confirmed via "TABLE 5-1: ...
//     (CONTINUED)" captions repeating the same 6-column header band on each),
//     with counts 18 + 18 + 19 = 55 registers, matching report §4's "55
//     registers, 0x00-0xFF" total exactly.
//   - All 55 rows land bit-field-free by design (Table 5-1 has no bit columns
//     at all — bit detail lives in the per-register Table 5-2..5-51 sections,
//     explicitly out of scope per the task). `bitFields: []` throughout,
//     `extraction.status: "partial"`.
//   - A HANDFUL of Register Name cells wrap across two physical pdfjs text
//     lines with the two lines landing in REVERSED reading order relative to
//     which line carries the register's own address (e.g. 0x22's row anchors
//     on "Configuration" while "Sensor Input" sits on the line ABOVE it) —
//     confirmed via a raw x/y item dump (not assumed): "Sensor Input
//     Configuration" (0x22), "Sensor Input Configuration 2" (0x23), "Power
//     Button Configuration" (0x61), "Sensor Input Calibration LSB 1" (0xB9),
//     "Sensor Input Calibration LSB 2" (0xBA). Every wrap in this table joins
//     top-line-then-bottom-line with a single space, in y order — never x
//     order, since two DIFFERENT lines' fragments can land within a few px of
//     each other horizontally (mirrors the wrap-reconstruction precedent in
//     maxim-register-map.ts's gatherChain/mergeSplitTitles).
//   - Addresses print as bare-hex + "h" ("00h", "0Ah", "B1h") — normalized here
//     to the schema's "0xNN" form via the SAME convention register-table.ts
//     already applies to MCP23017's bare-hex addresses (see normalizeAddress).
//     Reset/Default Value cells print the same "NNh" idiom ("00h", "3Fh",
//     "C8h") and normalize the same way — NOT the "1111 1111" binary idiom
//     normalizeReset handles elsewhere in this table (Table 5-1's Default
//     Value column is always hex, per the dump).
//
// Skips on a fresh clone/machine lacking the git-ignored fixture PDF (see
// tests/fixtures/README.md).
const FIXTURE = fileURLToPath(new URL("../fixtures/cap1206.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("CAP1206 golden register map (Microchip Table 5-1)", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extracts the full 55-register set spanning all three continuation pages (supersedes today's 4/55)", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));

    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }

    const registers = json.interface.registers;
    expect(registers.length).toBe(55);
    expect(registers.every((r) => r.bitFields.length === 0)).toBe(true);

    const byAddress = (address: string) => registers.find((r) => r.address === address);

    // Spot-pin the 8 key registers from report §4.
    expect(byAddress("0x00")).toEqual({
      name: "Main Control",
      address: "0x00",
      reset: "0x00",
      bitFields: [],
    });
    expect(byAddress("0x02")?.name).toBe("General Status");
    expect(byAddress("0x03")?.name).toBe("Sensor Input Status");
    expect(byAddress("0x20")).toEqual({
      name: "Configuration",
      address: "0x20",
      reset: "0x20",
      bitFields: [],
    });
    expect(byAddress("0x21")).toEqual({
      name: "Sensor Input Enable",
      address: "0x21",
      reset: "0x3F",
      bitFields: [],
    });
    expect(byAddress("0x27")).toEqual({
      name: "Interrupt Enable",
      address: "0x27",
      reset: "0x3F",
      bitFields: [],
    });
    expect(byAddress("0xFD")).toEqual({
      name: "Product ID",
      address: "0xFD",
      reset: "0x67",
      bitFields: [],
    });
    expect(byAddress("0xFE")).toEqual({
      name: "Manufacturer ID",
      address: "0xFE",
      reset: "0x5D",
      bitFields: [],
    });

    // Cross-line wrapped names reconstructed in y-order (see file header).
    expect(byAddress("0x22")?.name).toBe("Sensor Input Configuration");
    expect(byAddress("0x23")?.name).toBe("Sensor Input Configuration 2");
    expect(byAddress("0x61")?.name).toBe("Power Button Configuration");
    expect(byAddress("0xB9")?.name).toBe("Sensor Input Calibration LSB 1");
    expect(byAddress("0xBA")?.name).toBe("Sensor Input Calibration LSB 2");

    // No RESERVED filler or duplicate rows escape.
    expect(registers.some((r) => /^reserved$/i.test(r.name))).toBe(false);
    expect(new Set(registers.map((r) => r.address)).size).toBe(55);
  });

  it("reports partial extraction (no bit-field detail in Table 5-1) and detects part/manufacturer", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.extraction?.status).toBe("partial");
    expect(json.metadata.part).toBe("CAP1206");
    expect(json.metadata.manufacturer).toBe("Microchip");
  });
});
