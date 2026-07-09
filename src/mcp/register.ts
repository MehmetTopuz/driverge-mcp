// Registers the full Driverge MCP surface — tools, resources, prompts — on a
// server instance. Kept out of server.ts so the wiring is unit-testable over an
// in-memory transport. Contract: wiki mcp-tool-usage-flow.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  UnsupportedBusError,
  UnsupportedTargetError,
  generateDriver,
  lintDriver,
} from "../codegen/index.js";
import type { CodegenTarget, GeneratedFile } from "../codegen/index.js";
import { analyzePdfFile } from "../pdf/analyze.js";
import { assembleDatasheet } from "../schema/assemble.js";
import { validateDatasheet } from "../schema/validate.js";
import type { DatasheetJson } from "../schema/types.js";
import { computeRef, getDatasheet, putDatasheet } from "./cache.js";
import { buildSummary } from "./summary.js";

const TARGET = z.enum(["portable", "stm32", "esp32", "arduino"]);
// Session D: output language flavor. "c" (default) is today's thin-HAL C
// skeleton; "cpp" renders a class wrapper — see CodegenLanguage. Invalid values
// (e.g. "rust") are rejected by this zod schema before the handler ever runs.
const LANGUAGE = z.enum(["c", "cpp"]);
const FILES = z.array(z.object({ path: z.string(), content: z.string() }));

// Structural guard for validate_datasheet's `json` arg (S5, see wiki:
// validate-before-sending-to-claude): a minimal zod parse covering exactly what
// validateDatasheet reads, so a malformed/hand-typed blob fails with a clean
// message instead of a raw TypeError from deep inside the validator. Loose on
// fields validateDatasheet doesn't touch — this is a guard, not a schema mirror.
const BIT_FIELD_SCHEMA = z.object({
  name: z.string(),
  msb: z.number(),
  lsb: z.number(),
});
const REGISTER_SCHEMA = z.object({
  name: z.string(),
  address: z.string(),
  reset: z.string(),
  width: z.number().optional(),
  bitFields: z.array(BIT_FIELD_SCHEMA),
});
const COMMAND_SCHEMA = z.object({
  name: z.string(),
  code: z.string(),
  responseWords: z.number().optional(),
  crc: z.object({ poly: z.string(), init: z.string(), width: z.number() }).optional(),
});
const INTERFACE_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("register_map"), registers: z.array(REGISTER_SCHEMA) }),
  z.object({ kind: z.literal("command_set"), commands: z.array(COMMAND_SCHEMA) }),
]);
const DATASHEET_JSON_GUARD = z.object({
  metadata: z.looseObject({ part: z.string() }),
  protocol: z.looseObject({ bus: z.string(), addresses: z.array(z.string()).optional() }),
  interface: INTERFACE_SCHEMA,
  extraction: z
    .object({
      status: z.enum(["complete", "partial", "deferred", "none"]),
      detectedPages: z.array(z.number()),
    })
    .optional(),
}).loose();

type TextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};
const text = (value: unknown, isError = false): TextResult => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
  ...(isError ? { isError: true } : {}),
});

// Matches an absolute Windows path ("C:\..." or "C:/...") even when Node's
// `path` module resolves in POSIX mode (e.g. tests running on a non-Windows
// CI). Node's own `isAbsolute()` only recognizes the *current platform's*
// notion of absolute, so on POSIX it does NOT consider "C:\evil.h" absolute —
// this regex closes that gap so resolveArtifactPath's containment check is
// meaningful on every platform, not just Windows (B3).
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;

// DoS hardening: analyze_datasheet must not read an unbounded file into
// memory. 64 MiB comfortably covers real-world datasheets while still
// bounding worst-case memory/CPU from a hostile or accidental huge input.
const DEFAULT_MAX_PDF_BYTES = 64 * 1024 * 1024;

/**
 * Confines a single artifact file path (`DriverArtifact.files[].path`) under
 * `rootDir`, returning the resolved absolute path when it is safely inside
 * `rootDir`, or `undefined` when it escapes (an absolute path — POSIX or
 * Windows-style — or a relative path that climbs out via `..`). Mirrors the
 * out_dir escape check in the generate_driver handler below (resolve +
 * relative + isAbsolute) so both containment checks agree on what "escapes"
 * means. A nested-but-non-escaping relative path (e.g. "sub/dir/file.h") is
 * accepted and resolves under rootDir.
 *
 * `filePath` is always Driverge's own deterministic codegen output today
 * (safe), but the generate_driver handler has no other guard if that ever
 * changes — a hostile/careless datasheet-derived slug, a future codegen bug,
 * etc. — so this is the second containment check, applied to every file
 * BEFORE any of them are written (B3).
 */
export function resolveArtifactPath(rootDir: string, filePath: string): string | undefined {
  if (isAbsolute(filePath) || WINDOWS_ABSOLUTE.test(filePath)) return undefined;
  const resolvedRoot = resolve(rootDir);
  const target = resolve(resolvedRoot, filePath);
  const rel = relative(resolvedRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return target;
}

// The frozen JSON-Schema, shipped alongside dist/ (see package.json "files").
function loadSchemaText(): string {
  try {
    const url = new URL("../../schemas/datasheet.schema.json", import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  } catch {
    // stderr is safe for a stdio MCP server (stdout is the protocol channel).
    console.error(
      "driverge-mcp: could not read schemas/datasheet.schema.json — serving an empty schema",
    );
    return "{}";
  }
}

export function registerDrivergeTools(server: McpServer): void {
  server.registerTool(
    "analyze_datasheet",
    {
      title: "Analyze datasheet",
      description:
        "Parse an IC datasheet PDF (L1–L5), validate it, and cache the structured JSON under a stable `ref`. Returns a compact summary; read the full JSON via the driverge://datasheet/<ref> resource.",
      inputSchema: {
        pdf_path: z.string().describe("absolute path to the datasheet PDF"),
        manufacturer_hint: z.string().optional(),
        interface_kind_hint: z.enum(["register_map", "command_set"]).optional(),
      },
    },
    async ({ pdf_path, manufacturer_hint, interface_kind_hint }) => {
      // Single stat call (not existsSync + statSync) to close the TOCTOU gap
      // where the file could vanish/change between the check and the read (S4).
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(pdf_path);
      } catch {
        return text(`file not found: ${pdf_path}`, true);
      }
      // DoS hardening: read the cap at call time (like DRIVERGE_OUT_ROOT below,
      // in the generate_driver handler) so tests can scope it per-case via
      // DRIVERGE_MAX_PDF_BYTES; `|| DEFAULT_MAX_PDF_BYTES` also covers an
      // unset/empty/non-numeric env value (Number("") and Number(undefined)
      // are both falsy-ish here — NaN is falsy for `||`).
      const maxBytes = Number(process.env.DRIVERGE_MAX_PDF_BYTES) || DEFAULT_MAX_PDF_BYTES;
      if (stat.size > maxBytes) {
        return text(
          `PDF too large: ${stat.size} bytes exceeds the ${maxBytes}-byte limit (set DRIVERGE_MAX_PDF_BYTES to change it)`,
          true,
        );
      }
      const mtimeMs = stat.mtimeMs;
      // Fold the hints into the ref material (Session 10 / Contract A): the ref
      // is otherwise path+mtime only, so re-analyzing the same file with
      // different hints would silently serve a hint-less cached entry.
      const ref = computeRef(
        pdf_path,
        mtimeMs,
        `${manufacturer_hint ?? ""}:${interface_kind_hint ?? ""}`,
      );
      const cached = getDatasheet(ref);
      if (cached) return text(buildSummary(cached));

      let analysis;
      try {
        analysis = await analyzePdfFile(pdf_path);
      } catch (err) {
        return text(`failed to parse PDF: ${(err as Error).message}`, true);
      }
      if (analysis.type === "scanned") {
        return text(
          "PDF appears to be scanned (no extractable text). OCR is not supported in v0.1.0.",
          true,
        );
      }
      const json = assembleDatasheet(analysis, {
        manufacturerHint: manufacturer_hint,
        interfaceKindHint: interface_kind_hint,
      });
      putDatasheet({ ref, pdfPath: pdf_path, json });
      return text(buildSummary({ ref, pdfPath: pdf_path, json }));
    },
  );

  server.registerTool(
    "generate_driver",
    {
      title: "Generate driver",
      description:
        "Render a deterministic thin-HAL driver skeleton (with TODO(driverge) markers + a fill_in_brief) from a previously analyzed datasheet `ref`. Rejects refs that failed validation. `language` defaults to \"c\" (struct + free functions); pass \"cpp\" for a class wrapper (.hpp/.cpp) around the same #define macros and hal_* seam.",
      inputSchema: {
        ref: z.string(),
        target: TARGET.default("portable"),
        language: LANGUAGE.default("c"),
        out_dir: z.string().optional(),
      },
    },
    async ({ ref, target, language, out_dir }) => {
      const entry = getDatasheet(ref);
      if (!entry) return text(`unknown ref "${ref}" — run analyze_datasheet first`, true);
      if (!entry.json.validation.valid) {
        return text(
          {
            error: "datasheet validation failed — codegen refused",
            errors: entry.json.validation.errors,
          },
          true,
        );
      }

      let artifact;
      try {
        artifact = generateDriver(entry.json, target as CodegenTarget, { language });
      } catch (err) {
        if (err instanceof UnsupportedTargetError) return text(err.message, true);
        if (err instanceof UnsupportedBusError) return text(err.message, true);
        throw err;
      }

      if (out_dir) {
        // S1: confine writes under DRIVERGE_OUT_ROOT (default cwd), read at call
        // time so tests can scope it per-case. relative() + isAbsolute() catches
        // both "../escape" traversal and an absolute path on another drive; no
        // directory is created before this check passes.
        const root = process.env.DRIVERGE_OUT_ROOT ?? process.cwd();
        const resolvedRoot = resolve(root);
        const resolvedOut = resolve(resolvedRoot, out_dir);
        const rel = relative(resolvedRoot, resolvedOut);
        if (rel.startsWith("..") || isAbsolute(rel)) {
          return text(
            `out_dir "${out_dir}" escapes the allowed root "${resolvedRoot}" (set DRIVERGE_OUT_ROOT to change it)`,
            true,
          );
        }
        // B3: a SECOND containment check, this time on each artifact file's
        // own path — resolveArtifactPath, not a bare join(resolvedOut,
        // f.path). Every path is validated BEFORE any file is written, so a
        // single escaping path aborts the whole write with no partial output.
        const targets: { target: string; content: string }[] = [];
        for (const f of artifact.files) {
          const target = resolveArtifactPath(resolvedOut, f.path);
          if (!target) {
            return text(
              `generated file path "${f.path}" escapes the output directory "${resolvedOut}" — refusing to write anything`,
              true,
            );
          }
          targets.push({ target, content: f.content });
        }
        mkdirSync(resolvedOut, { recursive: true });
        for (const { target, content } of targets) {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, content);
        }
      }
      return text(artifact);
    },
  );

  server.registerTool(
    "validate_driver",
    {
      title: "Validate driver",
      description:
        "Static-lint a completed driver against its source datasheet `ref`: thin-HAL purity, no leftover TODO(driverge), register/command references exist, bit-field masks match the JSON.",
      inputSchema: { ref: z.string(), files: FILES },
    },
    async ({ ref, files }) => {
      const entry = getDatasheet(ref);
      if (!entry) return text(`unknown ref "${ref}" — run analyze_datasheet first`, true);
      const result = lintDriver(files as GeneratedFile[], entry.json);
      return text({
        passed: result.valid,
        warnings: result.warnings,
        errors: result.errors,
      });
    },
  );

  server.registerTool(
    "validate_datasheet",
    {
      title: "Validate datasheet JSON",
      description:
        "Re-run the L5 validator over a cached `ref` or a supplied datasheet JSON. Passing BOTH `ref` and `json` PERSISTS the completed JSON under that ref (overwriting the cached datasheet) and returns its fresh validation — this is how you close the deferred loop: analyze → complete the register/command map from the datasheet resource → validate_datasheet(ref, json) → generate_driver(ref) then sees the completed map. Thin wrapper over the same rules analyze_datasheet applies internally.",
      inputSchema: {
        ref: z.string().optional(),
        json: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ ref, json }) => {
      // Both args → the host has completed a previously deferred datasheet and
      // wants it persisted so generate_driver(ref) picks it up (A4, see
      // raw/DRIVERGE_ISSUES.md). Guard-parse, re-validate, attach the fresh
      // validation, and overwrite the cache entry under this ref.
      if (ref && json) {
        const parsed = DATASHEET_JSON_GUARD.safeParse(json);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
          return text(`invalid datasheet JSON — ${issues}`, true);
        }
        const supplied = parsed.data as unknown as DatasheetJson;
        // Recompute validation from the supplied content rather than trusting any
        // `validation` field the host may (or may not) have included — so the
        // persisted entry's validity always reflects the real map, and
        // generate_driver's `validation.valid` gate stays honest.
        const validation = validateDatasheet(supplied);
        const completed: DatasheetJson = { ...supplied, validation };
        const existing = getDatasheet(ref);
        putDatasheet({ ref, pdfPath: existing?.pdfPath ?? "(host-completed)", json: completed });
        return text({ persisted: true, ref, validation });
      }
      if (ref) {
        const entry = getDatasheet(ref);
        if (!entry) return text(`unknown ref "${ref}"`, true);
        return text(validateDatasheet(entry.json));
      }
      if (json) {
        // S5: structural parse before validateDatasheet ever dereferences the
        // shape — a hand-typed/malformed blob must fail cleanly, not throw a
        // raw TypeError from deep inside the validator.
        const parsed = DATASHEET_JSON_GUARD.safeParse(json);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
          return text(`invalid datasheet JSON — ${issues}`, true);
        }
        return text(validateDatasheet(parsed.data as unknown as DatasheetJson));
      }
      return text("provide either `ref` or `json`", true);
    },
  );
}

export function registerDrivergeResources(server: McpServer): void {
  const schemaText = loadSchemaText();

  server.registerResource(
    "datasheet-schema",
    "driverge://schema",
    {
      title: "Datasheet JSON schema",
      description: "The frozen draft-07 JSON-Schema contract for parsed datasheets.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: schemaText }],
    }),
  );

  server.registerResource(
    "datasheet-json",
    new ResourceTemplate("driverge://datasheet/{ref}", { list: undefined }),
    {
      title: "Parsed datasheet JSON",
      description: "Full structured JSON for an analyzed datasheet, by ref.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const ref = String(variables.ref);
      const entry = getDatasheet(ref);
      if (!entry) throw new Error(`unknown datasheet ref "${ref}"`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(entry.json, null, 2),
          },
        ],
      };
    },
  );
}

export function registerDrivergePrompts(server: McpServer): void {
  server.registerPrompt(
    "generate-driver",
    {
      title: "Generate a driver",
      description:
        "Guided flow: render the skeleton for a ref/target/language, complete the TODO(driverge) markers using the datasheet resource, then validate.",
      argsSchema: { ref: z.string(), target: z.string().optional(), language: z.string().optional() },
    },
    ({ ref, target, language }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Generate an embedded driver for datasheet ref "${ref}" (target: ${target ?? "portable"}, language: ${language ?? "c"}).`,
              "",
              `1. Call generate_driver({ ref: "${ref}", target: "${target ?? "portable"}", language: "${language ?? "c"}" }) — language is optional and defaults to "c" (struct + free functions); pass "cpp" for a C++ class wrapper (.hpp/.cpp) around the same #define macros and hal_* seam.`,
              `2. Read driverge://datasheet/${ref} for full register/command detail.`,
              "3. Complete every TODO(driverge) marker using the fill_in_brief and the datasheet JSON — init sequence, vendor quirks, docs (and CRC for command-set parts).",
              "4. Keep all bus access on the hal_* seam; never call a vendor peripheral API directly.",
              `5. Call validate_driver({ ref: "${ref}", files: [...] }) and fix any reported errors, then return the final files.`,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

/** Register the entire Driverge surface on a server. */
export function registerDriverge(server: McpServer): void {
  registerDrivergeTools(server);
  registerDrivergeResources(server);
  registerDrivergePrompts(server);
}
