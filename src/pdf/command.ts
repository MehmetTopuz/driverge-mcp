// L4b/L4c (scoped) — text extraction for command-set devices (e.g. Sensirion
// SHT3x): I2C protocol + CRC parameters, and the cleanly-tabulated standalone /
// representative commands. Full split-code measurement/periodic matrices are left
// to host-AI enumeration (hybrid philosophy). See wiki: command-set-interface.

import type { Command, Protocol } from "../schema/types.js";
import type { PageContent } from "./types.js";

const joinText = (pages: PageContent[]) =>
  pages
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ");

const upperHex = (code: string) => "0x" + code.slice(2).toUpperCase();

function normalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:(?:command|hex|code)\s+)+/i, "")
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** L4b — bus + device addresses. */
export function extractProtocol(pages: PageContent[]): Protocol {
  const text = joinText(pages);
  // SSC/SPC are Infineon's SPI-family serial names (e.g. TLE5014), so treat them
  // as SPI when neither I2C nor a plain "SPI" mention is present.
  // pdfjs renders the "I²C" superscript as separate tokens ("I 2 C"), so a
  // single optional space is tolerated between I/2/C. The trailing \b is kept
  // so "I 2 CHANNELS" (C directly followed by more letters) does not match.
  // SMBus is folded into this same I2C-tier check (evaluated before the SPI
  // branch): SMBus is I2C-compatible at the electrical/protocol level, and
  // sheets that only ever say "SMBus" (e.g. MLX90614) never spell out "I2C",
  // so without this the bus would wrongly resolve to "unknown". Once bus
  // resolves "I2C" the existing `if (bus === "I2C")` address gate fires
  // unchanged — the generated hal_i2c_* seam is correct for SMBus parts.
  const bus: Protocol["bus"] = /\bI\s?(?:2|²)\s?C\b/i.test(text) || /\bSMBus\b/i.test(text)
    ? "I2C"
    : /\bSPI\b|\bSSC\b|\bSPC\b/.test(text)
      ? "SPI"
      : "unknown";

  const addresses: string[] = [];
  // Only I2C has a bus device address. Scanning for "0xNN near 'address'" on an
  // SPI datasheet yields register offsets, not addresses (e.g. AEAT-8811), so we
  // gate address extraction on the I2C bus.
  if (bus === "I2C") {
    for (const ctx of text.matchAll(/address[^.]{0,60}/gi)) {
      for (const m of ctx[0].matchAll(/0x[0-7][0-9a-f]/gi)) {
        const addr = upperHex(m[0]);
        const value = Number.parseInt(addr, 16);
        if (value >= 0x08 && value <= 0x77 && !addresses.includes(addr)) {
          addresses.push(addr);
        }
      }
    }
  }

  return addresses.length > 0 ? { bus, addresses } : { bus };
}

/** Parse a CRC polynomial written as an expression, e.g. "1+X 4 +X 5 +X 8"
 *  (pdfjs renders superscripts as separate tokens). Drops the implicit highest
 *  term (x^width) and returns the truncated poly byte. */
function polyFromExpression(text: string): { poly: string; width: number } | undefined {
  const m = /polynomial[^.]{0,80}/i.exec(text);
  if (!m) return undefined;
  const expr = m[0];
  const exps = [...expr.matchAll(/x\s*\^?\s*(\d+)/gi)].map((e) => Number(e[1]));
  if (exps.length === 0) return undefined;
  const width = Math.max(...exps);
  const bits = new Set(exps.filter((e) => e < width));
  if (/[=+]\s*1\b/.test(expr) || /\b1\s*\+/.test(expr)) bits.add(0); // the "+1"/"1+" constant term
  let poly = 0;
  for (const b of bits) poly |= 1 << b;
  return { poly: `0x${poly.toString(16).toUpperCase().padStart(2, "0")}`, width };
}

/** L4b — CRC parameters from the checksum section. */
export function extractCrc(
  pages: PageContent[],
): { poly: string; init: string; width: number } | undefined {
  const text = joinText(pages);
  const init =
    /initiali[sz]ation\s+(0x[0-9a-f]{2})/i.exec(text) ??
    /initial\s+value[^.]{0,40}?(0x[0-9a-f]{2})/i.exec(text);
  if (!init) return undefined;

  const polyHex = /polynomial\s+(0x[0-9a-f]{2})/i.exec(text);
  const poly = polyHex
    ? { poly: upperHex(polyHex[1]), width: 8 }
    : polyFromExpression(text);
  if (!poly) return undefined;

  return { poly: poly.poly, init: upperHex(init[1]), width: poly.width };
}

// Only patterns whose NAME is a pure run of letters/spaces are used — a digit or
// "0x" in the span means we've crossed into the other text column, so we bail
// rather than emit a garbled name. Reliable > complete for this scoped pass.
const P_MINI = /hex\s+code\s+([a-z][a-z /]{1,35}?)\s+(0x[0-9a-f]{4})\s+table/gi;
const P_EG = /e\.g\.\s*(0x[0-9a-f]{4})\s*:\s*([a-z][a-z /]{3,70})/gi;
const P_GENCALL = /general call address\s+(0x[0-9a-f]{4})/gi;
const P_CRC_EXAMPLE = /crc\s*\(\s*(0x[0-9a-f]{4})\s*\)/gi;

const isDataReturning = /measurement|repeatab|periodic|status|art|fetch/i;
const isMeasurement = /measurement|repeatab|periodic/i;

/** L4c — extract named commands with full hex codes. */
export function extractCommands(pages: PageContent[]): Command[] {
  const text = joinText(pages);
  const crc = extractCrc(pages);

  const excluded = new Set<string>();
  for (const m of text.matchAll(P_CRC_EXAMPLE)) excluded.add(m[1].toLowerCase());

  // code -> name; earlier (cleaner) patterns win on collision.
  const found = new Map<string, string>();
  const add = (rawName: string, rawCode: string) => {
    const code = rawCode.toLowerCase();
    if (excluded.has(code) || found.has(code)) return;
    const name = normalizeName(rawName);
    if (name) found.set(code, name);
  };

  for (const m of text.matchAll(P_MINI)) add(m[1], m[2]);
  for (const m of text.matchAll(P_EG)) add(m[2], m[1]);
  for (const m of text.matchAll(P_GENCALL)) add("general_call_reset", m[1]);

  const commands: Command[] = [];
  for (const [code, name] of found) {
    const command: Command = { name, code: upperHex(code) };
    if (crc && isDataReturning.test(name)) {
      command.crc = crc;
      if (isMeasurement.test(name)) command.responseWords = 2;
    }
    commands.push(command);
  }

  commands.sort((a, b) => a.code.localeCompare(b.code));
  return commands;
}
