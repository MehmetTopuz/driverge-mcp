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

  it("propagates the deferred skeleton to the esp32 target for a SPI part too, now that esp32 supports SPI (former B1 regression pin)", () => {
    const e = generateEsp32Driver(deferredRegister);
    expect(e.files.some((f) => /TODO\(driverge\)/.test(f.content))).toBe(true);
    expect(e.fill_in_brief.register_map_todo).toBeTruthy();
    expect(e.files.some((f) => f.path.endsWith("_hal_esp32.c"))).toBe(true);
  });

  // Session B: esp32 gained native UART support, so UART is no longer the
  // "genuinely unsupported" bus used to mirror-pin the refusal — "unknown" is
  // (see tests/codegen/esp32.test.ts's describe.each(["unknown"]) refusal pin).
  it("still refuses a genuinely unsupported bus (unknown) on esp32, deferred or not (B1 mirror pin)", () => {
    const deferredUnknown: DatasheetJson = {
      ...deferredRegister,
      protocol: { bus: "unknown" },
    };
    expect(() => generateEsp32Driver(deferredUnknown)).toThrow(UnsupportedBusError);
    let caught: unknown;
    try {
      generateEsp32Driver(deferredUnknown);
    } catch (err) {
      caught = err;
    }
    const message = (caught as Error).message;
    expect(message).toMatch(/unknown/);
    expect(message).toMatch(/portable/);
  });

  it("propagates the deferred skeleton to the esp32 target for a UART part too, now that esp32 supports UART (Session B)", () => {
    const deferredUartI2cShaped: DatasheetJson = {
      ...deferredRegister,
      protocol: { bus: "UART" },
    };
    const e = generateEsp32Driver(deferredUartI2cShaped);
    expect(e.files.some((f) => /TODO\(driverge\)/.test(f.content))).toBe(true);
    expect(e.fill_in_brief.register_map_todo).toBeTruthy();
    expect(e.fill_in_brief.framing_todo).toBeTruthy();
    expect(e.files.some((f) => f.path.endsWith("_hal_esp32.c"))).toBe(true);
  });
});

describe("generatePortableDriver — deferred register map (UART, Session B)", () => {
  // A deferred UART part has BOTH reasoning gaps at once: the register map
  // itself wasn't auto-extracted (register_map_todo), AND UART's framing must be
  // implemented by the host AI even once registers are known (framing_todo).
  // Neither gap subsumes the other, so both must be present together.
  const deferredUart: DatasheetJson = {
    metadata: {
      part: "MHZ19",
      manufacturer: "Winsen",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 20,
    },
    protocol: { bus: "UART" },
    interface: { kind: "register_map", registers: [] },
    extraction: { status: "deferred", detectedPages: [9] },
    validation: { valid: true, errors: [], warnings: ["register map deferred"] },
  };
  const art = generatePortableDriver(deferredUart);
  const header = art.files[0].content;

  it("still renders the UART seam even with an empty register map", () => {
    expect(header).toContain("void hal_uart_write(const uint8_t *data, uint16_t len);");
    expect(header).toContain(
      "uint16_t hal_uart_read(uint8_t *data, uint16_t len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_/);
  });

  it("emits a register-map TODO(driverge) block naming the detected page", () => {
    expect(header).toContain("TODO(driverge)");
    expect(header).toMatch(/register map/i);
    expect(header).toContain("9");
  });

  it("carries BOTH register_map_todo and framing_todo in the fill-in brief", () => {
    expect(art.fill_in_brief.register_map_todo).toBeTruthy();
    expect(art.fill_in_brief.framing_todo).toBeTruthy();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_write");
    expect(art.fill_in_brief.framing_todo).toContain("hal_uart_read");
  });
});

// Session C: CAN twin of the UART deferred describe block above. A deferred CAN
// part ALSO carries both reasoning gaps at once (register_map_todo AND
// framing_todo), and — new this session — propagates correctly to the esp32
// native target now that esp32 gained TWAI support (STM32 still refuses CAN
// entirely; see tests/codegen/stm32.test.ts's describe.each(["CAN", "unknown"])).
describe("generatePortableDriver — deferred register map (CAN, Session C)", () => {
  // Cast through `unknown`: "CAN" is not yet a member of the `Bus` union
  // (src/schema/types.ts) — that is the coder's job this session.
  const deferredCan = {
    metadata: {
      part: "CANTEMP",
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 20,
    },
    protocol: { bus: "CAN" },
    interface: { kind: "register_map", registers: [] },
    extraction: { status: "deferred", detectedPages: [11] },
    validation: { valid: true, errors: [], warnings: ["register map deferred"] },
  } as unknown as DatasheetJson;
  const art = generatePortableDriver(deferredCan);
  const header = art.files[0].content;

  it("still renders the CAN seam even with an empty register map", () => {
    expect(header).toContain(
      "int hal_can_transfer(uint32_t id, const uint8_t *tx, uint8_t tx_len, uint8_t *rx, uint8_t *rx_len, uint32_t timeout_ms);",
    );
    expect(header).not.toMatch(/hal_i2c_|hal_spi_|hal_uart_/);
  });

  it("emits a register-map TODO(driverge) block naming the detected page", () => {
    expect(header).toContain("TODO(driverge)");
    expect(header).toMatch(/register map/i);
    expect(header).toContain("11");
  });

  it("carries BOTH register_map_todo and framing_todo in the fill-in brief", () => {
    expect(art.fill_in_brief.register_map_todo).toBeTruthy();
    expect(art.fill_in_brief.framing_todo).toBeTruthy();
    expect(art.fill_in_brief.framing_todo).toMatch(/frame/i);
    expect(art.fill_in_brief.framing_todo).toContain("hal_can_transfer");
  });

  it("propagates the deferred skeleton to the esp32 target for a CAN part too (Session C native CAN/TWAI support)", () => {
    const e = generateEsp32Driver(deferredCan);
    expect(e.files.some((f) => /TODO\(driverge\)/.test(f.content))).toBe(true);
    expect(e.fill_in_brief.register_map_todo).toBeTruthy();
    expect(e.fill_in_brief.framing_todo).toBeTruthy();
    expect(e.files.some((f) => f.path.endsWith("_hal_esp32.c"))).toBe(true);
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
