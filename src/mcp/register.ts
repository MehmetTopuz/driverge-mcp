// Registers the full Driverge MCP surface — tools, resources, prompts — on a
// server instance. Kept out of server.ts so the wiring is unit-testable over an
// in-memory transport. Contract: wiki mcp-tool-usage-flow.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
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
const FILES = z.array(z.object({ path: z.string(), content: z.string() }));

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

// The frozen JSON-Schema, shipped alongside dist/ (see package.json "files").
function loadSchemaText(): string {
  try {
    const url = new URL("../../schemas/datasheet.schema.json", import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  } catch {
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
    async ({ pdf_path }) => {
      if (!existsSync(pdf_path)) {
        return text(`file not found: ${pdf_path}`, true);
      }
      const ref = computeRef(pdf_path, statSync(pdf_path).mtimeMs);
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
      const json = assembleDatasheet(analysis);
      putDatasheet({ ref, pdfPath: pdf_path, json });
      return text(buildSummary({ ref, pdfPath: pdf_path, json }));
    },
  );

  server.registerTool(
    "generate_driver",
    {
      title: "Generate driver",
      description:
        "Render a deterministic thin-HAL driver skeleton (with TODO(driverge) markers + a fill_in_brief) from a previously analyzed datasheet `ref`. Rejects refs that failed validation.",
      inputSchema: {
        ref: z.string(),
        target: TARGET.default("portable"),
        out_dir: z.string().optional(),
      },
    },
    async ({ ref, target, out_dir }) => {
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
        artifact = generateDriver(entry.json, target as CodegenTarget);
      } catch (err) {
        if (err instanceof UnsupportedTargetError) return text(err.message, true);
        throw err;
      }

      if (out_dir) {
        mkdirSync(out_dir, { recursive: true });
        for (const f of artifact.files) writeFileSync(join(out_dir, f.path), f.content);
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
      inputSchema: { ref: z.string(), target: TARGET.optional(), files: FILES },
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
        "Re-run the L5 validator over a cached `ref` or a supplied datasheet JSON. Thin wrapper over the same rules analyze_datasheet applies internally.",
      inputSchema: {
        ref: z.string().optional(),
        json: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ ref, json }) => {
      if (ref) {
        const entry = getDatasheet(ref);
        if (!entry) return text(`unknown ref "${ref}"`, true);
        return text(validateDatasheet(entry.json));
      }
      if (json) return text(validateDatasheet(json as unknown as DatasheetJson));
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
        "Guided flow: render the skeleton for a ref/target, complete the TODO(driverge) markers using the datasheet resource, then validate.",
      argsSchema: { ref: z.string(), target: z.string().optional() },
    },
    ({ ref, target }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Generate an embedded driver for datasheet ref "${ref}" (target: ${target ?? "portable"}).`,
              "",
              `1. Call generate_driver({ ref: "${ref}", target: "${target ?? "portable"}" }).`,
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
