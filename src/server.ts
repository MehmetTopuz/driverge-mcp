#!/usr/bin/env node
// Driverge MCP server — entry point.
//
// Exposes a stdio MCP server built with @modelcontextprotocol/sdk. Alongside a
// `ping` health check it registers the full Driverge surface (Session 6):
// analyze_datasheet / generate_driver / validate_driver / validate_datasheet
// tools, the datasheet + schema resources, and the generate-driver prompt.
// See wiki: mcp-tool-usage-flow.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerDriverge } from "./mcp/register.js";

const SERVER_NAME = "driverge-mcp";

// Read the version from package.json rather than hardcoding it (Session 10 /
// Contract B7), so it can't drift from what `npm` actually published. The
// relative path resolves correctly from BOTH src/ (ts-node/vitest) and dist/
// (the built, published layout) since both sit exactly one level under the
// package root. Falls back to "0.0.0" if the file is somehow unreadable —
// never crash the server over a version string.
function readServerVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const SERVER_VERSION = readServerVersion();

/**
 * Build a Driverge MCP server with its tools registered. Kept separate from the
 * transport wiring so tests can drive it over an in-memory transport.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check — returns 'pong' to confirm the Driverge MCP server is running.",
      inputSchema: { message: z.string().optional() },
    },
    async ({ message }) => ({
      content: [
        { type: "text" as const, text: message ? `pong: ${message}` : "pong" },
      ],
    }),
  );

  registerDriverge(server);

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  // stdio transport owns stdout exclusively — any stray dependency (or future
  // debug console.log) writing to stdout would corrupt JSON-RPC framing. Route
  // console.log/info to stderr instead, where nothing but human eyes read it.
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Whether `moduleUrl` (an `import.meta.url`) is the file Node was invoked to
 * run directly (`argv1`), rather than a module some other entry point
 * imported — e.g. the test suite importing server.ts as a library.
 *
 * A raw `fileURLToPath(moduleUrl) === argv1` string comparison (B1) breaks
 * under a POSIX npm-bin symlink: `npx driverge`/a global install invokes the
 * package's bin SYMLINK, so `argv1` is the symlink path, while
 * `fileURLToPath(import.meta.url)` resolves to the module's REAL (symlink
 * target) path — the two strings never match, so the installed CLI silently
 * does nothing. Falling back to a `realpathSync(argv1)` comparison resolves
 * the symlink to the same real path the module URL already has, so the direct
 * string match still short-circuits the common case and only the symlink
 * case pays for an extra syscall. `realpathSync` is wrapped in try/catch
 * because `argv1` could point at a file that no longer exists (or never did)
 * — in which case this is simply not that file, not a crash.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  const modulePath = fileURLToPath(moduleUrl);
  if (modulePath === argv1) return true;
  try {
    return realpathSync(argv1) === modulePath;
  } catch {
    return false;
  }
}

// Start the stdio server only when this file is executed directly (via the
// `driverge` bin), not when imported — e.g. by the test suite.
const isDirectRun = isMainModule(import.meta.url, process.argv[1]);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error("driverge-mcp failed to start:", error);
    process.exit(1);
  });
}
