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
  // Session B — UART tier. This MUST stay last: multi-interface sheets (e.g. a
  // part offered in both I2C/SPI and UART variants) list I2C/SPI first-class,
  // so those tiers get first refusal above. "UART" and its cousins (RS-232/485
  // are electrically distinct but frame the same way over a UART peripheral;
  // "TTL serial" is the same asynchronous serial link at logic-level voltages)
  // also turn up incidentally in appnote/pinout prose on I2C/SPI datasheets
  // (e.g. "connect via a TTL serial debug adapter"), so resolving this tier
  // before I2C/SPI would misclassify those parts. UART has no bus device
  // address, so — like SPI — address extraction stays gated on I2C only below.
  //
  // Session C — CAN tier. Sits AFTER I2C/SPI/UART for the same multi-interface-
  // sheet reason as UART above. "CAN" is unusual among these bus keywords: it is
  // ALSO a common English modal verb ("the sensor CAN operate in low power
  // mode"), so a bare case-insensitive match would false-positive constantly.
  // Detection therefore needs two tiers of its own: an explicit phrase ("CAN
  // bus", "CAN 2.0[AB]", "CAN FD") is unambiguous on its own; short of that, a
  // literal uppercase "CAN" (case-SENSITIVE — the modal verb is virtually never
  // written in all-caps in running prose) must co-occur with vocabulary that is
  // unique to the CAN protocol (arbitration, DLC, "CAN controller", an
  // acceptance filter) before it resolves. Like UART, CAN has no universal
  // register-access primitive on the wire (CANopen SDO / J1939 PGN / raw
  // message-ID schemes are all device-specific), so address extraction stays
  // gated on I2C only below.
  const CAN_PHRASE = /\bCAN\s?(?:bus|2\.0[AB]?|FD)\b/i;
  const CAN_VOCAB =
    /\barbitration\b/i.test(text) ||
    /\bDLC\b/.test(text) ||
    /\bCAN\s+controller\b/i.test(text) ||
    /\bacceptance\s+filter/i.test(text);

  const bus: Protocol["bus"] = /\bI\s?(?:2|²)\s?C\b/i.test(text) || /\bSMBus\b/i.test(text)
    ? "I2C"
    : /\bSPI\b|\bSSC\b|\bSPC\b/.test(text)
      ? "SPI"
      : /\bUART\b/.test(text) || /\bRS-?(?:232|485)\b/i.test(text) || /\bTTL\s+serial\b/i.test(text)
        ? "UART"
        : CAN_PHRASE.test(text) || (/\bCAN\b/.test(text) && CAN_VOCAB)
          ? "CAN"
          : "unknown";

  // Only I2C has a bus device address. Scanning for "0xNN near 'address'" on an
  // SPI datasheet yields register offsets, not addresses (e.g. AEAT-8811), so we
  // gate address extraction on the I2C bus.
  const addresses = bus === "I2C" ? extractI2cAddresses(text) : [];
  return addresses.length > 0 ? { bus, addresses } : { bus };
}

// A binary-notation 7-bit I2C address token: an optional "0b"/"b" prefix (or a
// trailing "b"), 7 bits, where the last bit may be an "X"/"x" placeholder for a
// pin-selectable LSB (e.g. AD0). "b110100X", "0b1101000", "1101000b" all match.
const BINARY_ADDRESS = /\b(0b|b)?([01]{6}[01xX])(b)?\b/gi;

// TI's decimal/hex address-PAIR idiom (Table 8-3 "Address Reference": "ADDR
// I2C BUS TARGET ADDRESS L 32 (decimal), 20 (hexadecimal) H 33 (decimal), 21
// (hexadecimal)"). The comma between the pairs is optional (some sheets omit
// it); requiring the trailing "(hexadecimal)" label is what keeps a lone
// "NN (decimal)" mention from ever matching.
const TI_DECIMAL_HEX_PAIR =
  /\b\d{1,3}\s*\(decimal\),?\s*([0-9a-f]{1,2})\s*\(hexadecimal\)/gi;

// Context words that mark a SECONDARY sub-device address rather than the part's
// own primary bus address — the MPU-9250 case, where 0x0C is the AK8963
// magnetometer behind the main device (raw/DRIVERGE_ISSUES.md A2). Kept narrow
// (magnetometer/AK-family/"secondary|sub address") so it does not fire on the
// aux-interface prose common to plain IMUs.
const SUBDEVICE_CONTEXT =
  /\b(?:magnetometer|ak8963|ak09\d{3}|secondary\s+address|sub[-\s]?address)\b/i;

/**
 * L4b — I2C device addresses, ranked so `addresses[0]` is the PRIMARY device
 * address (which is what codegen hardcodes as `<PART>_I2C_ADDR`). Recognizes
 * both hex ("0x68") and binary-notation ("b110100X", "0b1101000", "1101000b")
 * 7-bit addresses near the word "address". Many InvenSense/TDK-style sheets
 * (e.g. MPU-9250) give the primary address ONLY in binary and a secondary
 * sub-device address (the AK8963 magnetometer, 0x0C) in hex, so the old
 * hex-only scan grabbed the wrong one (raw/DRIVERGE_ISSUES.md A2/A5).
 *
 * Three passes keep it safe: hex first (preserving the pre-existing text order
 * of hex-only sheets byte-for-byte), then binary, then TI's decimal/hex PAIR
 * idiom ("NN (decimal), NN (hexadecimal)" — TCA6408A-Q1's Table 8-3 "Address
 * Reference"; neither the hex-literal nor binary-notation pass finds anything
 * on that sheet, since the address is spelled entirely in prose). A small
 * stable relevance score then floats the primary up: +1 for a binary-notation
 * match (the primary's usual form on those sheets), +1 for an explicit
 * "(hexadecimal)" label (an unambiguous primary-address signal, at least as
 * strong as the binary form's), -2 for a magnetometer/sub-device context.
 * Equal scores keep first-seen order, so hex-only sheets are unchanged.
 */
export function extractI2cAddresses(text: string): string[] {
  interface Candidate {
    addr: string;
    score: number;
    order: number;
  }
  const byAddr = new Map<string, Candidate>();
  let order = 0;

  const consider = (
    addr: string,
    fromBinary: boolean,
    ctx: string,
    fromHexLabel = false,
  ): void => {
    const value = Number.parseInt(addr, 16);
    if (value < 0x08 || value > 0x77) return; // outside the usable 7-bit space
    let score = 0;
    if (fromBinary) score += 1;
    if (fromHexLabel) score += 1;
    if (SUBDEVICE_CONTEXT.test(ctx)) score -= 2;
    const existing = byAddr.get(addr);
    if (existing) {
      if (score > existing.score) existing.score = score; // keep strongest context
      return;
    }
    byAddr.set(addr, { addr, score, order: order++ });
  };

  // Collect the "near-address" windows once; each carries a little preceding
  // context so a "magnetometer"/"secondary" qualifier before the keyword is
  // visible to the scorer.
  const windows = [...text.matchAll(/address[^.]{0,60}/gi)].map((m) => ({
    body: m[0],
    ctx: text.slice(Math.max(0, (m.index ?? 0) - 32), (m.index ?? 0) + m[0].length),
  }));

  // Pass 1 — hex forms, in text order.
  for (const { body, ctx } of windows) {
    for (const m of body.matchAll(/0x[0-7][0-9a-f]/gi)) {
      consider(upperHex(m[0]), false, ctx);
    }
  }
  // Pass 2 — binary-notation forms (bumps score of already-seen addresses or
  // appends new ones after the hex-ordered set).
  for (const { body, ctx } of windows) {
    for (const m of body.matchAll(BINARY_ADDRESS)) {
      const [, prefix, core, suffix] = m;
      const hasPlaceholder = /[xX]/.test(core);
      // A bare, unmarked 7-bit run is too ambiguous to treat as an address —
      // require an explicit binary marker (prefix/suffix "b", or an X placeholder).
      if (!prefix && !suffix && !hasPlaceholder) continue;
      const bitStrings = hasPlaceholder
        ? [core.replace(/[xX]/, "0"), core.replace(/[xX]/, "1")]
        : [core];
      for (const bits of bitStrings) {
        const value = Number.parseInt(bits, 2);
        consider(`0x${value.toString(16).toUpperCase().padStart(2, "0")}`, true, ctx);
      }
    }
  }
  // Pass 3 — TI's "NN (decimal), NN (hexadecimal)" paired idiom (Table 8-3
  // "Address Reference", TCA6408A-Q1). Scanned over the FULL text, not the
  // "address"-anchored windows above: the idiom's own anchor keyword is
  // "(hexadecimal)", not "address", and a sheet's second pair can sit well
  // past a 60-char window from the first "address" mention. Requiring the
  // decimal/hexadecimal PAIRING (not a bare "(decimal)") keeps a lone decimal
  // mention from ever synthesizing an address.
  for (const m of text.matchAll(TI_DECIMAL_HEX_PAIR)) {
    const start = m.index ?? 0;
    const ctx = text.slice(Math.max(0, start - 32), start + m[0].length);
    consider(`0x${m[1].toUpperCase()}`, false, ctx, true);
  }

  return [...byAddr.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((c) => c.addr);
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
