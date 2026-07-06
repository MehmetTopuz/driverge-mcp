// Codegen contract types. A driver artifact is the deterministic skeleton the
// server renders (see wiki: hybrid-codegen-skeleton-plus-host-reasoning): concrete
// files plus a fill_in_brief telling the host AI which TODO(driverge) markers to
// complete. Targets beyond "portable" arrive in Sessions 7-8.

export type CodegenTarget = "portable" | "stm32" | "esp32" | "arduino";

export const CODEGEN_TARGETS: readonly CodegenTarget[] = [
  "portable",
  "stm32",
  "esp32",
  "arduino",
];

/**
 * Output language flavor (Session D). "c" (default) is today's thin-HAL C
 * skeleton, byte-identical across every target/bus. "cpp" renders the SAME
 * #define macro constants and the SAME extern "C" hal_* seam wrapped in a
 * class (.hpp/.cpp instead of .h/.c) — see wiki: thin-hal-non-negotiable,
 * platform-specific-codegen.
 */
export type CodegenLanguage = "c" | "cpp";

export const CODEGEN_LANGUAGES: readonly CodegenLanguage[] = ["c", "cpp"];

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Reasoning gaps the host AI must fill; keys mirror the wiki tool contract. */
export interface FillInBrief {
  init_sequence_todo: string;
  quirks_todo: string;
  doc_todo: string;
  /** Present only for command-set devices with a CRC. */
  crc_todo?: string;
  /** Present for native targets whose HAL seam needs board bring-up. */
  hal_setup_todo?: string;
  /** Present when extraction was deferred: the host AI must enumerate the register map. */
  register_map_todo?: string;
  /** Present when extraction was deferred: the host AI must enumerate the command set. */
  command_set_todo?: string;
  /** Present for UART parts: the host AI must implement the device's frame protocol over the seam. */
  framing_todo?: string;
}

export interface DriverArtifact {
  files: GeneratedFile[];
  fill_in_brief: FillInBrief;
}

/** arduino lands in a later session; portable + esp32 + stm32 render today. */
export class UnsupportedTargetError extends Error {
  constructor(public readonly target: string) {
    super(
      `codegen target "${target}" is not available yet — supported targets: portable, esp32, stm32`,
    );
    this.name = "UnsupportedTargetError";
  }
}

/**
 * Thrown by a native target (esp32, stm32) when the datasheet's protocol bus
 * isn't one its HAL seam implements. Native targets implement I2C and SPI seams;
 * any other bus (UART, unknown) has no seam yet and would produce uncompilable
 * output, so the generator refuses instead. The portable target has no such
 * constraint and still works for every bus.
 */
export class UnsupportedBusError extends Error {
  constructor(
    public readonly target: string,
    public readonly bus: string,
  ) {
    super(
      `codegen target "${target}" does not support ${bus} parts yet — use the "portable" target for ${bus} parts`,
    );
    this.name = "UnsupportedBusError";
  }
}
