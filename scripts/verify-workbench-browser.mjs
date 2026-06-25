#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url);
const port = Number(process.env.VERITIO_WORKBENCH_BROWSER_PORT ?? "4984");
const baseUrl = `http://127.0.0.1:${port}`;
const browserChannel = process.env.VERITIO_BROWSER_CHANNEL || undefined;
const viewports = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "mobile", width: 390, height: 844 },
];

/**
 * Starts the local Workbench from source and verifies the browser-visible
 * EvidenceCommit investigation surface across desktop and mobile viewports.
 */
async function main() {
  const server = spawn(
    "bun",
    [
      "--eval",
      `import { startWorkbenchServer } from "./server/node/src/index.ts"; await startWorkbenchServer({ host: "127.0.0.1", port: ${port}, allowWriteTools: true }); console.log("${baseUrl}"); await new Promise(() => {});`,
    ],
    {
      cwd: filePath(root),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = [];
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    await waitForHttp(baseUrl, 30_000);
    await verifyWorkbench(baseUrl);
    console.log("Workbench browser smoke passed.");
  } finally {
    server.kill("SIGTERM");
    await Promise.race([onceExit(server), delay(5_000).then(() => server.kill("SIGKILL"))]);
    if (process.env.VERITIO_BROWSER_DEBUG === "1") {
      console.log(output.join(""));
    }
  }
}

/**
 * Clicks the governed-change demo and checks that commit counts, commit rows,
 * verification dimensions, export files, and redaction behavior are visible.
 */
async function verifyWorkbench(url) {
  const browser = await chromium.launch({ headless: true, channel: browserChannel });
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: /Run governed change demo/i }).click();
        await page.waitForFunction(() => document.body.innerText.includes("cmt_project_entry_price_01"), null, {
          timeout: 15_000,
        });
        const text = await page.locator("body").innerText();
        assertIncludes(text, "Evidence Commits", viewport.name);
        assertIncludes(text, "commits ok", viewport.name);
        assertIncludes(text, "project.entry.rollback", viewport.name);
        assertIncludes(text, "commits.jsonl", viewport.name);
        assertIncludes(text, "cmt_project_entry_revert_01", viewport.name);
        assertExcludes(text, "buyer@example.com", viewport.name);
        assertExcludes(text, "scenario-hmac-secret", viewport.name);

        const horizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth - document.documentElement.clientWidth;
        });
        if (horizontalOverflow > 2) {
          throw new Error(`${viewport.name} layout has ${horizontalOverflow}px horizontal overflow`);
        }
        if (consoleErrors.length > 0) {
          throw new Error(`${viewport.name} browser console errors: ${consoleErrors.join("\n")}`);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Waits for the Workbench to answer HTTP requests before opening the browser.
 */
async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    await delay(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/**
 * Resolves URL objects to local filesystem paths without depending on cwd.
 */
function filePath(url) {
  return decodeURIComponent(url.pathname);
}

/**
 * Converts child-process completion into a promise for cleanup in all outcomes.
 */
function onceExit(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}

/**
 * Fails with the missing browser text so Workbench regressions are actionable.
 */
function assertIncludes(text, expected, viewportName) {
  if (!text.includes(expected)) {
    throw new Error(`expected ${viewportName} browser text to include ${expected}`);
  }
}

/**
 * Fails when prohibited raw payload or key material appears in browser text.
 */
function assertExcludes(text, prohibited, viewportName) {
  if (text.includes(prohibited)) {
    throw new Error(`${viewportName} browser text exposed prohibited value ${prohibited}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
