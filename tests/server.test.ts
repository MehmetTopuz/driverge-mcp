import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../src/server";

type TextContent = { type: string; text?: string };

let open: { client: Client; server: McpServer } | undefined;

// Wire a freshly-built server to a client over an in-memory transport pair so
// tool registration and invocation can be exercised deterministically at host
// level — no child process, no real stdio.
async function connectClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "driverge-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  open = { client, server };
  return client;
}

afterEach(async () => {
  if (open) {
    await open.client.close();
    await open.server.close();
    open = undefined;
  }
});

describe("Driverge MCP server", () => {
  it("registers the ping tool with a description", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const ping = tools.find((tool) => tool.name === "ping");
    expect(ping).toBeDefined();
    expect((ping?.description ?? "").length).toBeGreaterThan(0);
  });

  it("responds to ping with 'pong' when no message is given", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "ping", arguments: {} });
    const content = result.content as TextContent[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text", text: "pong" });
  });

  it("echoes the message in the ping response", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "ping",
      arguments: { message: "driverge" },
    });
    const content = result.content as TextContent[];
    expect(content[0]).toMatchObject({ type: "text", text: "pong: driverge" });
  });
});
