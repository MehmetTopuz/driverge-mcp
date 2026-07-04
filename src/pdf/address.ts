// Shared register-address recognition/normalization for the register-table
// extractors. A register address cell appears in several vendor forms — "0xF4"
// (Bosch), "00" bare hex (Microchip), "8h"/"10h" (TI), "22" bare hex (ST) — all
// of which normalize to a canonical "0xNN" (min two upper-hex digits). Binary
// columns and ranges deliberately do NOT match, so a "Register address (Binary)"
// or a "2E-34" reserved span is never mistaken for a single register address.

const FORMS: readonly RegExp[] = [
  /^0x([0-9a-f]{1,4})$/i, //   0xF4, 0x00
  /^([0-9a-f]{1,4})h$/i, //    8h, 10h, F4h
  /^([0-9a-f]{1,2})$/i, //     bare 1-2 hex digits: 00, 22, 2A (register offsets)
];

/** Canonicalize a register-address cell to "0xNN", or undefined if it isn't one. */
export function normalizeRegisterAddress(raw: string): string | undefined {
  const s = raw.trim();
  for (const re of FORMS) {
    const m = re.exec(s);
    if (m) {
      const hex = m[1].toUpperCase();
      return `0x${hex.padStart(2, "0")}`;
    }
  }
  return undefined;
}

/** True when a cell reads as a single register address. */
export function isRegisterAddress(raw: string): boolean {
  return normalizeRegisterAddress(raw) !== undefined;
}
