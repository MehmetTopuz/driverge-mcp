import { describe, expect, it } from "vitest";
import { extractProseCommands } from "../../src/pdf/prose-commands";

// L4c generalization (Phase 4): the Sensirion-shaped extractors in command.ts
// (extractCommands: "Command Hex Code …", "e.g. 0x…: …") miss command-set
// devices whose commands are only ever named in running prose — e.g. the Aosong
// DHT20, which says "sending the measurement command 0xAC" rather than
// tabulating it. extractProseCommands is a role-based, high-precision TEXT pass:
// a sentence yields a command only when it has BOTH a command cue ("command" /
// "send(ing)") AND a role keyword (trigger/measurement/measure, status, reset),
// so plain mentions of a hex value (an I2C address, an unrelated register) are
// never mistaken for a command. See wiki: cross-vendor-coverage-scorecard.

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

// The real DHT20 datasheet page-10 phrasing (paraphrased into two sentences that
// each carry one command, plus the params sentence that follows the trigger
// command in scan order).
const DHT20_TEXT =
  "After sending the measurement command 0xAC, the MCU must wait until the measurement is completed. " +
  "Before reading the value, get a byte of status word by sending 0x71. " +
  "Wait 10ms to send the 0xAC command (trigger measurement). " +
  "This command parameter has two bytes, the first byte is 0x33, and the second byte is 0x00.";

describe("extractProseCommands", () => {
  it("extracts both DHT20 commands + params, sorted by code, deduped across repeats", () => {
    const result = extractProseCommands([page(DHT20_TEXT)]);
    expect(result).toEqual([
      { name: "status", code: "0x71" },
      { name: "trigger_measurement", code: "0xAC", params: ["0x33", "0x00"] },
    ]);
  });

  it("does not mistake the param bytes (0x33 / 0x00) for standalone commands", () => {
    const result = extractProseCommands([page(DHT20_TEXT)]);
    expect(result.some((c) => c.code === "0x33" || c.code === "0x00")).toBe(false);
  });

  it("false-positive gate: I2C address, status-equality check, and register init are not commands", () => {
    const text =
      "The first byte transmitted includes the 7-bit I²C device address 0x38 and a SDA direction bit. " +
      "If the status word and 0x18 are not equal to 0x18, initialize the 0x1B, 0x1C, 0x1E registers.";
    // 0x38: no cue+role sentence at all. 0x18: role "status" present but no cue
    // ("equal to", "initialize", "registers" are not cues). 0x1B/0x1C/0x1E:
    // "initialize"/"registers" is not a command cue either.
    expect(extractProseCommands([page(text)])).toEqual([]);
  });

  it("a cue without a role, and a role without a cue, are both skipped", () => {
    const text = "Send the data frame to 0x50. The status register lives at address 0x1D.";
    // First sentence: cue "Send" but no role keyword. Second: role "status" but
    // no cue ("register", "lives", "address" are not cues).
    expect(extractProseCommands([page(text)])).toEqual([]);
  });

  it("recognizes the reset role (extensibility beyond DHT20's two roles)", () => {
    const text = "To reset the device, send the command 0xBA.";
    expect(extractProseCommands([page(text)])).toEqual([{ name: "soft_reset", code: "0xBA" }]);
  });
});
