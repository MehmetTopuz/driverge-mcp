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
}

export interface DriverArtifact {
  files: GeneratedFile[];
  fill_in_brief: FillInBrief;
}
