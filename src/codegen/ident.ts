// Shared naming/geometry helpers so codegen and the driver lint agree on exactly
// how a part name and its fields become C identifiers and mask values.

export const HEX_ONLY = /^0x[0-9a-f]+$/i;

/** Lower-snake identifier safe for filenames/symbols; "device" when empty. */
export function slug(part: string): string {
  const s = part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "device";
}

/** UPPER token safe for a macro fragment. */
export function macro(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Mask for a [msb:lsb] field within a `regWidth`-bit register. Computed
 * arithmetically so it is correct up to 32 bits (no 32-bit shift overflow); for
 * valid 8-bit fields it equals the historical `& 0xff` result (e.g. 7:5 → 0xE0).
 */
export function fieldMask(msb: number, lsb: number, regWidth = 8): number {
  const bits = msb - lsb + 1;
  const mask = (2 ** bits - 1) * 2 ** lsb;
  return mask % 2 ** regWidth;
}

export function hex2(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Hex literal padded to a register width's digit count (8→2, 16→4, 32→8). */
export function maskHex(n: number, regWidth = 8): string {
  return `0x${n.toString(16).toUpperCase().padStart(regWidth / 4, "0")}`;
}

/**
 * Neutralizes C block-comment delimiters in free text lifted verbatim from a
 * parsed datasheet (e.g. `metadata.manufacturer`, a `Register.name`) before it
 * is embedded inside a generated `/* ... *\/` block comment. Without this, text
 * containing `*\/` closes the enclosing comment early and whatever follows
 * becomes live, uncommented source — a comment-escape injection (B2). Splits
 * both delimiters ("* /" and "/ *") so the string can neither close an
 * existing comment nor open a bogus one; still reads fine as prose either way.
 */
export function commentSafe(s: string): string {
  return s.replace(/\*\//g, "* /").replace(/\/\*/g, "/ *");
}

/** Macro prefix for a part, e.g. "BME280". */
export function prefixOf(part: string): string {
  return macro(slug(part));
}

/**
 * PascalCase a lower-snake slug for a C++ class name, e.g. "bme280" -> "Bme280",
 * "tmag5170" -> "Tmag5170". Used only by the cpp codegen flavor (Session D); the
 * C flavor has no class, so this never touches C output.
 */
export function pascalCase(s: string): string {
  return s
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
