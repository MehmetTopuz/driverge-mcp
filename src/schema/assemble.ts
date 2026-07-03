// Glue: run the L3/L4 extractors over an analyzed PDF and assemble the frozen
// DatasheetJson contract, then validate it (L5). This is the single place the
// scattered pipeline stages (manufacturer, interface-kind, register table,
// command/protocol/CRC extraction) come together into the object handed to the
// host AI by ref. See wiki: json-schema-as-contract, mcp-tool-usage-flow.

import { extractCommands, extractProtocol } from "../pdf/command.js";
import { detectInterfaceKind } from "../pdf/interface-kind.js";
import { detectManufacturer } from "../pdf/manufacturer.js";
import { detectPart } from "../pdf/part.js";
import { findRegisterTable } from "../pdf/register-table.js";
import { findTiRegisterMap } from "../pdf/ti-register-map.js";
import type { PageContent, PdfAnalysis } from "../pdf/types.js";
import type { DatasheetJson, DeviceInterface } from "./types.js";
import { validateDatasheet } from "./validate.js";

function buildInterface(pages: PageContent[], kind: string): DeviceInterface {
  if (kind === "command_set") {
    return { kind: "command_set", commands: extractCommands(pages) };
  }
  // register_map (and "unknown", treated register-first). Try the BME280/
  // Microchip bit-table extractor, then fall back to the TI register-summary
  // adapter for that vendor's format.
  let registers = findRegisterTable(pages)?.registers ?? [];
  if (registers.length === 0) {
    registers = findTiRegisterMap(pages)?.registers ?? [];
  }
  // Only reclassify as a command set when nothing register-like was found.
  if (registers.length === 0 && kind === "unknown") {
    const commands = extractCommands(pages);
    if (commands.length > 0) return { kind: "command_set", commands };
  }
  return { kind: "register_map", registers };
}

/** Assemble + validate the datasheet contract from a completed PDF analysis. */
export function assembleDatasheet(analysis: PdfAnalysis): DatasheetJson {
  const { pages } = analysis;
  const manufacturer = detectManufacturer(pages);
  const kind = detectInterfaceKind(pages).kind;

  const partial = {
    metadata: {
      part: detectPart(pages),
      manufacturer: manufacturer.manufacturer,
      manufacturerConfidence: manufacturer.confidence,
      pdfType: analysis.type,
      pageCount: analysis.pageCount,
    },
    protocol: extractProtocol(pages),
    interface: buildInterface(pages, kind),
  };

  const validation = validateDatasheet({
    ...partial,
    validation: { valid: true, errors: [], warnings: [] },
  });

  return { ...partial, validation };
}
