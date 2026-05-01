// PTY worker — runs under Node.js (not Bun) so node-pty native addon works.
// Communicates via newline-delimited JSON on stdin/stdout.
'use strict';

function sendLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let pty;
try {
  pty = require('./node_modules/node-pty');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const rebuildCmd = 'cd node_modules/node-pty && npx --yes node-gyp@10 rebuild';
  const hint =
    process.platform === 'linux'
      ? `From repo root: ${rebuildCmd}  (e.g. apt install build-essential)`
      : `From repo root: ${rebuildCmd}`;
  sendLine({
    type: 'data',
    data:
      '\r\n\x1b[31m[MindAct] Terminal backend (node-pty) failed to load.\x1b[0m\r\n' +
      '\x1b[90m' + msg + '\x1b[0m\r\n' +
      '\x1b[90m' + hint + '\x1b[0m\r\n\r\n',
  });
  sendLine({ type: 'exit' });
  process.exit(1);
}

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const cwd = process.env.PTY_CWD || process.cwd();

function loadDotEnvFile() {
  // Load MindAct/.env into process.env for the PTY worker only.
  // This keeps terminal/provider config in one place for users.
  const envPath = path.join(__dirname, '.env');
  try {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (!key) continue;
      // Strip optional surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Do not overwrite existing env vars (shell overrides .env)
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}
loadDotEnvFile();

function ensureSpawnHelperExecutable() {
  try {
    const helper = path.join(
      __dirname,
      'node_modules',
      'node-pty',
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    );
    if (fs.existsSync(helper)) {
      const st = fs.statSync(helper);
      // Add owner/group/other execute bits if missing.
      if ((st.mode & 0o111) === 0) {
        fs.chmodSync(helper, st.mode | 0o755);
      }
    }
  } catch {}
}
ensureSpawnHelperExecutable();

function isExecutable(cmd) {
  const { execSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      execSync(`where ${JSON.stringify(cmd)}`, { stdio: 'ignore' });
    } else {
      execSync(`which ${JSON.stringify(cmd)} 2>/dev/null || test -x ${JSON.stringify(cmd)}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

// Resolve the CLI binary — prefer project-local physmind, then CLAUDE_BIN env
function findClaude() {
  const os = require('os');
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'physmind.exe' : 'physmind';
  const candidates = [
    // Explicit override via env
    process.env.CLAUDE_BIN,
    // setup.ps1 copies physmind.exe here
    isWin ? path.join(os.homedir(), '.cargo', 'bin', 'physmind.exe') : null,
    // setup.sh links physmind here
    isWin ? null : '/usr/local/bin/physmind',
    // Project-local build
    path.join(__dirname, 'cli', 'rust', 'target', 'release', bin),
    // x64 cross-compiled target (ARM64 Windows)
    isWin ? path.join(__dirname, 'cli', 'rust', 'target', 'x86_64-pc-windows-msvc', 'release', 'physmind.exe') : null,
    // Dev machine claw-code checkout
    path.join(os.homedir(), 'claw-code', 'rust', 'target', 'release', bin),
    // System PATH
    'physmind',
  ].filter(Boolean);
  for (const c of candidates) {
    if (!c) continue;
    if (isExecutable(c)) return c;
  }
  return null;
}

function resolveEntryCommand() {
  const claudeBin = findClaude();
  if (claudeBin) {
    return { command: claudeBin, args: [] };
  }
  return null;
}

// Read kplr key from ~/.config/physmind/credentials (same file claw writes to).
function readKplrKey() {
  try {
    const credFile = path.join(require('os').homedir(), '.config', 'physmind', 'credentials');
    if (!fs.existsSync(credFile)) return null;
    const lines = fs.readFileSync(credFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^KPLR_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function envStr(name) {
  const v = process.env[name];
  const s = (typeof v === 'string' ? v : '').trim();
  return s || null;
}

function resolveProvider() {
  const p = (envStr('MINDACT_AI_PROVIDER') || '').toLowerCase();
  if (p === 'minimax') return 'minimax';
  if (p === 'anthropic') return 'anthropic';
  if (p === 'openai_compatible' || p === 'openai' || p === 'openai-compatible' || p === 'oai') return 'openai_compatible';
  if (p === 'keplore') return 'keplore';
  // Back-compat: default to keplore when KPLR_KEY exists, else anthropic.
  return (readKplrKey() || envStr('KPLR_KEY')) ? 'keplore' : 'anthropic';
}

function minimaxStyle() {
  const s = (envStr('MINDACT_MINIMAX_API_STYLE') || '').toLowerCase();
  return s === 'openai' ? 'openai' : 'anthropic';
}

// Build the environment for physmind ("claw") based on selected provider.
function buildClawEnv() {
  const env = { ...process.env };

  const provider = resolveProvider();

  // Always isolate config so ~/.claw/* (OAuth tokens etc.) won't interfere.
  env.CLAW_CONFIG_HOME = path.join(require('os').homedir(), '.config', 'physmind', 'claw');

  if (provider === 'keplore') {
    // KeploreAI / DashScope-compatible: inject KPLR_KEY and proxy base URL.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const kplrKey = readKplrKey() || env.KPLR_KEY;
    if (kplrKey) {
      env.KPLR_KEY = kplrKey;
      env.DASHSCOPE_API_KEY = kplrKey;
      env.DASHSCOPE_BASE_URL = envStr('MINDACT_KPLR_BASE_URL') || 'https://physmind-proxy.marvin-gao-cs.workers.dev/v1';
    } else {
      delete env.DASHSCOPE_API_KEY;
      delete env.KPLR_KEY;
      delete env.DASHSCOPE_BASE_URL;
    }
  } else if (provider === 'minimax') {
    // MiniMax: prefer Anthropic-compatible API.
    // https://platform.minimax.io/docs/api-reference/text-anthropic-api
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_BASE_URL;
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;

    const apiKey = envStr('MINDACT_MINIMAX_API_KEY');
    // MiniMax Anthropic-compatible expects the secret key in `Authorization` header.
    // Our Rust client supports both `x-api-key` and `Authorization: Bearer ...`.
    // To be maximally compatible with proxies / gateways, we set BOTH.
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }

    if (minimaxStyle() === 'anthropic') {
      env.ANTHROPIC_BASE_URL = envStr('MINDACT_MINIMAX_ANTHROPIC_BASE_URL') || 'https://api.minimax.io/anthropic';
    } else {
      // OpenAI-compatible gateway mode (only if you have one).
      // We map it into OPENAI_* so the CLI can route there if supported.
      env.OPENAI_BASE_URL = envStr('MINDACT_MINIMAX_BASE_URL') || env.OPENAI_BASE_URL;
      env.OPENAI_API_KEY = apiKey || env.OPENAI_API_KEY;
    }
  } else if (provider === 'anthropic') {
    // Let user supply ANTHROPIC_* normally.
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_BASE_URL;
  } else if (provider === 'openai_compatible') {
    // Let user supply OPENAI_* normally.
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_BASE_URL;
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

function hasAnyProviderKey() {
  const provider = resolveProvider();
  if (provider === 'keplore') return !!(readKplrKey() || envStr('KPLR_KEY'));
  if (provider === 'minimax') return !!envStr('MINDACT_MINIMAX_API_KEY');
  if (provider === 'anthropic') return !!envStr('ANTHROPIC_API_KEY') || !!envStr('ANTHROPIC_AUTH_TOKEN');
  if (provider === 'openai_compatible') return !!envStr('OPENAI_API_KEY');
  return false;
}

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  if (term) { try { term.kill(); } catch {} }

  if (!hasAnyProviderKey()) {
    const provider = resolveProvider();
    send({
      type: 'data',
      data: '\r\n\x1b[31m[PhysMind] Missing API key for current provider.\x1b[0m\r\n' +
            `\x1b[90mProvider: ${provider}. Configure it in MindAct/.env (or your shell env) and restart the terminal.\x1b[0m\r\n\r\n`,
    });
    return;
  }

  const entry = resolveEntryCommand();
  if (!entry) {
    send({
      type: 'data',
      data:
        '\r\n\x1b[31m[MindAct] Claude CLI not found.\x1b[0m\r\n' +
        '\x1b[90mInstall: npm install -g @anthropic-ai/claude-code\x1b[0m\r\n\r\n',
    });
    send({ type: 'exit' });
    process.exit(1);
    return;
  }

  // If using MiniMax, pass the desired model explicitly so we don't inherit CLI default (qwen-plus).
  const provider = resolveProvider();
  const extraArgs = [];
  // Always allow `.env` to override the CLI's persisted model selection.
  // This avoids "stuck on old model" when CLAW_CONFIG_HOME contains a saved model.
  if (provider === 'minimax' || envStr('MINDACT_AI_PROVIDER') === 'minimax' || envStr('MINDACT_MINIMAX_MODEL')) {
    const model = envStr('MINDACT_MINIMAX_MODEL') || 'MiniMax-M2.7';
    extraArgs.push('--model', model);
  }

  try {
    term = pty.spawn(entry.command, [...(entry.args || []), ...extraArgs], {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 40,
      cwd,
      env: buildClawEnv(),
    });
  } catch (err) {
    send({
      type: 'data',
      data:
        '\r\n\x1b[31m[MindAct] PTY unavailable. Claude terminal cannot start.\x1b[0m\r\n' +
        `\x1b[90m${String(err && err.message ? err.message : err)}\x1b[0m\r\n\r\n`,
    });
    send({ type: 'exit' });
    process.exit(1);
  }

  term.onData((data) => {
    // Replace internal credential error messages with user-friendly text.
    const filtered = data
      .replace(/missing DashScope credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/missing Anthropic credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/export ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export ANTHROPIC_API_KEY[^\r\n]*/g, '')
      .replace(/ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export DASHSCOPE_API_KEY[^\r\n]*/g, '')
      .replace(/DASHSCOPE_API_KEY[^\r\n]*/g, '');
    send({ type: 'data', data: filtered });
  });
  term.onExit(() => {
    send({ type: 'exit' });
    process.exit(0);
  });
}

// Start terminal immediately
spawnTerm(120, 40);

// Read commands from stdin
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (!term) return;
    if (msg.type === 'input') {
      term.write(msg.data);
    } else if (msg.type === 'resize') {
      term.resize(msg.cols, msg.rows);
    }
  } catch {}
});

rl.on('close', () => {
  if (term) try { term.kill(); } catch {}
  process.exit(0);
});
