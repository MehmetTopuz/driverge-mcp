import { describe, expect, it } from "vitest";
import { validateDatasheet } from "../../src/schema/validate";

const base = {
  metadata: {
    part: "TEST",
    manufacturer: "Bosch Sensortec",
    manufacturerConfidence: 1,
    pdfType: "text_based" as const,
    pageCount: 60,
  },
  protocol: { bus: "I2C" as const, addresses: ["0x76", "0x77"] },
  validation: { valid: true, errors: [], warnings: [] },
};

const reg = (
  name: string,
  address: string,
  reset: string,
  bitFields: { name: string; msb: number; lsb: number }[] = [],
) => ({ name, address, reset, bitFields });
const bf = (name: string, msb: number, lsb: number) => ({ name, msb, lsb });

const registerDs = (registers: ReturnType<typeof reg>[]) =>
  ({ ...base, interface: { kind: "register_map" as const, registers } });
const commandDs = (commands: { name: string; code: string }[]) =>
  ({ ...base, interface: { kind: "command_set" as const, commands } });

describe("validateDatasheet — register_map", () => {
  it("accepts a well-formed register map", () => {
    const r = validateDatasheet(
      registerDs([
        reg("ctrl_meas", "0xF4", "0x00", [
          bf("osrs_t", 7, 5),
          bf("osrs_p", 4, 2),
          bf("mode", 1, 0),
        ]),
        reg("id", "0xD0", "0x60", [bf("chip_id", 7, 0)]),
      ]),
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("flags duplicate register addresses", () => {
    const r = validateDatasheet(
      registerDs([reg("a", "0xF4", "0x00"), reg("b", "0xF4", "0x00")]),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate.*0xF4/i);
  });

  it("flags overlapping bitfields", () => {
    const r = validateDatasheet(
      registerDs([reg("x", "0x10", "0x00", [bf("a", 7, 4), bf("b", 5, 0)])]),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/more than one|bit 5/i);
  });

  it("flags msb < lsb", () => {
    const r = validateDatasheet(
      registerDs([reg("x", "0x10", "0x00", [bf("a", 2, 5)])]),
    );
    expect(r.valid).toBe(false);
  });

  it("flags a reset value that exceeds the 8-bit register width", () => {
    const r = validateDatasheet(registerDs([reg("x", "0x10", "0x1FF")]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/reset/i);
  });

  it("errors on an empty register map", () => {
    const r = validateDatasheet(registerDs([]));
    expect(r.valid).toBe(false);
  });
});

describe("validateDatasheet — command_set", () => {
  const cmd = (name: string, code: string, extra: object = {}) =>
    ({ name, code, ...extra });

  it("accepts a well-formed command set", () => {
    const r = validateDatasheet(
      commandDs([
        cmd("measure", "0x2C06", {
          responseWords: 2,
          crc: { poly: "0x31", init: "0xFF", width: 8 },
        }),
      ]),
    );
    expect(r.valid).toBe(true);
  });

  it("flags duplicate command codes", () => {
    const r = validateDatasheet(
      commandDs([cmd("a", "0x2C06"), cmd("b", "0x2C06")]),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate.*0x2C06/i);
  });

  it("warns (does not fail) when CRC / response length are missing", () => {
    const r = validateDatasheet(commandDs([cmd("a", "0x2C06")]));
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("errors on an empty command set", () => {
    const r = validateDatasheet(commandDs([]));
    expect(r.valid).toBe(false);
  });
});

describe("validateDatasheet — register width (8/16/32-bit)", () => {
  const wreg = (
    width: number,
    bitFields: { name: string; msb: number; lsb: number }[] = [],
    reset = "0x00",
  ) => ({ name: "cfg", address: "0x00", reset, bitFields, width });

  it("accepts a 16-bit register with a [15:8] bit field", () => {
    const r = validateDatasheet(registerDs([wreg(16, [bf("hi", 15, 8)])]));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a bit index beyond the register width (msb 16 on a 16-bit register)", () => {
    const r = validateDatasheet(registerDs([wreg(16, [bf("x", 16, 8)])]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/out of range/i);
  });

  it("accepts reset 0x1FF on a 16-bit register but rejects it on the default 8-bit", () => {
    expect(validateDatasheet(registerDs([wreg(16, [], "0x1FF")])).valid).toBe(true);
    expect(validateDatasheet(registerDs([reg("c", "0x00", "0x1FF")])).valid).toBe(false);
  });

  it("rejects a reset that exceeds the 16-bit register width (0x1FFFF)", () => {
    const r = validateDatasheet(registerDs([wreg(16, [], "0x1FFFF")]));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/16-bit/);
  });

  it("rejects an invalid register width (12)", () => {
    expect(validateDatasheet(registerDs([wreg(12, [])])).valid).toBe(false);
  });
});

describe("validateDatasheet — graceful degradation (extraction status)", () => {
  const withExtraction = (
    iface: object,
    extraction: { status: string; detectedPages: number[] },
  ) => ({ ...base, interface: iface, extraction }) as never;

  it("treats an empty register map as a deferral (warning, not error) when a section was detected", () => {
    const r = validateDatasheet(
      withExtraction(
        { kind: "register_map", registers: [] },
        { status: "deferred", detectedPages: [12] },
      ),
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/deferred|not auto-extracted|host AI|complete it/i);
  });

  it("keeps an empty register map with no signal a hard error", () => {
    const r = validateDatasheet(
      withExtraction(
        { kind: "register_map", registers: [] },
        { status: "none", detectedPages: [] },
      ),
    );
    expect(r.valid).toBe(false);
  });

  it("treats an empty command set deferral as a warning, not an error", () => {
    const r = validateDatasheet(
      withExtraction(
        { kind: "command_set", commands: [] },
        { status: "deferred", detectedPages: [4] },
      ),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("warns (does not fail) on a partial address-only register map", () => {
    const r = validateDatasheet(
      withExtraction(
        {
          kind: "register_map",
          registers: [{ name: "cfg", address: "0x00", reset: "", bitFields: [] }],
        },
        { status: "partial", detectedPages: [33] },
      ),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/partial|bit field|without/i);
  });
});
