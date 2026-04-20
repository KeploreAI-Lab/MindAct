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

type Provider = "keplore" | "minimax" | "openai_compatible" | "anthropic";

// KeploreAI proxy — same endpoint the CLI uses (pty-worker.cjs DASHSCOPE_BASE_URL)
const KPLR_BASE_URL_DEFAULT = "https://physmind-proxy.marvin-gao-cs.workers.dev/v1";
const KPLR_DEFAULT_MODEL_DEFAULT = "qwen-plus";
const KPLR_FAST_MODEL_DEFAULT = "qwen-plus";

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

function envStr(name: string): string | undefined {
  const v = process.env[name];
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
}

function envProvider(): Provider | undefined {
  const v = (envStr("MINDACT_AI_PROVIDER") || "").toLowerCase();
  if (v === "keplore" || v === "minimax" || v === "openai_compatible" || v === "anthropic") return v;
  if (v === "openai" || v === "openai-compatible" || v === "oai") return "openai_compatible";
  return undefined;
}

function resolveProvider(): Provider {
  // Explicit override wins
  const p = envProvider();
  if (p) return p;
  // Backwards compatible behavior: if KPLR_KEY exists, use keplore; else anthropic.
  const kplrKey = readKplrKey() ?? process.env.KPLR_KEY;
  return kplrKey ? "keplore" : "anthropic";
}

function resolveOpenAICompatible(): { baseUrl: string; apiKey: string; defaultModel: string; fastModel: string } {
  const baseUrl = envStr("MINDACT_OPENAI_BASE_URL") ?? "";
  const apiKey = envStr("MINDACT_OPENAI_API_KEY") ?? "";
  const defaultModel = envStr("MINDACT_OPENAI_MODEL") ?? "gpt-4o-mini";
  const fastModel = envStr("MINDACT_OPENAI_FAST_MODEL") ?? defaultModel;
  if (!baseUrl) throw new Error("MINDACT_OPENAI_BASE_URL is not set");
  if (!apiKey) throw new Error("MINDACT_OPENAI_API_KEY is not set");
  return { baseUrl, apiKey, defaultModel, fastModel };
}

function resolveKeplore(): { baseUrl: string; apiKey: string; defaultModel: string; fastModel: string } {
  const apiKey = (readKplrKey() ?? process.env.KPLR_KEY ?? "").trim();
  if (!apiKey) throw new Error("KPLR_KEY is not set");
  const baseUrl = envStr("MINDACT_KPLR_BASE_URL") ?? KPLR_BASE_URL_DEFAULT;
  const defaultModel = envStr("MINDACT_KPLR_MODEL") ?? KPLR_DEFAULT_MODEL_DEFAULT;
  const fastModel = envStr("MINDACT_KPLR_FAST_MODEL") ?? KPLR_FAST_MODEL_DEFAULT;
  return { baseUrl, apiKey, defaultModel, fastModel };
}

function resolveMinimax(): { baseUrl: string; apiKey: string; defaultModel: string; fastModel: string } {
  // Minimax can be used in two ways:
  // 1) OpenAI-compatible gateway: POST {baseUrl}/chat/completions
  // 2) Anthropic-compatible gateway: use @anthropic-ai/sdk with baseURL (recommended by MiniMax docs)
  //
  // This function returns the OpenAI-compatible parameters only.
  const baseUrl = envStr("MINDACT_MINIMAX_BASE_URL") ?? envStr("MINDACT_OPENAI_BASE_URL") ?? "";
  const apiKey = envStr("MINDACT_MINIMAX_API_KEY") ?? envStr("MINDACT_OPENAI_API_KEY") ?? "";
  const defaultModel = envStr("MINDACT_MINIMAX_MODEL") ?? envStr("MINDACT_OPENAI_MODEL") ?? "MiniMax-Text-01";
  const fastModel = envStr("MINDACT_MINIMAX_FAST_MODEL") ?? envStr("MINDACT_OPENAI_FAST_MODEL") ?? defaultModel;
  if (!baseUrl) throw new Error("MINDACT_MINIMAX_BASE_URL is not set");
  if (!apiKey) throw new Error("MINDACT_MINIMAX_API_KEY is not set");
  return { baseUrl, apiKey, defaultModel, fastModel };
}

function minimaxStyle(): "anthropic" | "openai" {
  const s = (envStr("MINDACT_MINIMAX_API_STYLE") || "").toLowerCase();
  return s === "anthropic" ? "anthropic" : "openai";
}

function resolveMinimaxAnthropic(): { baseUrl: string; apiKey: string; defaultModel: string; fastModel: string } {
  // MiniMax Anthropic-compatible base URL (per docs):
  // https://platform.minimax.io/docs/api-reference/text-anthropic-api
  const baseUrl = envStr("MINDACT_MINIMAX_ANTHROPIC_BASE_URL") ?? "https://api.minimax.io/anthropic";
  const apiKey = envStr("MINDACT_MINIMAX_API_KEY") ?? "";
  const defaultModel = envStr("MINDACT_MINIMAX_MODEL") ?? "MiniMax-M2.7";
  const fastModel = envStr("MINDACT_MINIMAX_FAST_MODEL") ?? defaultModel;
  if (!apiKey) throw new Error("MINDACT_MINIMAX_API_KEY is not set");
  return { baseUrl, apiKey, defaultModel, fastModel };
}

function resolveModel(provider: Provider, model: string): string {
  if (provider === "keplore") {
    const { defaultModel, fastModel } = resolveKeplore();
    return model === FAST_MODEL ? fastModel : defaultModel;
  }
  if (provider === "minimax") {
    const { defaultModel, fastModel } =
      minimaxStyle() === "anthropic" ? resolveMinimaxAnthropic() : resolveMinimax();
    return model === FAST_MODEL ? fastModel : defaultModel;
  }
  if (provider === "openai_compatible") {
    const { defaultModel, fastModel } = resolveOpenAICompatible();
    return model === FAST_MODEL ? fastModel : defaultModel;
  }
  // anthropic: pass through original model
  return model;
}

// ── DashScope (OpenAI-compatible) via native fetch ───────────────────────────

interface DSMessage { role: "system" | "user" | "assistant"; content: string; }

async function oaiCall(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: DSMessage[];
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  const res = await fetch(`${params.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    }),
  });
  if (!res.ok) throw new Error(`api returned ${res.status} ${res.statusText}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function oaiStream(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: DSMessage[];
  maxTokens: number;
  temperature?: number;
  onChunk: (t: string) => void;
  onDone?: (t: string) => void;
}): Promise<void> {
  const res = await fetch(`${params.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens,
      stream: true,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    }),
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
        if (text) { full += text; params.onChunk(text); }
      } catch {}
    }
  }
  params.onDone?.(full);
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

let _minimaxAnthropicClient: Anthropic | null = null;
function getMinimaxAnthropicClient(): Anthropic {
  if (_minimaxAnthropicClient) return _minimaxAnthropicClient;
  const cfg = resolveMinimaxAnthropic();
  _minimaxAnthropicClient = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return _minimaxAnthropicClient;
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
  const provider = resolveProvider();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (provider === "minimax" && minimaxStyle() === "anthropic") {
    const client = getMinimaxAnthropicClient();
    const response = await client.messages.create({
      model: resolveModel(provider, model),
      max_tokens: maxTokens,
      temperature: opts.temperature,
      system: opts.system,
      messages: opts.messages,
    });
    const block = response.content.find((b: any) => b.type === "text") ?? response.content[0];
    if (block?.type !== "text") throw new Error("Unexpected response type: " + (block?.type ?? "unknown"));
    return block.text;
  }

  if (provider === "keplore" || provider === "minimax" || provider === "openai_compatible") {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    const resolved =
      provider === "keplore" ? resolveKeplore()
      : provider === "minimax" ? resolveMinimax()
      : resolveOpenAICompatible();
    return oaiCall({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolveModel(provider, model),
      messages: msgs,
      maxTokens,
      temperature: opts.temperature,
    });
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
  const provider = resolveProvider();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (provider === "minimax" && minimaxStyle() === "anthropic") {
    const client = getMinimaxAnthropicClient();
    let fullText = "";
    const stream = await client.messages.stream({
      model: resolveModel(provider, model),
      max_tokens: maxTokens,
      temperature: opts.temperature,
      system: opts.system,
      messages: opts.messages,
    });
    for await (const event of stream) {
      // MiniMax Anthropic-compatible API supports text deltas (thinking deltas are ignored here)
      if (event.type === "content_block_delta" && (event as any).delta?.type === "text_delta") {
        const t = (event as any).delta.text ?? "";
        if (t) {
          fullText += t;
          opts.onChunk(t);
        }
      }
    }
    opts.onDone?.(fullText);
    return;
  }

  if (provider === "keplore" || provider === "minimax" || provider === "openai_compatible") {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    const resolved =
      provider === "keplore" ? resolveKeplore()
      : provider === "minimax" ? resolveMinimax()
      : resolveOpenAICompatible();
    return oaiStream({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolveModel(provider, model),
      messages: msgs,
      maxTokens,
      temperature: opts.temperature,
      onChunk: opts.onChunk,
      onDone: opts.onDone,
    });
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
