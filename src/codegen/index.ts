// Public surface of the codegen layer.

import type { DatasheetJson } from "../schema/types.js";
import { generatePortableDriver } from "./portable.js";
import type { CodegenTarget, DriverArtifact } from "./types.js";

export * from "./types.js";
export { generatePortableDriver } from "./portable.js";
export { lintDriver } from "./lint.js";
export { slug, prefixOf } from "./ident.js";

/** Native targets land in Sessions 7-8; only "portable" is renderable in v0.1.0. */
export class UnsupportedTargetError extends Error {
  constructor(public readonly target: string) {
    super(
      `codegen target "${target}" is not available yet — only "portable" (thin-HAL) is supported in this release`,
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
  throw new UnsupportedTargetError(target);
}
