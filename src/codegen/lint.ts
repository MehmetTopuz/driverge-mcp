// validate_driver — static lint over the COMPLETED driver files (see wiki:
// mcp-tool-usage-flow, thin-hal-non-negotiable). Complements the generated
// skeleton: it confirms the host AI finished its work (no leftover TODOs), stayed
// on the thin-HAL seam, didn't hallucinate registers/commands, and didn't corrupt
// the deterministic bit-field masks. Pure/text-based — no compiler needed.

import type { Register } from "../pdf/types.js";
import type { Command, DatasheetJson, ValidationResult } from "../schema/types.js";
import { fieldMask, hex2, macro, prefixOf } from "./ident.js";
import type { GeneratedFile } from "./types.js";

// Vendor peripheral APIs that must NEVER appear in a portable/thin-HAL driver —
// all bus access goes through the hal_* seam instead.
const FORBIDDEN: ReadonlyArray<{ re: RegExp; api: string }> = [
  { re: /\bHAL_(?:I2C|SPI|UART)_\w+/, api: "STM32 CubeHAL" },
  { re: /\bLL_(?:I2C|SPI)_\w+/, api: "STM32 LL" },
  { re: /\bi2c_master_\w+|\bspi_device_\w+|\bi2c_cmd_\w+/, api: "ESP-IDF" },
  { re: /\bWire\.\w+|\bSPI\.(?:transfer|begin)\w*/, api: "Arduino" },
];

// Allowed thin-HAL seam functions (families).
const HAL_ALLOWED = /^hal_(?:i2c_(?:read|write)|spi_(?:read|write)|delay_ms)$/;

function balanced(text: string, open: string, close: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Static validation of a completed driver against its source datasheet JSON. */
export function lintDriver(
  files: GeneratedFile[],
  json: DatasheetJson,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = prefixOf(json.metadata.part);
  const all = files.map((f) => `/* ${f.path} */\n${f.content}`).join("\n\n");
  // Comments carry the TODO markers and prose; strip them before code-shape checks.
  const code = all.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  // 1. No leftover TODO(driverge) — the host AI must complete every marker.
  const todos = all.match(/TODO\(driverge\)/g);
  if (todos) {
    errors.push(`${todos.length} unfinished TODO(driverge) marker(s) remain`);
  }

  // 2. Parse-sanity: balanced braces/parens (over comment-stripped code).
  if (!balanced(code, "{", "}")) errors.push("unbalanced braces { }");
  if (!balanced(code, "(", ")")) errors.push("unbalanced parentheses ( )");

  // 3. Thin-HAL purity — no vendor peripheral APIs; only the hal_* seam.
  for (const { re, api } of FORBIDDEN) {
    if (re.test(code)) errors.push(`direct ${api} call — bus access must go through the hal_* seam`);
  }
  for (const m of code.matchAll(/\bhal_[a-z0-9_]+/g)) {
    if (!HAL_ALLOWED.test(m[0])) {
      errors.push(`unknown HAL function "${m[0]}" — thin HAL is hal_i2c_*/hal_spi_*/hal_delay_ms only`);
    }
  }

  // 4. Register/command reference existence: any PREFIX_REG_* / PREFIX_CMD_* used
  //    in code must be defined (in the header) — catches hallucinated symbols.
  const defined = new Set<string>();
  for (const m of all.matchAll(/#define\s+([A-Z0-9_]+)/g)) defined.add(m[1]);
  const refRe = new RegExp(`\\b${prefix}_(?:REG|CMD)_[A-Z0-9_]+`, "g");
  const referenced = new Set<string>();
  for (const m of code.matchAll(refRe)) referenced.add(m[0]);
  for (const ref of referenced) {
    if (!defined.has(ref)) errors.push(`undefined register/command constant "${ref}"`);
  }

  // 5. Bit-field mask/shift consistency with the JSON geometry.
  if (json.interface.kind === "register_map") {
    checkMasks(json.interface.registers, prefix, all, errors);
  } else {
    checkCommandCodes(json.interface.commands, prefix, all, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function checkMasks(
  registers: Register[],
  prefix: string,
  text: string,
  errors: string[],
): void {
  for (const r of registers) {
    for (const f of r.bitFields) {
      const base = `${prefix}_${macro(r.name)}_${macro(f.name)}`;
      const maskDef = new RegExp(`#define\\s+${base}_MASK\\s+(0x[0-9a-fA-F]+)`).exec(text);
      if (maskDef) {
        const got = Number.parseInt(maskDef[1], 16);
        const want = fieldMask(f.msb, f.lsb);
        if (got !== want) {
          errors.push(`${base}_MASK is ${maskDef[1]} but ${r.name}.${f.name} [${f.msb}:${f.lsb}] implies ${hex2(want)}`);
        }
      }
      const shiftDef = new RegExp(`#define\\s+${base}_SHIFT\\s+(\\d+)`).exec(text);
      if (shiftDef && Number(shiftDef[1]) !== f.lsb) {
        errors.push(`${base}_SHIFT is ${shiftDef[1]} but ${r.name}.${f.name} lsb is ${f.lsb}`);
      }
    }
  }
}

function checkCommandCodes(
  commands: Command[],
  prefix: string,
  text: string,
  warnings: string[],
): void {
  for (const c of commands) {
    const def = new RegExp(`#define\\s+${prefix}_CMD_${macro(c.name)}\\s+(0x[0-9a-fA-F]+)`).exec(text);
    if (def && def[1].toUpperCase() !== c.code.toUpperCase()) {
      warnings.push(`${prefix}_CMD_${macro(c.name)} is ${def[1]} but JSON code is ${c.code}`);
    }
  }
}
