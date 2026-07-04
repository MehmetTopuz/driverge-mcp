import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateDriver } from "../../src/codegen";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { detectSections } from "../../src/pdf/interface-kind";
import { assembleDatasheet, deriveExtraction } from "../../src/schema/assemble";
import type { InterfaceKind, PageContent } from "../../src/pdf/types";
import type { DeviceInterface } from "../../src/schema/types";

// Never-fail graceful degradation (see wiki: graceful-degradation). A register /
// command section that is DETECTED but not auto-extracted is a *deferral*, not a
// failure — the two pure helpers below decide that, and are unit-tested here.

const page = (index: number, text: string): PageContent => ({
  index,
  text,
  items: [],
  hasImage: false,
});

const reg = (
  name: string,
  address: string,
  bitFields: { name: string; msb: number; lsb: number }[] = [],
) => ({ name, address, reset: "", bitFields });

const rmap = (registers: ReturnType<typeof reg>[]): DeviceInterface => ({
  kind: "register_map",
  registers,
});
const cset = (commands: { name: string; code: string }[]): DeviceInterface => ({
  kind: "command_set",
  commands,
});
const sections = (registerPages: number[], commandPages: number[]) => ({
  registerPages,
  commandPages,
});

describe("detectSections", () => {
  it("records the pages carrying a register-map section heading", () => {
    const s = detectSections([
      page(1, "General description of the device"),
      page(7, "7 Register map — the following registers are available"),
      page(8, "continued register descriptions"),
    ]);
    expect(s.registerPages).toContain(7);
    expect(s.commandPages).toEqual([]);
  });

  it("records the pages carrying a command section heading", () => {
    const s = detectSections([page(3, "Table 9: list of commands for the sensor")]);
    expect(s.commandPages).toContain(3);
  });
});

describe("deriveExtraction", () => {
  it("is `complete` when registers carry bit-field detail", () => {
    const e = deriveExtraction(
      rmap([reg("ctrl", "0x10", [{ name: "a", msb: 1, lsb: 0 }])]),
      sections([5], []),
      "register_map",
      true,
    );
    expect(e.status).toBe("complete");
  });

  it("is `partial` when registers have no bit fields (address-only list)", () => {
    const e = deriveExtraction(
      rmap([reg("ctrl", "0x10"), reg("stat", "0x11")]),
      sections([5], []),
      "register_map",
      true,
    );
    expect(e.status).toBe("partial");
  });

  it("is `deferred` when a register section was detected but nothing extracted", () => {
    const e = deriveExtraction(rmap([]), sections([9, 10], []), "unknown", false);
    expect(e.status).toBe("deferred");
    expect(e.detectedPages).toEqual([9, 10]);
  });

  it("is `deferred` from the interface kind even with no captured section pages", () => {
    const e = deriveExtraction(cset([]), sections([], []), "command_set", false);
    expect(e.status).toBe("deferred");
  });

  it("is `deferred` from a detected bus alone (no section, unknown kind)", () => {
    const e = deriveExtraction(rmap([]), sections([], []), "unknown", true);
    expect(e.status).toBe("deferred");
  });

  it("is `none` when there is no interface signal at all", () => {
    const e = deriveExtraction(
      rmap([]),
      sections([], []),
      "unknown" as InterfaceKind,
      false,
    );
    expect(e.status).toBe("none");
  });

  it("is `complete` for a non-empty command set", () => {
    const e = deriveExtraction(
      cset([{ name: "reset", code: "0x30A2" }]),
      sections([], [3]),
      "command_set",
      false,
    );
    expect(e.status).toBe("complete");
  });
});

// End-to-end over a real fixture whose table format Driverge can't yet parse: the
// pipeline must DEFER (not hard-fail) and codegen must still emit a completable
// skeleton. Skips on a fresh clone lacking the git-ignored PDF.
const AEAT = fileURLToPath(
  new URL("../fixtures/AEAT-8811-Q24_DS.pdf", import.meta.url),
);

describe.skipIf(!existsSync(AEAT))(
  "graceful degradation — real deferred fixture (AEAT-8811)",
  () => {
    it("defers instead of hard-failing and generates a completable skeleton", async () => {
      const json = assembleDatasheet(await analyzePdfFile(AEAT));
      expect(json.extraction?.status).toBe("deferred");
      expect(json.validation.valid).toBe(true);
      expect(json.validation.errors).toEqual([]);

      const art = generateDriver(json, "portable");
      expect(art.files.some((f) => /TODO\(driverge\)/.test(f.content))).toBe(true);
      expect(art.fill_in_brief.register_map_todo).toBeTruthy();
    });
  },
);
