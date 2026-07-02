// The compact summary analyze_datasheet returns to the model — NOT the full JSON
// (that travels by ref via the driverge://datasheet resource). See wiki:
// parsed-json-handoff-via-handle.

import type { CacheEntry } from "./cache.js";

export function buildSummary(entry: CacheEntry): Record<string, unknown> {
  const { ref, json } = entry;
  const counts =
    json.interface.kind === "register_map"
      ? { registers: json.interface.registers.length }
      : { commands: json.interface.commands.length };

  const proto = json.protocol;
  const protocolSummary = [
    proto.bus,
    proto.addresses?.length ? `addresses ${proto.addresses.join("/")}` : undefined,
    proto.maxClockHz ? `max ${proto.maxClockHz} Hz` : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    ref,
    metadata: {
      part_number: json.metadata.part,
      manufacturer: json.metadata.manufacturer,
      manufacturer_confidence: json.metadata.manufacturerConfidence,
      pdf_type: json.metadata.pdfType,
      page_count: json.metadata.pageCount,
    },
    interface: { kind: json.interface.kind },
    protocol_summary: protocolSummary,
    counts,
    validation: {
      passed: json.validation.valid,
      warnings: json.validation.warnings,
      errors: json.validation.errors,
    },
  };
}
