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

export function hasGcc(): boolean {
  try {
    execSync("gcc --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
