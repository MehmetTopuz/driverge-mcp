import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

  // Session 10 / Contract B1 — validate_driver no longer needs a `target`: the
  // lint rules it applies (thin-HAL purity, TODO markers, register/command
  // references, bit masks) are read straight from the cached ref's datasheet
  // JSON, not from the codegen target. Pin: the tool's advertised input schema
  // must drop `target` entirely, not just make it optional.
  it("validate_driver's input schema advertises ref/files but not target (B1)", async () => {
    const client = await connectClient();
    const tools = (await client.listTools()).tools;
    const validateDriver = tools.find((t) => t.name === "validate_driver");
    expect(validateDriver).toBeDefined();
    const properties =
      (validateDriver?.inputSchema as { properties?: Record<string, unknown> } | undefined)
        ?.properties ?? {};
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["ref", "files"]));
    expect(properties).not.toHaveProperty("target");
  });

  // Session 10 / Contract B — server version should track package.json, not a
  // hardcoded literal in server.ts. NOTE: this is a regression pin, not a true
  // RED today — server.ts currently hardcodes SERVER_VERSION = "0.0.0", which
  // coincidentally EQUALS package.json's current version ("0.0.0"), so this
  // assertion passes before any code change. The real RED only appears once the
  // package version is bumped without updating server.ts to match. The
  // string-shape assertions (non-empty, matches name) are pinned regardless.
  it("reports a server version matching package.json (regression pin — see comment)", async () => {
    const client = await connectClient();
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    const info = client.getServerVersion();
    expect(info).toBeDefined();
    expect(info?.name).toBe("driverge-mcp");
    expect(typeof info?.version).toBe("string");
    expect(info?.version.length).toBeGreaterThan(0);
    expect(info?.version).toBe(pkg.version);
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

  // Session A: esp32/stm32 gained native SPI support, so a SPI part is no
  // longer refused — it now succeeds (see positive pin below). The B1 pin
  // moves to a genuinely unsupported bus (UART/unknown), mirroring the
  // describe.each(["UART", "unknown"]) pattern in tests/codegen/esp32.test.ts.
  it("generate_driver renders the esp32 target for a SPI part (native SPI support, Session A)", async () => {
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
    expect((result as ToolResult).isError).toBeFalsy();
    const artifact = JSON.parse(firstText(result));
    expect(artifact.files.map((f: { path: string }) => f.path)).toContain("bme280_hal_esp32.c");
  });

  // Session B: esp32/stm32 gained native UART support, so a UART part is no
  // longer refused — it now succeeds (see positive pin below), mirroring the
  // SPI positive pin added in Session A above.
  it("generate_driver renders the esp32 target for a UART part (native UART support, Session B)", async () => {
    const uartRef = "ds_test_bme280_uart";
    putDatasheet({
      ref: uartRef,
      pdfPath: "/x/bme280-uart.pdf",
      json: { ...validJson, protocol: { bus: "UART" } },
    });
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: uartRef, target: "esp32" },
    });
    expect((result as ToolResult).isError).toBeFalsy();
    const artifact = JSON.parse(firstText(result));
    expect(artifact.files.map((f: { path: string }) => f.path)).toContain("bme280_hal_esp32.c");
  });

  describe.each(["unknown"] as const)(
    "generate_driver refuses a bus a native target (esp32) doesn't support (%s)",
    (bus) => {
      it(`rejects ${bus} cleanly (B1 regression pin)`, async () => {
        const ref = `ds_test_bme280_${bus.toLowerCase()}`;
        putDatasheet({
          ref,
          pdfPath: `/x/bme280-${bus.toLowerCase()}.pdf`,
          json: { ...validJson, protocol: { ...validJson.protocol, bus } },
        });
        const client = await connectClient();
        const result = await client.callTool({
          name: "generate_driver",
          arguments: { ref, target: "esp32" },
        });
        expect((result as ToolResult).isError).toBe(true);
        expect(firstText(result)).toMatch(new RegExp(bus, "i"));
        expect(firstText(result)).toMatch(/portable/);
        // No raw stack leak — same standard the server already holds for other rejections.
        expect(firstText(result)).not.toMatch(/at Object\.|node_modules/);
      });
    },
  );

  // Session C: esp32 gains native CAN/TWAI support, so — mirroring the SPI/UART
  // positive pins above — a CAN ref now SUCCEEDS on esp32 instead of being
  // refused. "CAN" is deliberately NOT added to the describe.each(["unknown"])
  // refusal block above: esp32 genuinely supports it now.
  it("generate_driver renders the esp32 target for a CAN part (native CAN/TWAI support, Session C)", async () => {
    const canRef = "ds_test_bme280_can";
    // Cast through `unknown`: "CAN" is not yet a member of the `Bus` union
    // (src/schema/types.ts) — that is the coder's job this session.
    putDatasheet({
      ref: canRef,
      pdfPath: "/x/bme280-can.pdf",
      json: { ...validJson, protocol: { bus: "CAN" } } as unknown as DatasheetJson,
    });
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: canRef, target: "esp32" },
    });
    expect((result as ToolResult).isError).toBeFalsy();
    const artifact = JSON.parse(firstText(result));
    expect(artifact.files.map((f: { path: string }) => f.path)).toContain("bme280_hal_esp32.c");
  });

  // Session C: STM32 stays OUT of scope for CAN (bxCAN/FDCAN family split
  // deferred to a future session) — the standard UnsupportedBusError refusal,
  // pinned at both the codegen level (tests/codegen/stm32.test.ts's
  // describe.each(["CAN", "unknown"])) and here at the MCP tool-call level.
  it("generate_driver refuses the stm32 target for a CAN part (Session C: STM32 CAN deferred to a future session)", async () => {
    const canRef = "ds_test_bme280_can_stm32";
    putDatasheet({
      ref: canRef,
      pdfPath: "/x/bme280-can-stm32.pdf",
      json: { ...validJson, protocol: { bus: "CAN" } } as unknown as DatasheetJson,
    });
    const client = await connectClient();
    const result = await client.callTool({
      name: "generate_driver",
      arguments: { ref: canRef, target: "stm32" },
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(firstText(result)).toMatch(/CAN/);
    expect(firstText(result)).toMatch(/portable/);
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

  // Session 10 / Contract A note: analyze_datasheet's hint passthrough
  // (manufacturer_hint / interface_kind_hint -> assembleDatasheet's opts) is
  // NOT re-pinned at this tools level — each case would need a full PDF parse,
  // which is too slow for this suite. The contract is pinned once, cheaply,
  // against assembleDatasheet directly in tests/schema/assemble.test.ts.
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

  // Session D: generate_driver gains a `language` option ("c" default | "cpp"
  // class wrapper). See wiki: thin-hal-non-negotiable (the cpp flavor keeps the
  // same #define macros + extern "C" hal_* seam).
  describe("generate_driver — language option (Session D)", () => {
    it("advertises a `language` input with both c/cpp members", async () => {
      const client = await connectClient();
      const tools = (await client.listTools()).tools;
      const generateDriverTool = tools.find((t) => t.name === "generate_driver");
      expect(generateDriverTool).toBeDefined();
      const properties =
        (generateDriverTool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
          ?.properties ?? {};
      expect(properties).toHaveProperty("language");
      const languageSchema = JSON.stringify(properties.language);
      expect(languageSchema).toMatch(/"cpp"/);
      expect(languageSchema).toMatch(/"c"/);
    });

    it("without language, defaults to c: .h/.c files exactly as today", async () => {
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
    });

    it('with language "cpp", the portable target renders .hpp/.cpp files', async () => {
      const client = await connectClient();
      const result = await client.callTool({
        name: "generate_driver",
        arguments: { ref: REF, target: "portable", language: "cpp" },
      });
      expect((result as ToolResult).isError).toBeFalsy();
      const artifact = JSON.parse(firstText(result));
      expect(artifact.files.map((f: { path: string }) => f.path)).toEqual([
        "bme280.hpp",
        "bme280.cpp",
      ]);
    });

    // Amended (orchestrator, post-GREEN 4b3da14/d576ba6): the cpp seam is
    // `_hal_esp32.cpp`, not `.c` — the `.c` seam `#include`s "bme280.h", which
    // doesn't exist in a cpp bundle. See tests/codegen/cpp-native.test.ts.
    it('with language "cpp", a native target (esp32) gets a `_hal_esp32.cpp` seam file — no .h file anywhere', async () => {
      const client = await connectClient();
      const result = await client.callTool({
        name: "generate_driver",
        arguments: { ref: REF, target: "esp32", language: "cpp" },
      });
      expect((result as ToolResult).isError).toBeFalsy();
      const artifact = JSON.parse(firstText(result));
      const paths = artifact.files.map((f: { path: string }) => f.path);
      expect(paths).toContain("bme280_hal_esp32.cpp");
      expect(paths).toContain("bme280.hpp");
      expect(paths).toContain("bme280.cpp");
      expect(paths.some((p: string) => p.endsWith(".h"))).toBe(false);
      for (const f of artifact.files as { path: string; content: string }[]) {
        expect(f.content).not.toContain('"bme280.h"');
      }
    });

    it("rejects an invalid language value (e.g. 'rust') via schema validation", async () => {
      const client = await connectClient();
      const result = await client.callTool({
        name: "generate_driver",
        arguments: { ref: REF, target: "portable", language: "rust" },
      });
      expect((result as ToolResult).isError).toBe(true);
      expect(firstText(result)).toMatch(/language/i);
    });

    it("the generate-driver prompt's rendered text mentions the language option", async () => {
      const client = await connectClient();
      const prompt = await client.getPrompt({
        name: "generate-driver",
        arguments: { ref: REF, target: "portable" },
      });
      const renderedText = (prompt.messages[0].content as { text: string }).text;
      expect(renderedText).toMatch(/language/i);
    });
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
