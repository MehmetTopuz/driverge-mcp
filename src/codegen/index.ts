// Public surface of the codegen layer.

import type { DatasheetJson } from "../schema/types.js";
import { generateEsp32Driver } from "./esp32.js";
import { generatePortableCppDriver } from "./portable-cpp.js";
import { generatePortableDriver } from "./portable.js";
import { generateStm32Driver } from "./stm32.js";
import { UnsupportedTargetError } from "./types.js";
import type { CodegenLanguage, CodegenTarget, DriverArtifact } from "./types.js";

// UnsupportedTargetError and UnsupportedBusError live in ./types.js (cycle-free:
// esp32.js/stm32.js import UnsupportedBusError from there too, and this module
// imports esp32.js/stm32.js) — re-exported here for the public codegen surface.
export * from "./types.js";
export { generatePortableDriver } from "./portable.js";
export { generatePortableCppDriver } from "./portable-cpp.js";
export { generateEsp32Driver } from "./esp32.js";
export { generateStm32Driver } from "./stm32.js";
export { lintDriver } from "./lint.js";
export { slug, prefixOf } from "./ident.js";

export interface GenerateDriverOptions {
  /** Output language flavor; "c" (default) is byte-identical to pre-Session-D
   *  output, "cpp" renders a class wrapper — see CodegenLanguage. */
  language?: CodegenLanguage;
}

/**
 * Render a driver for a target, dispatching to the right generator/language.
 * `opts` is optional and additive — omitted, `{}`, and `{ language: "c" }` all
 * produce today's byte-identical C output (Session D: cpp language option).
 */
export function generateDriver(
  json: DatasheetJson,
  target: CodegenTarget,
  opts: GenerateDriverOptions = {},
): DriverArtifact {
  const language = opts.language ?? "c";
  if (target === "portable") {
    return language === "cpp" ? generatePortableCppDriver(json) : generatePortableDriver(json);
  }
  if (target === "esp32") return generateEsp32Driver(json, { language });
  if (target === "stm32") return generateStm32Driver(json, { language });
  throw new UnsupportedTargetError(target);
}
