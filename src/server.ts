#!/usr/bin/env node
// Driverge MCP server — entry point.
//
// Exposes a stdio MCP server built with @modelcontextprotocol/sdk. Alongside a
// `ping` health check it registers the full Driverge surface (Session 6):
// analyze_datasheet / generate_driver / validate_driver / validate_datasheet
// tools, the datasheet + schema resources, and the generate-driver prompt.
// See wiki: mcp-tool-usage-flow.

import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerDriverge } from "./mcp/register.js";

const SERVER_NAME = "driverge-mcp";
const SERVER_VERSION = "0.0.0";

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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Start the stdio server only when this file is executed directly (via the
// `driverge` bin), not when imported — e.g. by the test suite.
const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error("driverge-mcp failed to start:", error);
    process.exit(1);
  });
}
