// The datasheet JSON contract — the frozen interface between the deterministic
// parser and the host AI (see wiki: json-schema-as-contract). The `interface`
// field is a discriminated union on `kind`, which is the primary strategy axis
// (device-class-before-manufacturer). The JSON-Schema mirror lives at
// schemas/datasheet.schema.json.

import type { PdfType, Register } from "../pdf/types.js";

export type Bus = "I2C" | "SPI" | "UART" | "unknown";

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

/** The full parsed datasheet handed (by ref) to the host AI. */
export interface DatasheetJson {
  metadata: DatasheetMetadata;
  protocol: Protocol;
  interface: DeviceInterface;
  validation: ValidationResult;
}
