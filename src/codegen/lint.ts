// validate_driver — static lint over the COMPLETED driver files (see wiki:
// mcp-tool-usage-flow, thin-hal-non-negotiable). Complements the generated
// skeleton: it confirms the host AI finished its work (no leftover TODOs), stayed
// on the thin-HAL seam, didn't hallucinate registers/commands, and didn't corrupt
// the deterministic bit-field masks. Pure/text-based — no compiler needed.

import { registerWidth, type Register } from "../pdf/types.js";
import type { Command, DatasheetJson, ValidationResult } from "../schema/types.js";
import { fieldMask, macro, maskHex, prefixOf, slug } from "./ident.js";
import type { GeneratedFile } from "./types.js";

// Vendor peripheral APIs that must NEVER appear in a portable/thin-HAL driver —
// all bus access goes through the hal_* seam instead.
const FORBIDDEN: ReadonlyArray<{ re: RegExp; api: string }> = [
  { re: /\bHAL_(?:I2C|SPI|UART)_\w+/, api: "STM32 CubeHAL" },
  { re: /\bLL_(?:I2C|SPI)_\w+/, api: "STM32 LL" },
  {
    re: /\bi2c_master_\w+|\bspi_device_\w+|\bi2c_cmd_\w+|\buart_write_bytes\w*|\buart_read_bytes\w*|\btwai_\w+/,
    api: "ESP-IDF",
  },
  { re: /\bWire\.\w+|\bSPI\.(?:transfer|begin)\w*/, api: "Arduino" },
];

// Allowed thin-HAL seam functions (families). SPI is a single combined
// <slug>_hal_spi_transfer(tx, rx, len) — one full-duplex call per CS-framed
// transaction — not a hal_spi_write/hal_spi_read pair; those are retired and
// must lint as unknown HAL functions (see decisions: thin-hal-non-negotiable).
// UART (Session B) adds hal_uart_write/hal_uart_read; CAN (Session C) adds the
// single combined hal_can_transfer — any other hal_uart_*/hal_can_* name (e.g.
// a hypothetical hal_uart_flush or hal_can_filter) must still lint as unknown.
//
// Session E (2026-07-11 field-test findings — CAP1206/TUSS4470/FXL6408): every
// seam symbol is now PER-DRIVER PREFIXED (`<slug>_hal_*`, slug =
// slug(json.metadata.part) — see busSeam in portable.ts). A completed driver's
// core is expected to call ITS OWN prefixed family (allowedPrefixed, built per
// lintDriver call from the json argument); a BARE legacy name (no prefix) is
// downgraded to a warning — it still compiles and still works for a
// single-driver project, but collides at link the moment a second Driverge
// driver joins the project (the CAP1206/TUSS4470 field-test failure) — while a
// bare name that was never part of the seam family at all (hal_gpio_set,
// retired hal_spi_write/hal_spi_read, ...) stays a hard error.
const BARE_HAL_ALLOWED =
  /^hal_(?:i2c_(?:read|write)|spi_transfer|uart_(?:write|read)|can_transfer|delay_ms)$/;

/** The PREFIXED family regex for one driver's own seam slug. */
function prefixedHalAllowed(name: string): RegExp {
  return new RegExp(
    `^${name}_hal_(?:i2c_(?:read|write)|spi_transfer|uart_(?:write|read)|can_transfer|delay_ms)$`,
  );
}

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
  // The seam slug — same derivation as busSeam(name)'s caller (portable.ts's
  // generatePortableDriver): slug(json.metadata.part), "device" if empty. Every
  // scan below that recognizes this driver's OWN prefixed seam family is keyed
  // off this, not `prefix` (which is the #define/macro prefix, e.g. "BME280" —
  // a different casing/derivation used for register/command constants only).
  const name = slug(json.metadata.part);
  const all = files.map((f) => `/* ${f.path} */\n${f.content}`).join("\n\n");
  // Comments carry the TODO markers and prose; strip them before code-shape checks.
  // String/char literal BODIES are stripped too (after comments) so a stray brace
  // or paren inside "..." or '...' never throws off the balance check — and, as a
  // side effect, keeps the forbidden-API/hal_*/reference scans from matching text
  // that only appears inside a literal. `all` (TODO detection, #define scans) stays
  // unstripped on purpose.
  const strip = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:\\.|[^"\\])*"/g, " ")
      .replace(/'(?:\\.|[^'\\])*'/g, " ");
  const code = strip(all);
  // Thin-HAL purity applies to the driver CORE, not the seam implementation:
  // a native target's <part>_hal_<target>.c/.h is *where* platform calls (and
  // vendor handle types) belong. Extends to .h/.hpp (Session E): the seam
  // companion header (`<slug>_hal_<target>.h`) declares the *_bind() prototype
  // using vendor types (e.g. i2c_master_bus_handle_t), which would otherwise
  // trip the ESP-IDF FORBIDDEN regex even though it is legitimate seam surface.
  const isHalImpl = (p: string) => /_hal_[a-z0-9]+\.(?:c|cpp|h|hpp)$/i.test(p);
  const coreCode = strip(
    files.filter((f) => !isHalImpl(f.path)).map((f) => f.content).join("\n"),
  );

  // 1. No leftover TODO(driverge) — the host AI must complete every marker.
  const todos = all.match(/TODO\(driverge\)/g);
  if (todos) {
    errors.push(`${todos.length} unfinished TODO(driverge) marker(s) remain`);
  }

  // 2. Parse-sanity: balanced braces/parens (over comment-stripped code).
  if (!balanced(code, "{", "}")) errors.push("unbalanced braces { }");
  if (!balanced(code, "(", ")")) errors.push("unbalanced parentheses ( )");

  // 3. Thin-HAL purity — no vendor peripheral APIs in the core; only the hal_* seam.
  for (const { re, api } of FORBIDDEN) {
    if (re.test(coreCode)) errors.push(`direct ${api} call — bus access must go through the hal_* seam`);
  }
  // 3a. This driver's OWN per-driver-prefixed seam family (`<name>_hal_*`).
  // Matched FIRST and independently of the bare scan below: a word boundary
  // (`\b`) sits right before `name`, not right before "hal_" — this is exactly
  // what lets a mistyped prefixed call (e.g. "cap1206_hal_i2c_wrte") get
  // caught at all. The old bare-only scan (`\bhal_...`) could never see it,
  // because the "_" immediately before "hal_" in a prefixed identifier is a
  // word character, so `\b` never matches there (the CAP1206 field-test blind
  // spot this session fixes).
  const allowedPrefixed = prefixedHalAllowed(name);
  for (const m of coreCode.matchAll(new RegExp(`\\b${name}_hal_[a-z0-9_]+`, "g"))) {
    if (!allowedPrefixed.test(m[0])) {
      errors.push(
        `unknown HAL function "${m[0]}" — thin HAL is ${name}_hal_i2c_*/${name}_hal_spi_*/${name}_hal_uart_*/${name}_hal_can_transfer/${name}_hal_delay_ms only`,
      );
    }
  }
  // 3b. Bare (unprefixed) hal_* calls. A truly bare occurrence never satisfies
  // 3a's `\b${name}_hal_` pattern (there is no "<name>_" immediately before
  // it), so there is no double-count between the two scans. A bare name that
  // IS a legacy-allowed seam function name (hal_i2c_read/write,
  // hal_spi_transfer, hal_uart_write/read, hal_can_transfer, hal_delay_ms)
  // still compiles and works in a single-driver project, so it is only a
  // WARNING — collides at link the moment a second Driverge driver joins the
  // project (see raw/stm32-test-results/*.md). A bare name that was never part
  // of the seam family (hal_gpio_set, retired hal_spi_write/hal_spi_read, ...)
  // stays a hard ERROR, exactly as before.
  for (const m of coreCode.matchAll(/\bhal_[a-z0-9_]+/g)) {
    if (BARE_HAL_ALLOWED.test(m[0])) {
      warnings.push(
        `unprefixed seam symbol — collides in multi-driver projects: "${m[0]}" (prefer ${name}_${m[0]})`,
      );
    } else {
      errors.push(
        `unknown HAL function "${m[0]}" — thin HAL is hal_i2c_*/hal_spi_*/hal_uart_*/hal_can_transfer/hal_delay_ms only`,
      );
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
    const width = registerWidth(r);
    for (const f of r.bitFields) {
      const base = `${prefix}_${macro(r.name)}_${macro(f.name)}`;
      const maskDef = new RegExp(`#define\\s+${base}_MASK\\s+(0x[0-9a-fA-F]+)`).exec(text);
      if (maskDef) {
        const got = Number.parseInt(maskDef[1], 16);
        const want = fieldMask(f.msb, f.lsb, width);
        if (got !== want) {
          errors.push(`${base}_MASK is ${maskDef[1]} but ${r.name}.${f.name} [${f.msb}:${f.lsb}] implies ${maskHex(want, width)}`);
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
