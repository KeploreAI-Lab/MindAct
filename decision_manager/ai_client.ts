/**
 * Thin wrapper around AI APIs.
 * Backend is selected by the user in Settings (stored in ~/.physmind/config.json as selected_backend).
 * Falls back to key-presence heuristic: MiniMax > KeploreAI > GLM > Anthropic.
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

// MiniMax API (Anthropic-compatible)
const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_DEFAULT_MODEL = "minimax-m2.7";
const MINIMAX_FAST_MODEL = "minimax-m2.7";

// GLM / 智谱AI (OpenAI-compatible)
const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const GLM_DEFAULT_MODEL = "glm-4-plus";
const GLM_FAST_MODEL = "glm-4-flash";

// Nvidia NIM API (OpenAI-compatible) — free-tier models including Kimi 2.5
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_DEFAULT_MODEL = "moonshotai/kimi-k2.5";
const NVIDIA_FAST_MODEL = "moonshotai/kimi-k1.5";

// ── Credential / config readers ──────────────────────────────────────────────

function physmindCredFile(): string {
  return join(homedir(), ".config", "physmind", "credentials");
}

function readCredKey(prefix: string): string | null {
  const credFile = physmindCredFile();
  if (!existsSync(credFile)) return null;
  try {
    for (const line of readFileSync(credFile, "utf-8").split("\n")) {
      const m = line.match(new RegExp(`^${prefix}="?([^"]+)"?`));
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function readMinimaxKey(): string | null { return readCredKey("MINIMAX_KEY"); }
function readKplrKey(): string | null { return readCredKey("KPLR_KEY"); }
function readGlmKey(): string | null { return readCredKey("GLM_KEY"); }
function readNvidiaKey(): string | null { return readCredKey("NVIDIA_KEY"); }
function readCustomKey(): string | null { return readCredKey("CUSTOM_KEY"); }

function readCustomProviderConfig(): { url: string | null; model: string | null; modelFast: string | null } {
  try {
    const cfgFile = join(homedir(), ".physmind", "config.json");
    if (!existsSync(cfgFile)) return { url: null, model: null, modelFast: null };
    const cfg = JSON.parse(readFileSync(cfgFile, "utf-8"));
    return {
      url: cfg.custom_provider_url ?? null,
      model: cfg.custom_provider_model ?? null,
      modelFast: cfg.custom_provider_model_fast ?? null,
    };
  } catch {}
  return { url: null, model: null, modelFast: null };
}

function readSelectedBackend(): "minimax" | "anthropic" | "glm" | "kplr" | "nvidia" | "custom" | null {
  try {
    const cfgFile = join(homedir(), ".physmind", "config.json");
    if (!existsSync(cfgFile)) return null;
    const cfg = JSON.parse(readFileSync(cfgFile, "utf-8"));
    const b = cfg.selected_backend;
    if (b === "minimax" || b === "anthropic" || b === "glm" || b === "nvidia" || b === "custom") return b;
  } catch {}
  return null;
}

// ── Model name mapping ───────────────────────────────────────────────────────

function toMinimaxModel(_model: string): string { return MINIMAX_DEFAULT_MODEL; }
function toDashScopeModel(model: string): string {
  return model === FAST_MODEL ? DASHSCOPE_FAST_MODEL : DASHSCOPE_DEFAULT_MODEL;
}
function toGlmModel(model: string): string {
  return model === FAST_MODEL ? GLM_FAST_MODEL : GLM_DEFAULT_MODEL;
}
function toNvidiaModel(model: string): string {
  return model === FAST_MODEL ? NVIDIA_FAST_MODEL : NVIDIA_DEFAULT_MODEL;
}
function toCustomModel(model: string, defaultModel: string, fastModel: string | null): string {
  return model === FAST_MODEL && fastModel ? fastModel : defaultModel;
}

// ── OpenAI-compatible fetch helpers (DashScope / GLM) ───────────────────────

interface DSMessage { role: "system" | "user" | "assistant"; content: string; }

async function dsCall(
  apiKey: string, model: string, messages: DSMessage[],
  maxTokens: number, temperature?: number, baseUrl: string = KPLR_BASE_URL,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) }),
  });
  if (!res.ok) throw new Error(`api returned ${res.status} ${res.statusText}: ${await res.text()}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function dsStream(
  apiKey: string, model: string, messages: DSMessage[],
  maxTokens: number, temperature: number | undefined,
  onChunk: (t: string) => void, onDone?: (t: string) => void,
  baseUrl: string = KPLR_BASE_URL,
): Promise<void> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
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

// ── Anthropic clients ────────────────────────────────────────────────────────

let _minimaxClient: Anthropic | null = null;
function getMinimaxClient(apiKey: string): Anthropic {
  if (!_minimaxClient) _minimaxClient = new Anthropic({ apiKey, baseURL: MINIMAX_BASE_URL });
  return _minimaxClient;
}

let _client: Anthropic | null = null;
function getAnthropicClient(apiKey?: string): Anthropic {
  if (_client) return _client;
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey: key });
  return _client;
}

// ── Backend resolution ───────────────────────────────────────────────────────

type Backend = "minimax" | "anthropic" | "glm" | "kplr" | "nvidia" | "custom";

interface ResolvedBackend {
  backend: Backend;
  minimaxKey: string | null;
  kplrKey: string | null;
  glmKey: string | null;
  nvidiaKey: string | null;
  customKey: string | null;
  customUrl: string | null;
  customModel: string | null;
  customModelFast: string | null;
}

function resolveBackend(): ResolvedBackend {
  const minimaxKey = readMinimaxKey() ?? process.env.MINIMAX_KEY ?? null;
  const kplrKey = readKplrKey() ?? process.env.KPLR_KEY ?? null;
  const glmKey = readGlmKey() ?? process.env.GLM_KEY ?? null;
  const nvidiaKey = readNvidiaKey() ?? process.env.NVIDIA_KEY ?? null;
  const customKey = readCustomKey() ?? process.env.CUSTOM_KEY ?? null;
  const { url: customUrl, model: customModel, modelFast: customModelFast } = readCustomProviderConfig();
  const selected = readSelectedBackend();

  let backend: Backend;
  if (selected === "minimax" && minimaxKey) backend = "minimax";
  else if (selected === "anthropic") backend = "anthropic";
  else if (selected === "glm" && glmKey) backend = "glm";
  else if (selected === "nvidia" && nvidiaKey) backend = "nvidia";
  else if (selected === "custom" && customKey && customUrl) backend = "custom";
  else if (selected) {
    // Selected backend key missing — fall back by presence
    backend = minimaxKey ? "minimax" : nvidiaKey ? "nvidia" : (customKey && customUrl ? "custom" : kplrKey ? "kplr" : glmKey ? "glm" : "anthropic");
  } else {
    // No explicit selection — legacy heuristic
    backend = minimaxKey ? "minimax" : nvidiaKey ? "nvidia" : (customKey && customUrl ? "custom" : kplrKey ? "kplr" : glmKey ? "glm" : "anthropic");
  }
  return { backend, minimaxKey, kplrKey, glmKey, nvidiaKey, customKey, customUrl, customModel, customModelFast };
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
  const { backend, minimaxKey, kplrKey, glmKey, nvidiaKey, customKey, customUrl, customModel, customModelFast } = resolveBackend();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (backend === "minimax" && minimaxKey) {
    const client = getMinimaxClient(minimaxKey);
    const response = await client.messages.create({
      model: toMinimaxModel(model), max_tokens: maxTokens, temperature: opts.temperature,
      system: opts.system, messages: opts.messages,
    });
    const block = response.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text block in response");
    return block.text;
  }

  if (backend === "nvidia" && nvidiaKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsCall(nvidiaKey, toNvidiaModel(model), msgs, maxTokens, opts.temperature, NVIDIA_BASE_URL);
  }

  if (backend === "custom" && customKey && customUrl && customModel) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsCall(customKey, toCustomModel(model, customModel, customModelFast), msgs, maxTokens, opts.temperature, customUrl);
  }

  if (backend === "glm" && glmKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsCall(glmKey, toGlmModel(model), msgs, maxTokens, opts.temperature, GLM_BASE_URL);
  }

  if (backend === "kplr" && kplrKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsCall(kplrKey, toDashScopeModel(model), msgs, maxTokens, opts.temperature);
  }

  // Anthropic fallback
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const client = getAnthropicClient(anthropicKey);
  const response = await client.messages.create({
    model, max_tokens: maxTokens, temperature: opts.temperature,
    system: opts.system, messages: opts.messages,
  });
  const block = response.content.find(b => b.type === "text");
  if (!block || block.type !== "text") throw new Error("No text block in response");
  return block.text;
}

export interface StreamCallOptions extends AiCallOptions {
  onChunk: (text: string) => void;
  onDone?: (fullText: string) => void;
}

export async function aiStream(opts: StreamCallOptions): Promise<void> {
  const { backend, minimaxKey, kplrKey, glmKey, nvidiaKey, customKey, customUrl, customModel, customModelFast } = resolveBackend();
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (backend === "minimax" && minimaxKey) {
    const client = getMinimaxClient(minimaxKey);
    let fullText = "";
    const stream = await client.messages.stream({
      model: toMinimaxModel(model), max_tokens: maxTokens, temperature: opts.temperature,
      system: opts.system, messages: opts.messages,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        opts.onChunk(event.delta.text);
      }
    }
    opts.onDone?.(fullText);
    return;
  }

  if (backend === "nvidia" && nvidiaKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsStream(nvidiaKey, toNvidiaModel(model), msgs, maxTokens, opts.temperature, opts.onChunk, opts.onDone, NVIDIA_BASE_URL);
  }

  if (backend === "custom" && customKey && customUrl && customModel) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsStream(customKey, toCustomModel(model, customModel, customModelFast), msgs, maxTokens, opts.temperature, opts.onChunk, opts.onDone, customUrl);
  }

  if (backend === "glm" && glmKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsStream(glmKey, toGlmModel(model), msgs, maxTokens, opts.temperature, opts.onChunk, opts.onDone, GLM_BASE_URL);
  }

  if (backend === "kplr" && kplrKey) {
    const msgs: DSMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    for (const m of opts.messages) msgs.push({ role: m.role, content: m.content });
    return dsStream(kplrKey, toDashScopeModel(model), msgs, maxTokens, opts.temperature, opts.onChunk, opts.onDone);
  }

  // Anthropic fallback
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const client = getAnthropicClient(anthropicKey);
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
