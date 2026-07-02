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

/** 8-bit mask for a [msb:lsb] field. */
export function fieldMask(msb: number, lsb: number): number {
  const width = msb - lsb + 1;
  return (((1 << width) - 1) << lsb) & 0xff;
}

export function hex2(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Macro prefix for a part, e.g. "BME280". */
export function prefixOf(part: string): string {
  return macro(slug(part));
}
