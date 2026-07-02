// L5 — datasheet validator. Deterministic logic checks, per interface kind, that
// gate malformed/incomplete JSON before it reaches the host AI (see wiki:
// validate-before-sending-to-claude). Errors fail validation; warnings do not.

import type { Register } from "../pdf/types.js";
import type { Command, DatasheetJson, ValidationResult } from "./types.js";

const HEX_ONLY = /^0x[0-9a-f]+$/i;

export function validateDatasheet(d: DatasheetJson): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!d.metadata.part) warnings.push("metadata.part is empty");
  if (d.protocol.bus === "unknown") warnings.push("protocol.bus is unknown");

  if (d.interface.kind === "register_map") {
    validateRegisters(d.interface.registers, errors);
  } else {
    validateCommands(d.interface.commands, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateRegisters(registers: Register[], errors: string[]): void {
  if (registers.length === 0) {
    errors.push("register_map has no registers");
    return;
  }

  const addressCount = new Map<string, number>();
  for (const r of registers) {
    // Duplicate single addresses (ranges like "0x88…0xA1" are skipped here).
    if (HEX_ONLY.test(r.address)) {
      addressCount.set(r.address, (addressCount.get(r.address) ?? 0) + 1);
    }

    const occupied = new Array<boolean>(8).fill(false);
    for (const field of r.bitFields) {
      if (field.msb < 0 || field.msb > 7 || field.lsb < 0 || field.lsb > 7) {
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

    if (HEX_ONLY.test(r.reset) && Number.parseInt(r.reset, 16) > 0xff) {
      errors.push(`${r.name}: reset ${r.reset} exceeds the 8-bit register width`);
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
): void {
  if (commands.length === 0) {
    errors.push("command_set has no commands");
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
