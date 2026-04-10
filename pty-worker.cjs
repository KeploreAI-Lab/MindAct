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

function resolveEntryCommand() {
  // Explicit override
  const override = process.env.PHYSMIND_BIN || process.env.CLAUDE_BIN;
  if (override && isExecutable(override)) return { command: override, args: [] };

  // Prefer @keploreai/physmind npm package resolved directly — most reliable
  try {
    const script = require.resolve('@keploreai/physmind/dist/run.js');
    return { command: process.execPath, args: [script] };
  } catch {}

  // Fallback: system physmind in PATH
  if (isExecutable('physmind')) return { command: 'physmind', args: [] };

  return null;
}

// Cross-platform credentials directory:
//   macOS/Linux: ~/.config/physmind
//   Windows:     %APPDATA%\physmind
function physmindConfigDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || require('os').homedir(), 'physmind');
  }
  return path.join(require('os').homedir(), '.config', 'physmind');
}

// Read kplr key from the credentials file.
function readKplrKey() {
  try {
    const credFile = path.join(physmindConfigDir(), 'credentials');
    if (!fs.existsSync(credFile)) return null;
    const lines = fs.readFileSync(credFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^KPLR_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

// Build the environment: strip Anthropic credentials, inject KPLR/DashScope keys.
function buildClawEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const kplrKey = readKplrKey() || env.KPLR_KEY;
  if (kplrKey) {
    env.KPLR_KEY = kplrKey;
    env.DASHSCOPE_API_KEY = kplrKey;
  } else {
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
  }
  // Always inject proxy URL so physmind routes to KeploreAI
  env.DASHSCOPE_BASE_URL = 'https://physmind-proxy.marvin-gao-cs.workers.dev/v1';
  // Isolate physmind config so saved Anthropic OAuth tokens are never read
  env.CLAW_CONFIG_HOME = path.join(physmindConfigDir(), 'claw');
  if (process.platform !== 'win32') {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
  }
  return env;
}

function hasKplrKey() {
  return !!(readKplrKey() || process.env.KPLR_KEY);
}

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  if (term) { try { term.kill(); } catch {} }

  if (!hasKplrKey()) {
    send({
      type: 'data',
      data: '\r\n\x1b[31m[PhysMind] No KeploreAI key found.\x1b[0m\r\n' +
            '\x1b[90mGo to Settings and enter your kplr-... key to get started.\x1b[0m\r\n\r\n',
    });
    return;
  }

  const entry = resolveEntryCommand();
  if (!entry) {
    send({
      type: 'data',
      data:
        '\r\n\x1b[31m[MindAct] PhysMind CLI not found.\x1b[0m\r\n' +
        '\x1b[90mRun: npm install  (installs @keploreai/physmind automatically)\x1b[0m\r\n\r\n',
    });
    send({ type: 'exit' });
    process.exit(1);
    return;
  }

  try {
    term = pty.spawn(entry.command, entry.args, {
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
