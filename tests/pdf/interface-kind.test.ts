import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePdfFile } from "../../src/pdf/analyze";
import { detectInterfaceKind } from "../../src/pdf/interface-kind";

const page = (text: string) => ({ index: 1, text, items: [], hasImage: false });

describe("detectInterfaceKind", () => {
  it("classifies register-map devices from keywords", () => {
    const r = detectInterfaceKind([
      page("Global memory map and register description. See the register map table."),
    ]);
    expect(r.kind).toBe("register_map");
  });

  it("classifies command-set devices from command/CRC keywords", () => {
    const r = detectInterfaceKind([
      page(
        "Send a 16-bit command word to the sensor. See the Commands table. Each response word is followed by a CRC-8 checksum. Clock stretching is supported.",
      ),
    ]);
    expect(r.kind).toBe("command_set");
  });

  it("returns unknown when there are no interface signals", () => {
    const r = detectInterfaceKind([
      page("Introduction and general description of the product."),
    ]);
    expect(r.kind).toBe("unknown");
  });
});

const FIXTURE = fileURLToPath(
  new URL("../fixtures/bst-bme280-ds002.pdf", import.meta.url),
);

describe.skipIf(!existsSync(FIXTURE))("detectInterfaceKind (real BME280)", () => {
  it("classifies BME280 as register_map", async () => {
    const analysis = await analyzePdfFile(FIXTURE);
    const r = detectInterfaceKind(analysis.pages);
    expect(r.kind).toBe("register_map");
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});

const MCP = fileURLToPath(
  new URL("../fixtures/mcp23017-datasheet.pdf", import.meta.url),
);

describe.skipIf(!existsSync(MCP))("detectInterfaceKind (real MCP23017)", () => {
  it("classifies MCP23017 as register_map", async () => {
    const analysis = await analyzePdfFile(MCP);
    const r = detectInterfaceKind(analysis.pages);
    expect(r.kind).toBe("register_map");
  });
});
