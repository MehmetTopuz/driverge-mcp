import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";
import golden from "../fixtures/dht20.golden.json";

// Hand-verified L0 contract for the DHT20 (Aosong) command_set device. Phase 4
// generalizes command extraction beyond the Sensirion-only tabulated path
// (extractCommands) with a prose pass (extractProseCommands) so this device's
// two commands — trigger_measurement (0xAC, with the 2-byte parameter the
// datasheet spells out in prose) and status (0x71) — are captured. This is the
// scorecard's deferred -> complete regression for 5193_DHT20.pdf; see wiki:
// cross-vendor-coverage-scorecard.
//
// NOTE: as of this RED commit, `../fixtures/dht20.golden.json` does not exist
// yet — it is generated and hand-verified by the orchestrator only AFTER
// src/pdf/prose-commands.ts is implemented and wired into assembleDatasheet.
// Until then this whole file fails to even load (missing module), which is the
// expected RED state alongside the missing-implementation failures below.
const FIXTURE = fileURLToPath(
  new URL("../fixtures/5193_DHT20.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("DHT20 command_set golden", () => {
  it("assembled datasheet matches the committed golden JSON", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json).toEqual(golden);
  });

  it("extraction is complete with both commands and the trigger command's params", async () => {
    const json = assembleDatasheet(await analyzePdfFile(FIXTURE));
    expect(json.extraction?.status).toBe("complete");
    expect(json.interface.kind).toBe("command_set");
    if (json.interface.kind !== "command_set") {
      throw new Error("expected command_set interface");
    }
    expect(json.interface.commands.length).toBe(2);
    const trigger = json.interface.commands.find(
      (c) => c.name === "trigger_measurement",
    );
    expect(trigger?.params).toEqual(["0x33", "0x00"]);
    // Phase 4b: the DHT20 datasheet's prose CRC section ("the initial value of
    // CRC is 0XFF" + the "1+X 4 +X 5 +X 8" polynomial expression) must now be
    // captured and attached to the measurement command, not status.
    expect(trigger?.crc).toEqual({ poly: "0x31", init: "0xFF", width: 8 });
  });
});
