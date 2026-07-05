// The datasheet JSON contract — the frozen interface between the deterministic
// parser and the host AI (see wiki: json-schema-as-contract). The `interface`
// field is a discriminated union on `kind`, which is the primary strategy axis
// (device-class-before-manufacturer). The JSON-Schema mirror lives at
// schemas/datasheet.schema.json.

import type { PdfType, Register } from "../pdf/types.js";

export type Bus = "I2C" | "SPI" | "UART" | "CAN" | "unknown";

export interface DatasheetMetadata {
  part: string;
  manufacturer: string;
  /** 0-1 confidence from L3a manufacturer detection. */
  manufacturerConfidence: number;
  pdfType: PdfType;
  pageCount: number;
}

export interface Protocol {
  bus: Bus;
  /** Bus addresses, e.g. ["0x76", "0x77"]. */
  addresses?: string[];
  maxClockHz?: number;
}

/** A command for a command-set device (see command-set-interface). */
export interface Command {
  name: string;
  /** Hex command word, e.g. "0x2C06". */
  code: string;
  params?: string[];
  /** Number of response words (each usually a data word + CRC). */
  responseWords?: number;
  crc?: { poly: string; init: string; width: number };
}

export interface RegisterInterface {
  kind: "register_map";
  registers: Register[];
}

export interface CommandInterface {
  kind: "command_set";
  commands: Command[];
}

export type DeviceInterface = RegisterInterface | CommandInterface;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * How complete the deterministic extraction of the interface is (see wiki:
 * graceful-degradation). Drives whether an empty/incomplete map is a hard error
 * or a host-AI-completable deferral.
 *
 * - `complete`  — registers with bit-field detail, or a clean command list.
 * - `partial`   — ≥1 register but known-incomplete (e.g. an address-only list
 *                 with no bit fields).
 * - `deferred`  — a register/command section was DETECTED but not auto-extracted;
 *                 the host AI completes it from the datasheet resource.
 * - `none`      — no interface signal at all; a genuine parse failure.
 */
export type ExtractionStatus = "complete" | "partial" | "deferred" | "none";

export interface Extraction {
  status: ExtractionStatus;
  /** 1-based pages where the register-map / command section was detected. */
  detectedPages: number[];
}

/** The full parsed datasheet handed (by ref) to the host AI. */
export interface DatasheetJson {
  metadata: DatasheetMetadata;
  protocol: Protocol;
  interface: DeviceInterface;
  /** Extraction completeness; absent on legacy JSON (treated as `none`). */
  extraction?: Extraction;
  validation: ValidationResult;
}
