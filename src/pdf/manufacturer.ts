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
  {
    name: "Analog Devices",
    copyright: /Analog\s+Devices/i,
    domain: /analog\.com/i,
    partPrefix: /\bADXL\d/i,
  },
  // Maxim Integrated was acquired by Analog Devices in 2021, but is kept as a
  // separate VENDORS entry: Maxim-era sheets (e.g. MAX30102's) carry Maxim
  // branding, not Analog Devices branding — that's the signal that fires.
  {
    name: "Maxim Integrated",
    copyright: /Maxim\s+Integrated/i,
    domain: /maximintegrated\.com/i,
    partPrefix: /\bMAX\d{3}/i,
  },
  {
    name: "Melexis",
    copyright: /Melexis/i,
    domain: /melexis\.com/i,
    partPrefix: /\bMLX\d/i,
  },
  // onsemi (STM32 field test, Unit 3): the copyright line names the legal
  // entity, not the "onsemi" brand itself ("© Semiconductor Components
  // Industries, LLC" — "onsemi" appears separately as a trademark/dba
  // notice), so the copyright signal matches the entity name rather than
  // "onsemi" directly. Paired with the onsemi.com domain for the same
  // strong copyright+url shape every other vendor rule uses.
  {
    name: "onsemi",
    copyright: /Semiconductor\s+Components\s+Industries/i,
    domain: /onsemi\.com/i,
    partPrefix: /\bFXL\d/i,
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
