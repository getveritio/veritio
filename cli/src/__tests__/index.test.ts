import { describe, expect, test } from "bun:test";
import { isCliEntrypoint, parseCliArgs, runCli } from "../index";

describe("parseCliArgs", () => {
  test("parses veritio dev --mcp with safe defaults", () => {
    expect(parseCliArgs(["dev", "--mcp"])).toEqual({
      command: "dev",
      mcp: true,
      host: "127.0.0.1",
      port: 4983,
      allowWriteTools: false,
      scenario: false,
    });
  });

  test("parses local dev server options", () => {
    expect(parseCliArgs(["dev", "--mcp", "--host", "0.0.0.0", "--port", "4999", "--allow-write-tools", "--scenario"])).toEqual({
      command: "dev",
      mcp: true,
      host: "0.0.0.0",
      port: 4999,
      allowWriteTools: true,
      scenario: true,
    });
  });

  test("rejects unsupported commands and invalid ports", () => {
    expect(() => parseCliArgs(["serve"])).toThrow("Usage: veritio dev --mcp");
    expect(() => parseCliArgs(["dev", "--mcp", "--port", "70000"])).toThrow("port must be between 0 and 65535");
  });
});

describe("runCli", () => {
  test("starts the Workbench server and reports URLs", async () => {
    const starts: Array<{ host: string; port: number; allowWriteTools: boolean }> = [];
    const resultOutput: string[] = [];
    const result = await runCli(["dev", "--mcp", "--port", "0"], {
      async start(options) {
        starts.push({
          host: options.host,
          port: options.port,
          allowWriteTools: options.allowWriteTools,
        });
        return {
          url: "http://127.0.0.1:4983",
          close: async () => {},
        };
      },
      write(message) {
        resultOutput.push(message);
      },
    });

    expect(result.code).toBe(0);
    expect(starts).toEqual([{ host: "127.0.0.1", port: 0, allowWriteTools: false }]);
    expect(resultOutput.join("\n")).toContain("Veritio Workbench: http://127.0.0.1:4983");
    await result.server?.close();
  });
});

describe("isCliEntrypoint", () => {
  test("matches Bun relative argv paths against the module URL", () => {
    expect(isCliEntrypoint("file:///repo/cli/src/index.ts", "cli/src/index.ts", "/repo")).toBe(true);
    expect(isCliEntrypoint("file:///repo/cli/src/index.ts", "/repo/cli/src/index.ts", "/repo")).toBe(true);
    expect(isCliEntrypoint("file:///repo/cli/src/index.ts", "cli/src/other.ts", "/repo")).toBe(false);
  });
});
