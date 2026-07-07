// L5 — datasheet validator. Deterministic logic checks, per interface kind, that
// gate malformed/incomplete JSON before it reaches the host AI (see wiki:
// validate-before-sending-to-claude). Errors fail validation; warnings do not.

import { registerWidth, type Register } from "../pdf/types.js";
import type {
  Command,
  DatasheetJson,
  ExtractionStatus,
  ValidationResult,
} from "./types.js";

const HEX_ONLY = /^0x[0-9a-f]+$/i;
const VALID_WIDTHS = new Set([8, 16, 32]);

const detectedOn = (pages: number[]): string =>
  pages.length > 0 ? ` (page(s) ${pages.join(", ")})` : "";

export function validateDatasheet(d: DatasheetJson): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!d.metadata.part) warnings.push("metadata.part is empty");
  if (d.protocol.bus === "unknown") warnings.push("protocol.bus is unknown");

  const status = d.extraction?.status;
  const pages = d.extraction?.detectedPages ?? [];

  if (d.interface.kind === "register_map") {
    validateRegisters(d.interface.registers, errors, warnings, status, pages);
  } else {
    validateCommands(d.interface.commands, errors, warnings, status, pages);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateRegisters(
  registers: Register[],
  errors: string[],
  warnings: string[],
  status: ExtractionStatus | undefined,
  pages: number[],
): void {
  if (registers.length === 0) {
    // A detected-but-unparsed map is a host-AI-completable deferral, not a failure
    // (see wiki: graceful-degradation); only a true no-signal map is an error.
    if (status === "deferred") {
      warnings.push(
        `register map detected${detectedOn(pages)} but not auto-extracted — the host AI must complete it from the datasheet resource`,
      );
    } else {
      errors.push("register_map has no registers");
    }
    return;
  }

  // Warn on ACTUAL content, not the extraction.status field (A6, see
  // raw/DRIVERGE_ISSUES.md): a host-completed map that already carries bit
  // fields must not be warned just because status still reads "partial". Fire
  // only when no register has any bit field — the true "addresses without
  // bit-field detail" condition. (For freshly-assembled data this matches the
  // status:"partial" case exactly, since deriveExtraction sets that iff no
  // register has bits — see schema/assemble deriveExtraction.)
  if (!registers.some((r) => r.bitFields.length > 0)) {
    warnings.push(
      "register map is partial — addresses extracted without bit-field detail; the host AI should add bit fields from the datasheet",
    );
  }

  const addressCount = new Map<string, number>();
  for (const r of registers) {
    // Duplicate single addresses (ranges like "0x88…0xA1" are skipped here).
    if (HEX_ONLY.test(r.address)) {
      addressCount.set(r.address, (addressCount.get(r.address) ?? 0) + 1);
    }

    if (r.width !== undefined && !VALID_WIDTHS.has(r.width)) {
      errors.push(`${r.name}: invalid register width ${r.width} (expected 8, 16, or 32)`);
    }
    const width = registerWidth(r);

    const occupied = new Array<boolean>(width).fill(false);
    for (const field of r.bitFields) {
      if (
        field.msb < 0 ||
        field.msb > width - 1 ||
        field.lsb < 0 ||
        field.lsb > width - 1
      ) {
        errors.push(
          `${r.name}.${field.name}: bit index out of range (${field.msb}:${field.lsb})`,
        );
        continue;
      }
      if (field.msb < field.lsb) {
        errors.push(
          `${r.name}.${field.name}: msb < lsb (${field.msb}:${field.lsb})`,
        );
        continue;
      }
      for (let b = field.lsb; b <= field.msb; b++) {
        if (occupied[b]) {
          errors.push(`${r.name}: bit ${b} claimed by more than one field`);
        }
        occupied[b] = true;
      }
    }

    if (HEX_ONLY.test(r.reset) && Number.parseInt(r.reset, 16) > 2 ** width - 1) {
      errors.push(`${r.name}: reset ${r.reset} exceeds the ${width}-bit register width`);
    }
  }

  for (const [address, count] of addressCount) {
    if (count > 1) {
      errors.push(`duplicate register address ${address} (${count}x)`);
    }
  }
}

function validateCommands(
  commands: Command[],
  errors: string[],
  warnings: string[],
  status: ExtractionStatus | undefined,
  pages: number[],
): void {
  if (commands.length === 0) {
    if (status === "deferred") {
      warnings.push(
        `command set detected${detectedOn(pages)} but not auto-extracted — the host AI must complete it from the datasheet resource`,
      );
    } else {
      errors.push("command_set has no commands");
    }
    return;
  }

  const codeCount = new Map<string, number>();
  for (const c of commands) {
    if (!HEX_ONLY.test(c.code)) {
      errors.push(`${c.name}: invalid command code "${c.code}"`);
    } else {
      codeCount.set(c.code, (codeCount.get(c.code) ?? 0) + 1);
    }
    if (c.responseWords === undefined) {
      warnings.push(`${c.name}: response length not declared`);
    }
    if (!c.crc) {
      warnings.push(`${c.name}: CRC parameters missing`);
    }
  }

  for (const [code, count] of codeCount) {
    if (count > 1) {
      errors.push(`duplicate command code ${code} (${count}x)`);
    }
  }
}
