import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DatasheetJson } from "../../src/schema/types";

export function loadFixture(name: string): Record<string, unknown> {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** Wrap a register-table golden ({ registers }) into a full DatasheetJson. */
export function registerDatasheet(goldenName: string, part: string): DatasheetJson {
  const golden = loadFixture(goldenName) as { registers: unknown[] };
  return {
    metadata: {
      part,
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "I2C", addresses: ["0x76"] },
    interface: {
      kind: "register_map",
      registers: golden.registers as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
}

/** The SHT3x golden is already a full DatasheetJson. */
export function commandDatasheet(): DatasheetJson {
  return loadFixture("sht3x.golden.json") as unknown as DatasheetJson;
}

/**
 * Wrap a register-table golden ({ registers }) into a full SPI DatasheetJson —
 * mirrors registerDatasheet() but with protocol.bus "SPI" and no addresses (SPI
 * parts are addressed by CS, not a bus address). Used to pin the combined
 * hal_spi_transfer seam (see decisions: thin-hal-non-negotiable).
 */
export function spiRegisterDatasheet(goldenName: string, part: string): DatasheetJson {
  const golden = loadFixture(goldenName) as { registers: unknown[] };
  return {
    metadata: {
      part,
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "SPI" },
    interface: {
      kind: "register_map",
      registers: golden.registers as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
}

/**
 * Wrap a register-table golden ({ registers }) into a full UART DatasheetJson —
 * mirrors spiRegisterDatasheet but with protocol.bus "UART" and no addresses
 * (UART has no bus address, and — unlike I2C/SPI — no universal register-access
 * primitive: framing is device-specific, so the generated read/write bodies are
 * deliberate TODO(driverge) framing gaps rather than real transfers). Used to pin
 * the hal_uart_write/hal_uart_read seam and the framing_todo reasoning gap
 * (Session B: UART bus family).
 */
export function uartRegisterDatasheet(goldenName: string, part: string): DatasheetJson {
  const golden = loadFixture(goldenName) as { registers: unknown[] };
  return {
    metadata: {
      part,
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "UART" },
    interface: {
      kind: "register_map",
      registers: golden.registers as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  };
}

/**
 * Wrap a register-table golden ({ registers }) into a full CAN DatasheetJson —
 * mirrors uartRegisterDatasheet but with protocol.bus "CAN" and no addresses
 * (CAN parts are addressed by arbitration ID, not a bus device address). Like
 * UART, CAN has no universal register-access primitive over the wire — register/
 * config access is device-specific (CANopen SDO, J1939 PGNs, raw message-ID
 * schemes) — so the generated read/write bodies are deliberate TODO(driverge)
 * framing gaps over the single hal_can_transfer seam function. Used to pin the
 * hal_can_transfer seam and the framing_todo reasoning gap (Session C: CAN bus
 * family, first pass). Cast through `unknown` because "CAN" is not yet a member
 * of the `Bus` union in src/schema/types.ts — that is the coder's job this
 * session; this helper pins the contract the type must grow into.
 */
export function canRegisterDatasheet(goldenName: string, part: string): DatasheetJson {
  const golden = loadFixture(goldenName) as { registers: unknown[] };
  return {
    metadata: {
      part,
      manufacturer: "Test Vendor",
      manufacturerConfidence: 1,
      pdfType: "text_based",
      pageCount: 1,
    },
    protocol: { bus: "CAN" },
    interface: {
      kind: "register_map",
      registers: golden.registers as never,
    },
    validation: { valid: true, errors: [], warnings: [] },
  } as unknown as DatasheetJson;
}

export function hasGcc(): boolean {
  try {
    execSync("gcc --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
