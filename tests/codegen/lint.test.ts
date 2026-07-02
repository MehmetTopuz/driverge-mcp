import { describe, expect, it } from "vitest";
import { generatePortableDriver } from "../../src/codegen/portable";
import { lintDriver } from "../../src/codegen/lint";
import type { GeneratedFile } from "../../src/codegen/types";
import { registerDatasheet } from "./helpers";

const json = registerDatasheet("bme280.golden.json", "BME280");
const skeleton = generatePortableDriver(json).files;

// Simulate a host AI that finished its work: drop the TODO(driverge) markers.
// Everything else in the skeleton is already valid, thin-HAL-pure C.
function completed(): GeneratedFile[] {
  return skeleton.map((f) => ({
    path: f.path,
    content: f.content.replace(/TODO\(driverge\)/g, "done"),
  }));
}

function withSource(mutate: (c: string) => string): GeneratedFile[] {
  return completed().map((f) =>
    f.path.endsWith(".c") ? { path: f.path, content: mutate(f.content) } : f,
  );
}

describe("lintDriver", () => {
  it("passes a completed, thin-HAL-pure driver", () => {
    const r = lintDriver(completed(), json);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("rejects the raw skeleton (leftover TODO(driverge) markers)", () => {
    const r = lintDriver(skeleton, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/TODO\(driverge\)/);
  });

  it("rejects a direct vendor peripheral call (STM32 CubeHAL)", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "HAL_I2C_Master_Transmit(0,0,0,0,0);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/CubeHAL|hal_\* seam/);
  });

  it("rejects an Arduino Wire call", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "Wire.write(0);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/Arduino/);
  });

  it("rejects an unknown HAL function outside the thin seam", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "hal_gpio_set(1);\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/hal_gpio_set/);
  });

  it("rejects a reference to an undefined register constant", () => {
    const r = lintDriver(
      withSource((c) => c.replace("return 0;", "(void)BME280_REG_BOGUS;\n    return 0;")),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/BME280_REG_BOGUS/);
  });

  it("rejects a corrupted bit-field mask", () => {
    const bad = completed().map((f) =>
      f.path.endsWith(".h")
        ? { path: f.path, content: f.content.replace("BME280_CTRL_MEAS_OSRS_T_MASK  0xE0", "BME280_CTRL_MEAS_OSRS_T_MASK  0x00") }
        : f,
    );
    const r = lintDriver(bad, json);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/OSRS_T_MASK/);
  });

  it("rejects unbalanced braces", () => {
    const r = lintDriver(
      withSource((c) => `${c}\nint stray(void) {`),
      json,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/braces/);
  });
});
