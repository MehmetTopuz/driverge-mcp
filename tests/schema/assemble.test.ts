import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { assembleDatasheet } from "../../src/schema/assemble";

const bme280 = fileURLToPath(new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url));
const sht3x = fileURLToPath(new URL("../fixtures/sht3x-datasheet.pdf", import.meta.url));

describe.skipIf(!existsSync(bme280))("assembleDatasheet — BME280 (register_map)", () => {
  it("assembles a validated register-map contract from the pipeline", async () => {
    const json = assembleDatasheet(await analyzePdfFile(bme280));
    expect(json.metadata.part).toBe("BME280");
    expect(json.metadata.manufacturer).toBe("Bosch Sensortec");
    expect(json.interface.kind).toBe("register_map");
    if (json.interface.kind === "register_map") {
      expect(json.interface.registers.length).toBeGreaterThan(5);
      expect(json.interface.registers.some((r) => r.name === "id")).toBe(true);
    }
    expect(json.validation.valid).toBe(true);
  });
});

describe.skipIf(!existsSync(sht3x))("assembleDatasheet — SHT3x (command_set)", () => {
  it("assembles a validated command-set contract from the pipeline", async () => {
    const json = assembleDatasheet(await analyzePdfFile(sht3x));
    expect(json.metadata.manufacturer).toBe("Sensirion");
    expect(json.interface.kind).toBe("command_set");
    expect(json.protocol.bus).toBe("I2C");
    if (json.interface.kind === "command_set") {
      expect(json.interface.commands.length).toBeGreaterThan(0);
    }
  });
});
