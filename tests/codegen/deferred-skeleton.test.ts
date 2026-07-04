import { describe, expect, it } from "vitest";
import { UnsupportedBusError } from "../../src/codegen";
import { generateEsp32Driver } from "../../src/codegen/esp32";
import { generatePortableDriver } from "../../src/codegen/portable";
import type { DatasheetJson } from "../../src/schema/types";

// When extraction is `deferred`, codegen must NOT refuse or emit an empty file — it
// emits a compiling skeleton with a TODO(driverge) register-map/command block for the
// host AI to complete from the datasheet resource (see wiki: graceful-degradation).

const deferredRegister: DatasheetJson = {
  metadata: {
    part: "AEAT8811",
    manufacturer: "Broadcom",
    manufacturerConfidence: 1,
    pdfType: "text_based",
    pageCount: 40,
  },
  protocol: { bus: "SPI" },
  interface: { kind: "register_map", registers: [] },
  extraction: { status: "deferred", detectedPages: [23] },
  validation: { valid: true, errors: [], warnings: ["register map deferred"] },
};

// I2C twin of deferredRegister, used to exercise esp32 deferred-propagation now
// that generateEsp32Driver refuses SPI parts (see B1 mirror pin below) — the
// deferred-propagation contract itself is bus-agnostic, so it needs an I2C part
// to observe on a native I2C-only target.
const deferredRegisterI2c: DatasheetJson = {
  metadata: {
    part: "PCA9555",
    manufacturer: "NXP",
    manufacturerConfidence: 1,
    pdfType: "text_based",
    pageCount: 24,
  },
  protocol: { bus: "I2C", addresses: ["0x20"] },
  interface: { kind: "register_map", registers: [] },
  extraction: { status: "deferred", detectedPages: [12] },
  validation: { valid: true, errors: [], warnings: ["register map deferred"] },
};

const deferredCommand: DatasheetJson = {
  metadata: {
    part: "DHT20",
    manufacturer: "Aosong",
    manufacturerConfidence: 1,
    pdfType: "text_based",
    pageCount: 12,
  },
  protocol: { bus: "I2C", addresses: ["0x38"] },
  interface: { kind: "command_set", commands: [] },
  extraction: { status: "deferred", detectedPages: [8] },
  validation: { valid: true, errors: [], warnings: ["command set deferred"] },
};

function balanced(text: string, open: string, close: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth++;
    else if (ch === close && --depth < 0) return false;
  }
  return depth === 0;
}

describe("generatePortableDriver — deferred register map", () => {
  const art = generatePortableDriver(deferredRegister);
  const header = art.files[0].content;
  const source = art.files[1].content;

  it("emits a register-map TODO(driverge) block naming the detected page", () => {
    expect(header).toContain("TODO(driverge)");
    expect(header).toMatch(/register map/i);
    expect(header).toContain("23");
  });

  it("still emits the thin-HAL seam and the read/write register stubs", () => {
    expect(header).toContain("void hal_delay_ms (uint32_t ms);");
    expect(source).toContain("aeat8811_read_register");
    expect(source).toContain("aeat8811_write_register");
  });

  it("adds a register_map_todo to the fill-in brief", () => {
    expect(art.fill_in_brief.register_map_todo).toBeTruthy();
    expect(art.fill_in_brief.register_map_todo).toMatch(/AEAT8811|register/i);
  });

  it("produces brace/paren-balanced files (compile-shape)", () => {
    for (const f of art.files) {
      expect(balanced(f.content, "{", "}")).toBe(true);
      expect(balanced(f.content, "(", ")")).toBe(true);
    }
  });

  it("propagates the deferred skeleton to the esp32 target (I2C part)", () => {
    const e = generateEsp32Driver(deferredRegisterI2c);
    expect(e.files.some((f) => /TODO\(driverge\)/.test(f.content))).toBe(true);
    expect(e.fill_in_brief.register_map_todo).toBeTruthy();
  });

  it("refuses the SPI deferred part on esp32 instead of an I2C-only seam (B1 mirror pin)", () => {
    expect(() => generateEsp32Driver(deferredRegister)).toThrow(UnsupportedBusError);
    let caught: unknown;
    try {
      generateEsp32Driver(deferredRegister);
    } catch (err) {
      caught = err;
    }
    const message = (caught as Error).message;
    expect(message).toMatch(/SPI/);
    expect(message).toMatch(/portable/);
  });
});

describe("generatePortableDriver — deferred command set", () => {
  const art = generatePortableDriver(deferredCommand);
  const header = art.files[0].content;

  it("emits a command TODO(driverge) block and a command_set_todo brief", () => {
    expect(header).toContain("TODO(driverge)");
    expect(header).toMatch(/command/i);
    expect(art.fill_in_brief.command_set_todo).toBeTruthy();
  });
});
