/**
 * Provider-reported token usage extraction (pure).
 *
 * The gateway meters exclusively from what providers report in their own
 * responses (`costBasis: "provider_reported"`); it never runs tokenizers.
 * Absent or malformed usage yields `null` and the evidence event simply
 * omits tokens/cost — the gateway must never guess a number that later
 * feeds a chargeback report.
 *
 * Wire formats handled (documented provider behavior at authoring time):
 * - Anthropic JSON: `usage.input_tokens` / `usage.output_tokens`.
 * - Anthropic SSE: `message_start` carries `message.usage.input_tokens`;
 *   `message_delta` frames carry cumulative `usage.output_tokens` (latest
 *   frame wins) and may restate `input_tokens`.
 * - OpenAI JSON: `usage.prompt_tokens` / `usage.completion_tokens`.
 * - OpenAI SSE: one final data frame before `[DONE]` carries `usage` when
 *   the request set `stream_options.include_usage`.
 */
import type { GatewayProvider } from "./config";

/** Token counts as reported by the provider for one request. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function usageFrom(record: unknown, inputField: string, outputField: string): Partial<Usage> | null {
  if (typeof record !== "object" || record === null) return null;
  const raw = record as Record<string, unknown>;
  const input = asCount(raw[inputField]);
  const output = asCount(raw[outputField]);
  if (input === null && output === null) return null;
  const partial: Partial<Usage> = {};
  if (input !== null) partial.inputTokens = input;
  if (output !== null) partial.outputTokens = output;
  return partial;
}

/**
 * Extracts usage from a parsed non-streaming response body. Returns null
 * when the body carries no recognizable usage object — callers must omit
 * token/cost metadata rather than substitute zeros.
 */
export function extractJsonUsage(provider: GatewayProvider, body: unknown): Usage | null {
  if (typeof body !== "object" || body === null) return null;
  const usage = (body as Record<string, unknown>).usage;
  const partial =
    provider === "anthropic"
      ? usageFrom(usage, "input_tokens", "output_tokens")
      : usageFrom(usage, "prompt_tokens", "completion_tokens");
  if (partial === null) return null;
  return { inputTokens: partial.inputTokens ?? 0, outputTokens: partial.outputTokens ?? 0 };
}

/**
 * Incremental SSE usage reader fed from the tee'd response branch. Feed
 * accepts arbitrary chunk boundaries (a `data:` line may split mid-JSON
 * across network chunks), so input is line-buffered internally. Malformed
 * frames are skipped — a proxy must never throw over a provider's stream
 * formatting while the client branch is still being served.
 */
export interface SseUsageAccumulator {
  feed(chunk: string): void;
  usage(): Usage | null;
}

/** Creates the per-request accumulator for one provider's SSE dialect. */
export function createSseUsageAccumulator(provider: GatewayProvider): SseUsageAccumulator {
  let buffer = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  function absorb(frame: unknown): void {
    if (typeof frame !== "object" || frame === null) return;
    const record = frame as Record<string, unknown>;
    if (provider === "anthropic") {
      if (record.type === "message_start") {
        const message = record.message as Record<string, unknown> | undefined;
        const partial = usageFrom(message?.usage, "input_tokens", "output_tokens");
        if (partial?.inputTokens !== undefined) inputTokens = partial.inputTokens;
        if (partial?.outputTokens !== undefined) outputTokens = partial.outputTokens;
      } else if (record.type === "message_delta") {
        const partial = usageFrom(record.usage, "input_tokens", "output_tokens");
        if (partial?.inputTokens !== undefined) inputTokens = partial.inputTokens;
        if (partial?.outputTokens !== undefined) outputTokens = partial.outputTokens;
      }
      return;
    }
    const partial = usageFrom(record.usage, "prompt_tokens", "completion_tokens");
    if (partial?.inputTokens !== undefined) inputTokens = partial.inputTokens;
    if (partial?.outputTokens !== undefined) outputTokens = partial.outputTokens;
  }

  function consumeLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") return;
    try {
      absorb(JSON.parse(payload));
    } catch {
      // Malformed frame: skip. Usage stays null unless a valid frame arrives.
    }
  }

  return {
    feed(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    usage() {
      if (buffer.length > 0) {
        consumeLine(buffer);
        buffer = "";
      }
      if (inputTokens === null && outputTokens === null) return null;
      return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
    },
  };
}
