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

// Dynamically extract MACRO.VERSION from the installed physmind CLI so the
// version replacement survives physmind auto-updates.
function getPhysmindMacroVersion() {
  try {
    const cliPath = require.resolve('@keploreai/physmind/dist/cli.js');
    const content = fs.readFileSync(cliPath, 'utf-8');
    const m = content.match(/globalThis\.MACRO\s*=\s*\{[^}]*VERSION:\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

// Read MindAct version from package.json.
function getMindActVersion() {
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch { return '1.0.0'; }
}

const PHYSMIND_MACRO_VERSION = getPhysmindMacroVersion();
const MINDACT_VERSION = getMindActVersion();

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
    const script = require.resolve('@keploreai/physmind/dist/cli.js');
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

// Read Minimax key from the credentials file.
function readMinimaxKey() {
  try {
    const credFile = path.join(physmindConfigDir(), 'credentials');
    if (!fs.existsSync(credFile)) return null;
    const lines = fs.readFileSync(credFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^MINIMAX_KEY="?([^"]+)"?/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

// Build the environment: strip Anthropic credentials, inject KPLR/DashScope or Minimax keys.
function buildClawEnv(cols, rows) {
  const env = { ...process.env };
  // Explicitly set terminal dimensions so Ink/physmind reads the correct column
  // count from the environment rather than querying the TTY before the PTY is
  // fully wired up.  This eliminates a second source of width-mismatch garbling.
  if (cols) env.COLUMNS = String(cols);
  if (rows) env.LINES = String(rows);
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const minimaxKey = readMinimaxKey() || env.MINIMAX_API_KEY;
  const kplrKey = readKplrKey() || env.KPLR_KEY;
  if (minimaxKey) {
    env.MINIMAX_API_KEY = minimaxKey;
    env.ANTHROPIC_API_KEY = minimaxKey;
    env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_API_KEY;
    delete env.DASHSCOPE_BASE_URL;
  } else if (kplrKey) {
    env.KPLR_KEY = kplrKey;
    env.DASHSCOPE_API_KEY = kplrKey;
    // Always inject proxy URL so physmind routes to KeploreAI
    env.DASHSCOPE_BASE_URL = 'https://physmind-proxy.marvin-gao-cs.workers.dev/v1';
    delete env.MINIMAX_API_KEY;
  } else {
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.MINIMAX_API_KEY;
  }
  // Isolate physmind config so saved Anthropic OAuth tokens are never read
  env.CLAW_CONFIG_HOME = path.join(physmindConfigDir(), 'claw');
  if (process.platform !== 'win32') {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
  }
  return env;
}

function hasKplrKey() {
  return !!(readKplrKey() || process.env.KPLR_KEY || readMinimaxKey() || process.env.MINIMAX_API_KEY);
}

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  cols = cols || 120;
  rows = rows || 40;
  if (term) { try { term.kill(); } catch {} }

  if (!hasKplrKey()) {
    send({
      type: 'data',
      data: '\r\n\x1b[31m[PhysMind] No MiniMax API key found.\x1b[0m\r\n' +
            '\x1b[90mOption 1: Go to Settings and enter your MiniMax API key (sk-api-...).\x1b[0m\r\n' +
            '\x1b[90mOption 2: Add it manually to ~/.config/physmind/credentials:\x1b[0m\r\n' +
            '\x1b[90m  MINIMAX_KEY="sk-api-..."\x1b[0m\r\n\r\n',
    });
    return;
  }

  // Show which backend is active
  const minimaxKey = readMinimaxKey() || process.env.MINIMAX_API_KEY;
  if (minimaxKey) {
    send({ type: 'data', data: '\r\n\x1b[32m[PhysMind] Backend: MiniMax M2.7\x1b[0m\r\n\r\n' });
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
      cols,
      rows,
      cwd,
      env: buildClawEnv(cols, rows),
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
    let filtered = data
      .replace(/missing DashScope credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/missing Anthropic credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/export ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export ANTHROPIC_API_KEY[^\r\n]*/g, '')
      .replace(/ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export DASHSCOPE_API_KEY[^\r\n]*/g, '')
      .replace(/DASHSCOPE_API_KEY[^\r\n]*/g, '');
    // Replace the physmind internal build version with the MindAct version so
    // the terminal banner shows "PhysMind v{mindact version}" instead of the
    // upstream Claude Code version bundled inside physmind.
    if (PHYSMIND_MACRO_VERSION) {
      filtered = filtered.replace(
        new RegExp('v' + PHYSMIND_MACRO_VERSION.replace(/\./g, '\\.'), 'g'),
        'v' + MINDACT_VERSION
      );
    }
    // Replace the upstream "Opus 1M context" upgrade notice with a
    // PhysMind-specific tip about account sign-in and dependency sync.
    filtered = filtered.replace(
      /Opus now defaults to 1M context · 5x more room, same pricing/g,
      'Sign in to sync Decision Dependencies automatically across devices · /auth'
    );
    // Replace residual "Claude Code" brand references with "PhysMind".
    filtered = filtered.replace(/Claude Code/g, 'PhysMind');
    send({ type: 'data', data: filtered });
  });

  // After physmind finishes its initial render (~500ms), force a SIGWINCH so it
  // redraws at the correct PTY dimensions.  physmind uses cursor-up for its logo
  // animation; if the TUI height after the first render differs from what Ink
  // calculated, cursor positions go wrong and box-drawing chars overwrite text.
  // A clean SIGWINCH right after startup lets Ink recalculate everything.
  setTimeout(() => {
    if (!term) return;
    const c = term.cols, r = term.rows;
    try {
      // Nudge size by 1 col and back — guarantees SIGWINCH on all platforms
      // even if the OS skips TIOCSWINSZ when dimensions are unchanged.
      term.resize(c > 10 ? c - 1 : c + 1, r);
      term.resize(c, r);
    } catch {}
  }, 600);

  term.onExit(() => {
    send({ type: 'exit' });
    process.exit(0);
  });
}

// Defer PTY spawn until the client sends its actual terminal dimensions via the
// first "resize" message.  This prevents physmind from rendering its splash
// screen at the wrong column width (120 hardcoded vs the real xterm width),
// which was the cause of garbled/scattered characters on startup.
let spawned = false;

function doSpawn(cols, rows) {
  if (spawned) return;
  spawned = true;
  spawnTerm(cols || 120, rows || 40);
}

// Fallback: if no resize arrives within 600 ms, spawn at safe defaults.
// The client always sends resize on ws.onopen, so this path is a safety net.
const spawnFallbackTimer = setTimeout(() => doSpawn(120, 40), 600);

// Read commands from stdin
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.type === 'resize') {
      if (!spawned) {
        // First resize message — use these real dimensions for the initial spawn
        clearTimeout(spawnFallbackTimer);
        doSpawn(msg.cols, msg.rows);
      } else if (term) {
        term.resize(msg.cols, msg.rows);
      }
    } else if (msg.type === 'input') {
      if (term) term.write(msg.data);
    }
  } catch {}
});

rl.on('close', () => {
  if (term) try { term.kill(); } catch {}
  process.exit(0);
});
