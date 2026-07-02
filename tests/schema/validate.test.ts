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
