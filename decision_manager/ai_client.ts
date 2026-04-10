/**
 * Thin wrapper around AI APIs.
 * Prefers KeploreAI (DashScope-compatible) when a kplr-... key is found in
 * ~/.config/physmind/credentials; falls back to Anthropic SDK otherwise.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const FAST_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_MAX_TOKENS = 4096;

// KeploreAI proxy — same endpoint the CLI uses (pty-worker.cjs DASHSCOPE_BASE_URL)
const KPLR_BASE_URL = "https://physmind-proxy.marvin-gao-cs.workers.dev/v1";
const DASHSCOPE_DEFAULT_MODEL = "qwen3.6-plus";
const DASHSCOPE_FAST_MODEL = "qwen3.6-plus";

function readKplrKey(): string | null {
  const credFile = join(homedir(), ".config", "physmind", "credentials");
  if (!existsSync(credFile)) return null;
  try {
    for (const line of readFileSync(credFile, "utf-8").split("\n")) {
      const m = line.match(/^KPLR_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function toDashScopeModel(model: string): string {
  return model === FAST_MODEL ? DASHSCOPE_FAST_MODEL : DASHSCOPE_DEFAULT_MODEL;
}

// ── DashScope (OpenAI-compatible) via native fetch ───────────────────────────

interface DSMessage { role: "system" | "user" | "assistant"; content: string; }

async function dsCall(apiKey: string, model: string, messages: DSMessage[], maxTokens: number, temperature?: number): Promise<string> {
  const res = await fetch(`${KPLR_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) }),
  });
  if (!res.ok) throw new Error(`api returned ${res.status} ${res.statusText}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function dsStream(apiKey: string, model: string, messages: DSMessage[], maxTokens: number, temperature: number | undefined, onChunk: (t: string) => void, onDone?: (t: string) => void): Promise<void> {
  const res = await fetch(`${KPLR_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true, ...(temperature !== undefined ? { temperature } : {}) }),
  });
  if (!res.ok) throw new Error(`api returned ${res.status} ${res.statusText}: ${await res.text()}`);

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let full = "", buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") break;
      try {
        const chunk = JSON.parse(payload) as { choices: { delta: { content?: string } }[] };
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) { full += text; onChunk(text); }
      } catch {}
    }
  }
  onDone?.(full);
}

// ── Anthropic fallback ───────────────────────────────────────────────────────

let _client: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ChatMessage { role: "user" | "assistant"; content: string; }

export interface AiCallOptions {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function aiCall(opts: AiCallOptions): Promise<string> {
  const kplrKey = readKplrKey() ?? process.env.KPLR_KEY;
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (kplrKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsCall(kplrKey, toDashScopeModel(model), msgs, maxTokens, opts.temperature);
  }

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model, max_tokens: maxTokens, temperature: opts.temperature,
    system: opts.system, messages: opts.messages,
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type: " + block.type);
  return block.text;
}

export interface StreamCallOptions extends AiCallOptions {
  onChunk: (text: string) => void;
  onDone?: (fullText: string) => void;
}

export async function aiStream(opts: StreamCallOptions): Promise<void> {
  const kplrKey = readKplrKey() ?? process.env.KPLR_KEY;
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (kplrKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsStream(kplrKey, toDashScopeModel(model), msgs, maxTokens, opts.temperature, opts.onChunk, opts.onDone);
  }

  const client = getAnthropicClient();
  let fullText = "";
  const stream = await client.messages.stream({
    model, max_tokens: maxTokens, temperature: opts.temperature,
    system: opts.system, messages: opts.messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      fullText += event.delta.text;
      opts.onChunk(event.delta.text);
    }
  }
  opts.onDone?.(fullText);
}
