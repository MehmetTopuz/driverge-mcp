// L4c generalization (Phase 4) — a role-based, high-precision TEXT pass for
// command-set devices whose commands are only ever named in running prose
// rather than tabulated (e.g. the Aosong DHT20's "sending the measurement
// command 0xAC"). The Sensirion-shaped tabulated extractor (extractCommands in
// command.ts) misses these entirely, so this runs as a fallback when that one
// finds nothing. A sentence yields a command only when it carries BOTH a
// command cue ("command" / "send(ing)") AND a role keyword (trigger/
// measurement/measure, status, reset) — so a bare hex mention (an I2C
// address, an unrelated register, a status-equality check) is never mistaken
// for a command. Reliable > complete: this never invents a name or code that
// isn't anchored by both signals. See wiki: command-set-interface,
// cross-vendor-coverage-scorecard.

import type { Command } from "../schema/types.js";
import type { PageContent } from "./types.js";

const joinText = (pages: PageContent[]) =>
  pages
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ");

/** A hex command/byte token, e.g. "0xAC". */
const CODE = /0x([0-9a-f]{2,4})\b/gi;
/** A command cue: the sentence is *doing* something with a command. */
const CUE = /\bcommand\b|\bsend(?:ing)?\b/i;

/** Ordered role list — first match in this order wins. */
const ROLES: { re: RegExp; name: string }[] = [
  { re: /\btrigger\b|\bmeasurement\b|\bmeasure\b/i, name: "trigger_measurement" },
  { re: /\bstatus\b/i, name: "status" },
  { re: /\breset\b/i, name: "soft_reset" },
];

const upperCode = (hex: string) => "0x" + hex.toUpperCase();

/** L4c fallback — extract commands that are only ever named in prose. */
export function extractProseCommands(pages: PageContent[]): Command[] {
  const text = joinText(pages);
  const sentences = text.split(/\.\s+/);

  const byCode = new Map<string, Command>();
  const byName = new Map<string, Command>();
  let last: Command | undefined;

  for (const sentence of sentences) {
    const codes = [...sentence.matchAll(CODE)];

    // Param sentence: "parameter" + >=2 hex bytes -> attach to the previous
    // command and never itself emit a new one.
    if (/\bparameter\b/i.test(sentence) && codes.length >= 2) {
      if (last && !last.params) {
        last.params = [upperCode(codes[0][1]), upperCode(codes[1][1])];
      }
      continue;
    }

    if (codes.length === 0 || !CUE.test(sentence)) continue;

    const role = ROLES.find((r) => r.re.test(sentence));
    if (!role) continue;

    // Code nearest the cue: the cue may be re-used by different command
    // mentions within a sentence, so anchor to the closest hex token.
    const cueIndex = CUE.exec(sentence)?.index ?? 0;
    let nearest = codes[0];
    let nearestDist = Math.abs((nearest.index ?? 0) - cueIndex);
    for (const m of codes) {
      const dist = Math.abs((m.index ?? 0) - cueIndex);
      if (dist < nearestDist) {
        nearest = m;
        nearestDist = dist;
      }
    }
    const code = upperCode(nearest[1]);

    const existing = byCode.get(code) ?? byName.get(role.name);
    if (existing) {
      last = existing;
      continue;
    }

    const command: Command = { name: role.name, code };
    byCode.set(code, command);
    byName.set(role.name, command);
    last = command;
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
