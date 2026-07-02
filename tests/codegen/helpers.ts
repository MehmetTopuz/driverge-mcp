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

export function hasGcc(): boolean {
  try {
    execSync("gcc --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
