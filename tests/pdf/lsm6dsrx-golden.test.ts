import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/lsm6dsrx.golden.json";

// Hand-verified L0 contract for the LSM6DSRX (ST) register map. Phase 5 wires
// ST's two-stacked-table bit-layout format (src/pdf/st-bit-layout.ts,
// findStBitFields) into the assembled datasheet so registers such as
// CTRL1_XL carry named bit fields (ODR_XL, FS_XL, LPF2_XL_EN, ...) instead of
// an address-only row. This is the scorecard's partial -> complete
// regression for lsm6dsrx.pdf; see wiki: cross-vendor-coverage-scorecard.
//
// NOTE: as of this RED commit, `../fixtures/lsm6dsrx.golden.json` does not
// exist yet — it is generated and hand-verified by the orchestrator only
// AFTER src/pdf/st-bit-layout.ts is implemented and wired into
// assembleDatasheet. Until then this whole file fails to even load (missing
// module), which is the expected RED state alongside the missing-
// implementation failures in st-bit-layout.test.ts.
const FIXTURE = fileURLToPath(new URL("../fixtures/lsm6dsrx.pdf", import.meta.url));

describe.skipIf(!existsSync(FIXTURE))("LSM6DSRX register_map golden", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extraction is complete with named bit fields on CTRL1_XL", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.extraction?.status).toBe("complete");
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind !== "register_map") {
      throw new Error("expected register_map interface");
    }
    const withFields = json.interface.registers.filter(
      (r) => r.bitFields.length > 0,
    );
    expect(withFields.length).toBeGreaterThan(10);
    const ctrl1Xl = json.interface.registers.find((r) => r.name === "CTRL1_XL");
    expect(ctrl1Xl?.bitFields).toContainEqual({ name: "ODR_XL", msb: 7, lsb: 4 });
  });
});
