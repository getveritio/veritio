#!/usr/bin/env node
import {
  LocalEvidenceStore,
  runIntegrationScenario,
  startWorkbenchServer,
  type StartedWorkbenchServer,
  type StartWorkbenchServerOptions,
} from "@veritio/server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DevCommandOptions {
  command: "dev";
  mcp: boolean;
  host: string;
  port: number;
  allowWriteTools: boolean;
  scenario: boolean;
}

export interface CliDependencies {
  start(options: StartWorkbenchServerOptions): Promise<Pick<StartedWorkbenchServer, "url" | "close">>;
  write(message: string): void;
}

export interface CliRunResult {
  code: number;
  server?: Pick<StartedWorkbenchServer, "url" | "close">;
}

const USAGE = "Usage: veritio dev --mcp [--host 127.0.0.1] [--port 4983] [--allow-write-tools] [--scenario]";

export function parseCliArgs(args: readonly string[]): DevCommandOptions {
  if (args[0] !== "dev") {
    throw new TypeError(USAGE);
  }

  const options: DevCommandOptions = {
    command: "dev",
    mcp: false,
    host: "127.0.0.1",
    port: 4983,
    allowWriteTools: false,
    scenario: false,
  };

  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--mcp":
        options.mcp = true;
        break;
      case "--host":
        options.host = requireNext(args, ++index, "--host");
        break;
      case "--port":
        options.port = parsePort(requireNext(args, ++index, "--port"));
        break;
      case "--allow-write-tools":
        options.allowWriteTools = true;
        break;
      case "--scenario":
        options.scenario = true;
        break;
      default:
        throw new TypeError(`Unknown option: ${arg}\n${USAGE}`);
    }
  }

  if (!options.mcp) {
    throw new TypeError(USAGE);
  }
  return options;
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  dependencies: Partial<CliDependencies> = {},
): Promise<CliRunResult> {
  const write = dependencies.write ?? ((message: string) => process.stdout.write(`${message}\n`));
  try {
    const options = parseCliArgs(args);
    const store = new LocalEvidenceStore();
    if (options.scenario) {
      await runIntegrationScenario(store);
    }
    const start = dependencies.start ?? startWorkbenchServer;
    const server = await start({
      store,
      host: options.host,
      port: options.port,
      allowWriteTools: options.allowWriteTools,
    });
    write(`Veritio Workbench: ${server.url}`);
    write(`MCP endpoint: ${server.url}/mcp`);
    write(`MCP write tools: ${options.allowWriteTools ? "enabled" : "disabled"}`);
    return { code: 0, server };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(message);
    return { code: 1 };
  }
}

function requireNext(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("port must be between 0 and 65535");
  }
  return port;
}

export function isCliEntrypoint(metaUrl: string, argvPath: string | undefined, cwd = process.cwd()): boolean {
  if (!argvPath) {
    return false;
  }
  return fileURLToPath(metaUrl) === resolve(cwd, argvPath);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const result = await runCli();
  if (result.code !== 0) {
    process.exitCode = result.code;
  }
}
