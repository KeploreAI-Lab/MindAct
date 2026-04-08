/**
 * Thin wrapper around the Anthropic SDK.
 * All AI calls in decision_manager go through here —
 * keeps API key management, model selection, and retry logic in one place.
 */

import Anthropic from "@anthropic-ai/sdk";

// Model to use across all tasks. Change here to affect everything.
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const FAST_MODEL = "claude-haiku-4-5-20251001"; // for quick JSON classification tasks
export const DEFAULT_MAX_TOKENS = 4096;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCallOptions {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Single-turn or multi-turn non-streaming call. Returns full response text. */
export async function aiCall(opts: AiCallOptions): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature,
    system: opts.system,
    messages: opts.messages,
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type: " + block.type);
  return block.text;
}

export interface StreamCallOptions extends AiCallOptions {
  onChunk: (text: string) => void;
  onDone?: (fullText: string) => void;
}

/** Streaming call — invokes onChunk for each text delta. */
export async function aiStream(opts: StreamCallOptions): Promise<void> {
  const client = getClient();
  let fullText = "";

  const stream = await client.messages.stream({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.temperature,
    system: opts.system,
    messages: opts.messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullText += event.delta.text;
      opts.onChunk(event.delta.text);
    }
  }

  opts.onDone?.(fullText);
}
