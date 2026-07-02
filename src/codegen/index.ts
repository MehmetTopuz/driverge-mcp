// Public surface of the codegen layer.

import type { DatasheetJson } from "../schema/types.js";
import { generateEsp32Driver } from "./esp32.js";
import { generatePortableDriver } from "./portable.js";
import { generateStm32Driver } from "./stm32.js";
import type { CodegenTarget, DriverArtifact } from "./types.js";

export * from "./types.js";
export { generatePortableDriver } from "./portable.js";
export { generateEsp32Driver } from "./esp32.js";
export { generateStm32Driver } from "./stm32.js";
export { lintDriver } from "./lint.js";
export { slug, prefixOf } from "./ident.js";

/** arduino lands in a later session; portable + esp32 + stm32 render today. */
export class UnsupportedTargetError extends Error {
  constructor(public readonly target: string) {
    super(
      `codegen target "${target}" is not available yet — supported targets: portable, esp32, stm32`,
    );
    this.name = "UnsupportedTargetError";
  }
}

/** Render a driver for a target, dispatching to the right generator. */
export function generateDriver(
  json: DatasheetJson,
  target: CodegenTarget,
): DriverArtifact {
  if (target === "portable") return generatePortableDriver(json);
  if (target === "esp32") return generateEsp32Driver(json);
  if (target === "stm32") return generateStm32Driver(json);
  throw new UnsupportedTargetError(target);
}
