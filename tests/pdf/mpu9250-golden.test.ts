import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";

// Regression pins for the MPU-9250 field test (raw/DRIVERGE_ISSUES.md). This
// datasheet is a *Product Specification* (PS-MPU-9250A-01) — the full register
// map lives in a separate Register Map document (RM-MPU-9250A) — so a DEFERRED
// extraction (register sections detected, host completes them) is the correct,
// expected behavior (A1), not a bug. What the field test exposed and this file
// guards against:
//   - A3: metadata.part came back "" (no MPU/ICM part pattern) — now "MPU-9250".
//   - A2/A5: the primary I2C address is written in BINARY ("b110100X" → 0x68/
//     0x69); the old hex-only scan grabbed only 0x0C (the AK8963 magnetometer
//     sub-device) and hardcoded that wrong address. addresses[0] must now be the
//     real device address (0x68), with 0x0C demoted below it.
// These are targeted field assertions (not a full toEqual golden): the register
// map is intentionally deferred, so there is no stable large object to pin.
const FIXTURE = fileURLToPath(new URL("../fixtures/mpu9250.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("MPU-9250 product-spec field regression", () => {
  it("extracts the hyphenated part number (A3)", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.metadata.part).toBe("MPU-9250");
  });

  it("ranks the binary-notation primary I2C address first, demoting the AK8963 sub-address (A2/A5)", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.protocol.bus).toBe("I2C");
    expect(json.protocol.addresses?.[0]).toBe("0x68");
    expect(json.protocol.addresses).toContain("0x69");
    // 0x0C is a real (secondary) sub-device address — kept, but never first.
    const addrs = json.protocol.addresses ?? [];
    expect(addrs.indexOf("0x0C")).toBeGreaterThan(addrs.indexOf("0x68"));
  });

  it("defers the full register map to the host with the detected pages listed (A1)", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.interface.kind).toBe("register_map");
    expect(json.extraction?.status).toBe("deferred");
    expect(json.extraction?.detectedPages.length).toBeGreaterThan(0);
    // A deferral is a warning-level, host-completable state — not a hard failure.
    expect(json.validation.valid).toBe(true);
    // A6: no false "partial / missing bit-field" warning on a deferred (empty) map.
    expect(json.validation.warnings.join(" ")).not.toMatch(/without bit-field/i);
  });
});
