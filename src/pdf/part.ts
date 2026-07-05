// L3 (metadata) — best-effort part-number extraction. The part number recurs in
// every page header/footer, so the most frequently matched vendor part token is
// a strong, deterministic signal. Degrades to "" (validator then warns) rather
// than guessing. Only used for naming/metadata — never for register geometry.

import type { PageContent } from "./types.js";

// Full part tokens per vendor family (broader than manufacturer.ts's prefix-only
// signals, which exist just to score a vendor). Ordered most-specific first.
const PART_PATTERNS: readonly RegExp[] = [
  /\bBM[EPAI]\d{3}\b/gi, // BME280, BMP280, BMA...
  /\bMCP\d{4,5}[A-Z]?\b/gi, // MCP23017, MCP23S17
  /\bSHT\d{1,2}[A-Za-z]?\b/gi, // SHT3x, SHT31
  /\b(?:SCD|SGP)\d{2,3}[A-Za-z]?\b/gi, // SCD40, SGP30
  /\b(?:LIS|LSM)\d[A-Z0-9]{2,}\b/gi, // LIS3DH, LSM6DS3
  /\bSTM32[A-Z]\d[A-Z0-9]+\b/gi,
  /\b(?:PCA|PCF)\d{3,4}[A-Z]?\b/gi, // PCA9555
  /\b(?:TCA|SN65|SN74|ADS)\d{3,4}[A-Z]?\b/gi,
  /\bTMAG\d{4}\b/gi, // TMAG5170
  /\b(?:DHT|AHT)\d{2}\b/gi, // DHT20, AHT20
  /\bAEAT-?\d{3,4}\b/gi, // AEAT-8811
  /\bTLE\d{4}[A-Z0-9]*\b/gi, // TLE5014, TLE5014SP16D (ordering suffix)
  /\bVL53L\d[A-Z0-9]*\b/gi, // VL53L3CX, VL53L1X (ST ToF)
];

/** The most frequently occurring vendor part token, uppercased; "" if none. */
export function detectPart(pages: PageContent[]): string {
  const text = pages
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ");

  const counts = new Map<string, number>();
  for (const pattern of PART_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const token = m[0].toUpperCase();
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  let best = "";
  let bestCount = 0;
  for (const [token, count] of counts) {
    // Prefer higher frequency; break ties by the longer (more specific) token.
    if (count > bestCount || (count === bestCount && token.length > best.length)) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}
