// L3a — manufacturer detection: deterministic layered scoring over datasheet
// text. Strong signals (copyright, document-number, URL) outweigh the weak
// part-prefix heuristic, so second-source collisions (PCA9555 vs TCA9555) resolve
// correctly. Low confidence degrades gracefully to a generic adapter — it never
// hard-fails. See wiki: manufacturer-detection, device-class-before-manufacturer.

import type { ManufacturerDetection, PageContent } from "./types.js";

interface VendorRule {
  name: string;
  copyright?: RegExp;
  docNumber?: RegExp;
  domain?: RegExp;
  partPrefix?: RegExp;
}

const VENDORS: readonly VendorRule[] = [
  {
    name: "Bosch Sensortec",
    copyright: /Bosch\s+Sensortec/i,
    docNumber: /\bBST-[A-Z0-9]+-DS\d+/i,
    domain: /bosch-sensortec\.com/i,
    partPrefix: /\bBM[EPAI]\d/i,
  },
  {
    name: "Microchip",
    copyright: /Microchip\s+Technology/i,
    docNumber: /\bDS\d{8}[A-Z]?\b/i,
    domain: /microchip\.com/i,
    partPrefix: /\bMCP\d/i,
  },
  {
    name: "STMicroelectronics",
    copyright: /STMicroelectronics/i,
    docNumber: /\bDS\d{4,5}\b/i,
    domain: /\bst\.com\b/i,
    partPrefix: /\b(LIS|LSM|STM)\d/i,
  },
  {
    name: "Texas Instruments",
    copyright: /Texas\s+Instruments/i,
    docNumber: /\b(SLLS|SBAS|SBOS|SNOS)\w+/i,
    domain: /\bti\.com\b/i,
    partPrefix: /\b(SN65|SN74|TCA|ADS)\d/i,
  },
  {
    name: "NXP",
    copyright: /NXP\s+Semiconductors/i,
    domain: /nxp\.com/i,
    partPrefix: /\b(PCA|PCF)\d/i,
  },
  {
    name: "Sensirion",
    copyright: /Sensirion/i,
    domain: /sensirion\.com/i,
    partPrefix: /\b(SHT|SCD|SGP)\d/i,
  },
  {
    name: "Aosong",
    copyright: /Aosong|ASAIR/i,
    domain: /aosong\.com|asair(?:china)?\.com/i,
    partPrefix: /\b(DHT|AHT)\d/i,
  },
  {
    name: "Broadcom",
    copyright: /Broadcom|Avago/i,
    domain: /broadcom\.com/i,
    partPrefix: /\bAEAT-?\d/i,
  },
  {
    name: "Infineon",
    copyright: /Infineon/i,
    domain: /infineon\.com/i,
    partPrefix: /\b(TLE|TLI|TLV)\d/i,
  },
];

const STRONG = 3;
const WEAK = 1;
/** Below this, no confident vendor — fall back to generic. */
const MIN_SCORE = 2;

export function detectManufacturer(
  pages: PageContent[],
): ManufacturerDetection {
  const text = pages.map((p) => p.text).join(" ");

  let best = { name: "generic", score: 0, signals: [] as string[] };
  for (const vendor of VENDORS) {
    let score = 0;
    const signals: string[] = [];
    if (vendor.copyright?.test(text)) {
      score += STRONG;
      signals.push("copyright");
    }
    if (vendor.docNumber?.test(text)) {
      score += STRONG;
      signals.push("doc-number");
    }
    if (vendor.domain?.test(text)) {
      score += STRONG;
      signals.push("url");
    }
    if (vendor.partPrefix?.test(text)) {
      score += WEAK;
      signals.push("part-prefix");
    }
    if (score > best.score) best = { name: vendor.name, score, signals };
  }

  if (best.score < MIN_SCORE) {
    return { manufacturer: "generic", confidence: 0, signals: [] };
  }
  return {
    manufacturer: best.name,
    confidence: Math.min(1, best.score / 6),
    signals: best.signals,
  };
}
