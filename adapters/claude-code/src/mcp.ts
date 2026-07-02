#!/usr/bin/env bun
import { createInterface } from "node:readline";
import type { FileEvidenceStore } from "@veritio/storage";
import { createFileEvidenceStore } from "@veritio/storage";
import { resolveConfig } from "./config.js";
import { exportSession, getSession, listSessions } from "./query.js";

/**
 * Reference query+export MCP server for the captured local provenance. A minimal
 * newline-delimited JSON-RPC stdio server (mirroring the Workbench's hand-rolled
 * MCP shape) exposing read-only tools — list sessions, fetch one session's graph,
 * and export a verifiable evidence bundle. It reads the same local file store the
 * hook writes; it never mutates evidence.
 */
const TOOLS = [
  {
    name: "veritio.list_sessions",
    description: "List captured agent sessions (optionally for one day=YYYY-MM-DD), newest first.",
    inputSchema: { type: "object", properties: { day: { type: "string" } } },
  },
  {
    name: "veritio.get_session",
    description: "Fetch one session's event records and its projected provenance graph.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  },
  {
    name: "veritio.export_session",
    description: "Export a verifiable evidence bundle (records + hash-chain verdict) for one session.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
  },
] as const;

interface RpcRequest {
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

async function dispatchTool(store: FileEvidenceStore, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "veritio.list_sessions":
      return listSessions(store, typeof args.day === "string" ? { day: args.day } : {});
    case "veritio.get_session":
      return getSession(store, requireString(args.sessionId, "sessionId"));
    case "veritio.export_session":
      return exportSession(store, requireString(args.sessionId, "sessionId"));
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

async function handle(store: FileEvidenceStore, request: RpcRequest): Promise<Record<string, unknown> | null> {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize":
      return result(id, {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "veritio-provenance", version: "0.0.0" },
        capabilities: { tools: {} },
      });
    case "notifications/initialized":
      return null; // notification — no response
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      const params = request.params ?? {};
      const args = isObject(params.arguments) ? params.arguments : {};
      try {
        const data = await dispatchTool(store, String(params.name ?? ""), args);
        return result(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (error) {
        return rpcError(id, -32000, error instanceof Error ? error.message : String(error));
      }
    }
    default:
      return request.id === undefined ? null : rpcError(id, -32601, `Unsupported method: ${request.method}`);
  }
}

function result(id: string | number | null, value: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result: value };
}
function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const store = createFileEvidenceStore(resolveConfig(process.env).localDir);
const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let request: RpcRequest;
  try {
    request = JSON.parse(text) as RpcRequest;
  } catch {
    return; // ignore non-JSON lines
  }
  void handle(store, request).then((response) => {
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
});
