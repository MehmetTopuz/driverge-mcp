// L3b — interface-kind classifier: register_map vs command_set. This, not the
// manufacturer, is the primary strategy switch (routes L4a table vs L4c command).
// See wiki: device-class-before-manufacturer, command-set-interface.

import { findRegisterTable } from "./register-table.js";
import type { InterfaceKindDetection, PageContent } from "./types.js";

const REGISTER_KEYWORD =
  /register\s+(map|table|description|addresses?|summary)|memory\s+map/i;
const COMMAND_KEYWORD =
  /command\s+word|commands?\s+(set|table|list)|list\s+of\s+commands/i;
const CRC_KEYWORD = /crc[-\s]?\d|clock\s+stretch/i;

/**
 * Which pages carry a register-map / command section heading. Used by the
 * graceful-degradation path (schema/assemble) to tell a *deferral* (a section was
 * detected but not auto-extracted → hand to the host AI) from a genuine parse
 * failure, and to point the host AI at the right pages. Reuses the same keyword
 * signals as the kind classifier.
 */
export function detectSections(pages: PageContent[]): {
  registerPages: number[];
  commandPages: number[];
} {
  const registerPages: number[] = [];
  const commandPages: number[] = [];
  for (const p of pages) {
    if (REGISTER_KEYWORD.test(p.text)) registerPages.push(p.index);
    if (COMMAND_KEYWORD.test(p.text)) commandPages.push(p.index);
  }
  return { registerPages, commandPages };
}

export function detectInterfaceKind(
  pages: PageContent[],
): InterfaceKindDetection {
  const text = pages.map((p) => p.text).join(" ");

  const registerSignals: string[] = [];
  const commandSignals: string[] = [];
  let registerScore = 0;
  let commandScore = 0;

  if (findRegisterTable(pages)) {
    registerScore += 3;
    registerSignals.push("register-table");
  }
  if (REGISTER_KEYWORD.test(text)) {
    registerScore += 2;
    registerSignals.push("register-keyword");
  }
  if (COMMAND_KEYWORD.test(text)) {
    commandScore += 2;
    commandSignals.push("command-keyword");
  }
  if (CRC_KEYWORD.test(text)) {
    commandScore += 1;
    commandSignals.push("crc/clock-stretch");
  }

  if (registerScore === 0 && commandScore === 0) {
    return { kind: "unknown", confidence: 0, signals: [] };
  }
  if (registerScore >= commandScore) {
    return {
      kind: "register_map",
      confidence: Math.min(1, registerScore / 5),
      signals: registerSignals,
    };
  }
  return {
    kind: "command_set",
    confidence: Math.min(1, commandScore / 3),
    signals: commandSignals,
  };
}
