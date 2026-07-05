// Glue: run the L3/L4 extractors over an analyzed PDF and assemble the frozen
// DatasheetJson contract, then validate it (L5). This is the single place the
// scattered pipeline stages (manufacturer, interface-kind, register table,
// command/protocol/CRC extraction) come together into the object handed to the
// host AI by ref. See wiki: json-schema-as-contract, mcp-tool-usage-flow.

import { extractCommands, extractProtocol } from "../pdf/command.js";
import { findGenericRegisterTable } from "../pdf/generic-register-table.js";
import { detectInterfaceKind, detectSections } from "../pdf/interface-kind.js";
import { detectManufacturer } from "../pdf/manufacturer.js";
import { findMaximRegisterMap } from "../pdf/maxim-register-map.js";
import { detectPart } from "../pdf/part.js";
import { extractProseCommands } from "../pdf/prose-commands.js";
import { findRegisterTable } from "../pdf/register-table.js";
import { findStBitFields } from "../pdf/st-bit-layout.js";
import { findTiRegisterMap } from "../pdf/ti-register-map.js";
import type { InterfaceKind, PageContent, PdfAnalysis } from "../pdf/types.js";
import type { DatasheetJson, DeviceInterface, Extraction } from "./types.js";
import { validateDatasheet } from "./validate.js";

function buildInterface(pages: PageContent[], kind: string): DeviceInterface {
  if (kind === "command_set") {
    let commands = extractCommands(pages);
    if (commands.length === 0) commands = extractProseCommands(pages);
    return { kind: "command_set", commands };
  }
  // register_map (and "unknown", treated register-first). Try the BME280/
  // Microchip bit-table extractor, then the TI register-summary adapter, then the
  // role-based generic extractor (raises the deterministic floor for unseen vendor
  // table shapes — see generic-register-table). Each runs only when the prior found
  // nothing, so the specialized adapters (and their goldens) are never affected.
  let registers = findRegisterTable(pages)?.registers ?? [];
  if (registers.length === 0) {
    registers = findTiRegisterMap(pages)?.registers ?? [];
  }
  // Maxim's register-matrix shape (see maxim-register-map): tried after TI's
  // summary-table adapter and before the role-based generic fallback, same
  // slot pattern as every prior specialized adapter in this chain.
  if (registers.length === 0) {
    registers = findMaximRegisterMap(pages)?.registers ?? [];
  }
  if (registers.length === 0) {
    registers = findGenericRegisterTable(pages)?.registers ?? [];
    // Enrich with ST's two-stacked-table bit-layout format (see
    // st-bit-layout): a name-only match against the generic table's rows, so
    // non-ST datasheets (an empty map) leave the address-only registers
    // untouched.
    if (registers.length > 0) {
      const stFields = findStBitFields(pages);
      if (stFields.size > 0) {
        for (const r of registers) {
          const bf = stFields.get(r.name);
          if (bf) r.bitFields = bf;
        }
      }
    }
  }
  // Only reclassify as a command set when nothing register-like was found.
  if (registers.length === 0 && kind === "unknown") {
    const commands = extractCommands(pages);
    if (commands.length > 0) return { kind: "command_set", commands };
  }
  return { kind: "register_map", registers };
}

/**
 * Classify how complete the deterministic extraction is (see wiki:
 * graceful-degradation). An empty map is a *deferral* (host-AI-completable) rather
 * than a failure whenever there's positive evidence of that interface — a detected
 * section, or the kind classifier landing on it — and only `none` (a hard error)
 * when there is no signal at all.
 */
export function deriveExtraction(
  iface: DeviceInterface,
  sections: { registerPages: number[]; commandPages: number[] },
  kind: InterfaceKind,
  busKnown: boolean,
): Extraction {
  // An empty map defers (host-AI-completable) whenever there's ANY interface
  // signal — a detected section, a concrete kind, or even a detected bus (a part
  // with a known I2C/SPI bus almost certainly has registers/commands we just
  // couldn't parse). Only a truly signal-less PDF is `none` (a hard error).
  if (iface.kind === "register_map") {
    if (iface.registers.length === 0) {
      const detectedPages = sections.registerPages;
      const deferred =
        detectedPages.length > 0 || kind === "register_map" || busKnown;
      return { status: deferred ? "deferred" : "none", detectedPages };
    }
    const hasBits = iface.registers.some((r) => r.bitFields.length > 0);
    return {
      status: hasBits ? "complete" : "partial",
      detectedPages: sections.registerPages,
    };
  }
  if (iface.commands.length === 0) {
    const detectedPages = sections.commandPages;
    const deferred =
      detectedPages.length > 0 || kind === "command_set" || busKnown;
    return { status: deferred ? "deferred" : "none", detectedPages };
  }
  return { status: "complete", detectedPages: sections.commandPages };
}

/**
 * Optional overrides for the host AI to steer assembly when its own reading of
 * the datasheet disagrees with (or supplements) the deterministic detectors —
 * see Session 10 / Contract A. Both are opt-in; omitting `opts` entirely is
 * byte-identical to today's behavior.
 */
export interface AssembleOpts {
  /**
   * Manufacturer name to use as a "hint"-style fallback. Applied ONLY when
   * detectManufacturer lands on the generic default (no confident vendor) — a
   * confident detection always wins and the hint is silently ignored. When
   * applied, manufacturerConfidence is pinned to 0.5 (a hint is more than
   * nothing but less than a confident deterministic match).
   */
  manufacturerHint?: string;
  /**
   * Forces the interface kind used for BOTH buildInterface and
   * deriveExtraction, overriding detectInterfaceKind's classification.
   */
  interfaceKindHint?: "register_map" | "command_set";
}

/** Assemble + validate the datasheet contract from a completed PDF analysis. */
export function assembleDatasheet(
  analysis: PdfAnalysis,
  opts?: AssembleOpts,
): DatasheetJson {
  const { pages } = analysis;
  const manufacturer = detectManufacturer(pages);
  const kind = opts?.interfaceKindHint ?? detectInterfaceKind(pages).kind;
  const iface = buildInterface(pages, kind);
  const protocol = extractProtocol(pages);

  const manufacturerHint =
    manufacturer.manufacturer === "generic" ? opts?.manufacturerHint : undefined;

  const partial = {
    metadata: {
      part: detectPart(pages),
      manufacturer: manufacturerHint ?? manufacturer.manufacturer,
      manufacturerConfidence: manufacturerHint !== undefined ? 0.5 : manufacturer.confidence,
      pdfType: analysis.type,
      pageCount: analysis.pageCount,
    },
    protocol,
    interface: iface,
    extraction: deriveExtraction(
      iface,
      detectSections(pages),
      kind,
      protocol.bus !== "unknown",
    ),
  };

  const validation = validateDatasheet({
    ...partial,
    validation: { valid: true, errors: [], warnings: [] },
  });

  return { ...partial, validation };
}
