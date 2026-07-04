import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../src/server";
import { generatePortableDriver } from "../../src/codegen/portable";
import { clearDatasheetCache, putDatasheet } from "../../src/mcp/cache";
import type { DatasheetJson } from "../../src/schema/types";
import { registerDatasheet } from "../codegen/helpers";

type TextContent = { type: string; text?: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

const REF = "ds_test_bme280";
const REF_BAD = "ds_test_invalid";
const validJson = registerDatasheet("bme280.golden.json", "BME280");
const invalidJson: DatasheetJson = {
  ...validJson,
  validation: { valid: false, errors: ["register_map has no registers"], warnings: [] },
};

function firstText(result: unknown): string {
  return ((result as ToolResult).content[0] as TextContent).text ?? "";
}

let open: { client: Client; server: McpServer } | undefined;

async function connectClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "driverge-test-client", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  open = { client, server };
  return client;
}

beforeEach(() => {
  clearDatasheetCache();
  putDatasheet({ ref: REF, pdfPath: "/x/bme280.pdf", json: validJson });
  putDatasheet({ ref: REF_BAD, pdfPath: "/x/bad.pdf", json: invalidJson });
});

afterEach(async () => {
  if (open) {
    await open.client.close();
    await open.server.close();
    open = undefined;
  }
});

describe("Driverge MCP surface", () => {
  it("registers the analysis/codegen/validation tools", async () => {
    const client = await connectClient();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ping",
        "analyze_datasheet",
        "generate_driver",
        "validate_driver",
        "validate_datasheet",
      ]),
    );
  });

  it("generate_driver renders the portable skeleton for a valid ref", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "portable" },
    });
    expect((result as ToolResult).isError).toBeFalsy();
    const artifact = JSON.parse(firstText(result));
    expect(artifact.files.map((f: { path: string }) => f.path)).toEqual([
      "bme280.h",
      "bme280.c",
    ]);
    expect(artifact.fill_in_brief).toHaveProperty("init_sequence_todo");
  });

  it("generate_driver rejects an unknown ref", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: "nope", target: "portable" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/unknown ref/);
  });

  it("generate_driver refuses codegen when validation failed", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF_BAD, target: "portable" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/validation failed/);
  });

  it("generate_driver renders the esp32 target (core + ESP-IDF seam)", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "esp32" },
    });
    expect((result as ToolResult).isError).toBeFalsy();
    const artifact = JSON.parse(firstText(result));
    expect(artifact.files.map((f: { path: string }) => f.path)).toEqual([
      "bme280.h",
      "bme280.c",
      "bme280_hal_esp32.c",
    ]);
  });

  it("generate_driver refuses a SPI part on a native I2C-only target (esp32) cleanly (B1 regression pin)", async () => {
    const spiRef = "ds_test_bme280_spi";
    putDatasheet({
      ref: spiRef,
      pdfPath: "/x/bme280-spi.pdf",
      json: { ...validJson, protocol: { ...validJson.protocol, bus: "SPI" } },
    });
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: spiRef, target: "esp32" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/SPI/);
    expect(firstText(result)).toMatch(/portable/);
    // No raw stack leak — same standard the server already holds for other rejections.
    expect(firstText(result)).not.toMatch(/at Object\.|node_modules/);
  });

  it("generate_driver rejects a not-yet-supported native target (arduino)", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "arduino" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/not available yet/);
  });

  it("validate_driver passes a completed driver for the ref", async () => {
    const client = await connectClient();
    const files = generatePortableDriver(validJson).files.map((f) => ({
      path: f.path,
      content: f.content.replace(/TODO\(driverge\)/g, "done"),
    }));
    const result = await client.callTool({
      name: "validate_driver",
      arguments: { ref: REF, target: "portable", files },
    });
    const report = JSON.parse(firstText(result));
    expect(report.passed).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("validate_datasheet re-checks a cached ref", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "validate_datasheet",
      arguments: { ref: REF },
    });
    expect(JSON.parse(firstText(result)).valid).toBe(true);
  });

  it("validate_datasheet rejects malformed JSON with a clean error, not a raw TypeError", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "validate_datasheet",
      arguments: { json: { foo: 1 } },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/invalid datasheet JSON/i);
    expect(firstText(result)).not.toMatch(/Cannot read properties/);
  });

  it("analyze_datasheet reports a clear error for a missing PDF (regression pin)", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "analyze_datasheet",
      arguments: { pdf_path: "/definitely/not/a/real/path/bme280.pdf" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/file not found/);
  });

  it("serves the full JSON via the datasheet resource and the schema resource", async () => {
    const client = await connectClient();
    const ds = await client.readResource({ uri: `driverge://datasheet/${REF}` });
    expect(JSON.parse(ds.contents[0].text as string).metadata.part).toBe("BME280");

    const schema = await client.readResource({ uri: "driverge://schema" });
    expect((schema.contents[0].text as string).length).toBeGreaterThan(2);
  });

  it("exposes the generate-driver prompt", async () => {
    const client = await connectClient();
    const prompt = await client.getPrompt({
      name: "generate-driver",
      arguments: { ref: REF, target: "portable" },
    });
    expect(prompt.messages[0].content).toMatchObject({ type: "text" });
    expect((prompt.messages[0].content as { text: string }).text).toMatch(/validate_driver/);
  });
});

describe("generate_driver out_dir confinement", () => {
  const savedOutRoot = process.env.DRIVERGE_OUT_ROOT;
  let root: string;
  let outsideDir: string | undefined;

  beforeEach(() => {
    clearDatasheetCache();
    putDatasheet({ ref: REF, pdfPath: "/x/bme280.pdf", json: validJson });
    root = mkdtempSync(join(tmpdir(), "driverge-root-"));
    process.env.DRIVERGE_OUT_ROOT = root;
  });

  afterEach(() => {
    if (savedOutRoot === undefined) delete process.env.DRIVERGE_OUT_ROOT;
    else process.env.DRIVERGE_OUT_ROOT = savedOutRoot;
    rmSync(root, { recursive: true, force: true });
    if (outsideDir) {
      rmSync(outsideDir, { recursive: true, force: true });
      outsideDir = undefined;
    }
    // Pre-fix, an unconfined "../escape" out_dir would actually be created
    // relative to process.cwd() — sweep it up so a RED run leaves no litter.
    const strayEscape = join(process.cwd(), "..", "escape");
    if (existsSync(strayEscape)) rmSync(strayEscape, { recursive: true, force: true });
  });

  it("rejects an out_dir that escapes the root via ..", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "portable", out_dir: "../escape" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/out_dir/);
  });

  it("rejects an absolute out_dir outside the configured root", async () => {
    outsideDir = mkdtempSync(join(tmpdir(), "driverge-outside-"));
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "portable", out_dir: outsideDir },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/out_dir/);
  });

  it("accepts an out_dir inside the configured root and writes the driver files", async () => {
    const client = await connectClient();
    const dest = join(root, "out");
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: REF, target: "portable", out_dir: dest },
    });
    expect((result as ToolResult).isError).toBeFalsy();
    expect(existsSync(join(dest, "bme280.h"))).toBe(true);
    expect(existsSync(join(dest, "bme280.c"))).toBe(true);
  });
});
