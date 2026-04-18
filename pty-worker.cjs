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

// Read a key from the credentials file by prefix (e.g. 'KPLR_KEY', 'MINIMAX_KEY', 'GLM_KEY').
function readCredKey(prefix) {
  try {
    const credFile = path.join(physmindConfigDir(), 'credentials');
    if (!fs.existsSync(credFile)) return null;
    const lines = fs.readFileSync(credFile, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(new RegExp('^' + prefix + '="?([^"]+)"?'));
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function readKplrKey() { return readCredKey('KPLR_KEY'); }
function readMinimaxKey() { return readCredKey('MINIMAX_KEY'); }
function readGlmKey() { return readCredKey('GLM_KEY'); }

// Read the MindAct config file to get selected_backend.
function readMindActConfig() {
  try {
    const cfgFile = path.join(require('os').homedir(), '.physmind', 'config.json');
    if (!fs.existsSync(cfgFile)) return null;
    return JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
  } catch { return null; }
}

// Build the environment: strip Anthropic credentials, inject the appropriate backend keys.
// The PhysMind CLI is Anthropic-compatible, so we only support MiniMax and KPLR as
// terminal backends. GLM (OpenAI-only) powers analysis features via ai_client.ts.
function buildClawEnv(cols, rows) {
  const env = { ...process.env };
  // Explicitly set terminal dimensions so Ink/physmind reads the correct column
  // count from the environment rather than querying the TTY before the PTY is
  // fully wired up.  This eliminates a second source of width-mismatch garbling.
  if (cols) env.COLUMNS = String(cols);
  if (rows) env.LINES = String(rows);
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const cfg = readMindActConfig();
  const selectedBackend = cfg && cfg.selected_backend;
  const minimaxKey = readMinimaxKey() || env.MINIMAX_API_KEY;
  const kplrKey = readKplrKey() || env.KPLR_KEY;

  // Resolve which terminal backend to activate
  let useBackend = null;
  if (selectedBackend === 'minimax' && minimaxKey) useBackend = 'minimax';
  else if (selectedBackend === 'anthropic') useBackend = 'anthropic';
  else if (selectedBackend === 'glm') {
    // GLM is not Anthropic-compatible — fall back to MiniMax or KPLR if available
    if (minimaxKey) useBackend = 'minimax';
    else if (kplrKey) useBackend = 'kplr';
    // else: no terminal backend (will be caught by hasTerminalKey)
  } else if (minimaxKey) useBackend = 'minimax';
  else if (kplrKey) useBackend = 'kplr';
  else useBackend = 'anthropic';

  // Clear model-override vars inherited from process.env; each backend block
  // sets only what it needs, so switching providers never leaves stale values.
  delete env.ANTHROPIC_MODEL;
  delete env.ANTHROPIC_CUSTOM_MODEL_OPTION;
  delete env.CLAUDE_CODE_SIMPLE;

  if (useBackend === 'minimax' && minimaxKey) {
    env.MINIMAX_API_KEY = minimaxKey;
    env.ANTHROPIC_API_KEY = minimaxKey;
    env.ANTHROPIC_BASE_URL = 'https://api.minimax.io/anthropic';
    // Model vars are specific to MiniMax — set here, not globally.
    env.ANTHROPIC_MODEL = 'minimax-m2.7';
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'minimax-m2.7';
    env.CLAUDE_CODE_SIMPLE = '1';
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_API_KEY;
    delete env.DASHSCOPE_BASE_URL;
  } else if (useBackend === 'kplr' && kplrKey) {
    env.KPLR_KEY = kplrKey;
    env.DASHSCOPE_API_KEY = kplrKey;
    // Always inject proxy URL so physmind routes to KeploreAI
    env.DASHSCOPE_BASE_URL = 'https://physmind-proxy.marvin-gao-cs.workers.dev/v1';
    delete env.MINIMAX_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
  } else if (useBackend === 'anthropic') {
    // Pass through ANTHROPIC_API_KEY from the environment (already deleted above, re-read)
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) env.ANTHROPIC_API_KEY = anthropicKey;
    delete env.MINIMAX_API_KEY;
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.DASHSCOPE_BASE_URL;
    delete env.ANTHROPIC_BASE_URL;
  } else {
    delete env.DASHSCOPE_API_KEY;
    delete env.KPLR_KEY;
    delete env.MINIMAX_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
  }
  // Skip physmind's interactive "Select model backend:" prompt — pty-worker
  // already injects the correct ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY so
  // the prompt is redundant and only causes noise in the terminal.
  env.CLAUDE_MODEL_SELECTION_DONE = '1';
  // Isolate physmind config so saved Anthropic OAuth tokens are never read
  env.CLAW_CONFIG_HOME = path.join(physmindConfigDir(), 'claw');
  if (process.platform !== 'win32') {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
  }
  return env;
}

// Returns true if there's a working terminal backend available.
function hasTerminalKey() {
  const cfg = readMindActConfig();
  const selectedBackend = cfg && cfg.selected_backend;
  const minimaxKey = readMinimaxKey() || process.env.MINIMAX_API_KEY;
  const kplrKey = readKplrKey() || process.env.KPLR_KEY;
  if (selectedBackend === 'anthropic') return !!(process.env.ANTHROPIC_API_KEY);
  if (selectedBackend === 'glm') return !!(minimaxKey || kplrKey); // GLM falls back to minimax/kplr
  return !!(minimaxKey || kplrKey);
}

// Returns a label for the active terminal backend.
function getTerminalBackendLabel() {
  const cfg = readMindActConfig();
  const selectedBackend = cfg && cfg.selected_backend;
  const minimaxKey = readMinimaxKey() || process.env.MINIMAX_API_KEY;
  const kplrKey = readKplrKey() || process.env.KPLR_KEY;
  if (selectedBackend === 'minimax' && minimaxKey) return 'MiniMax M2.7';
  if (selectedBackend === 'anthropic') return 'Claude (Anthropic)';
  if (selectedBackend === 'glm') {
    if (minimaxKey) return 'MiniMax M2.7 (GLM fallback for terminal)';
    if (kplrKey) return 'KeploreAI (GLM fallback for terminal)';
    return null;
  }
  if (minimaxKey) return 'MiniMax M2.7';
  if (kplrKey) return 'KeploreAI';
  return null;
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

  if (!hasTerminalKey()) {
    const cfg = readMindActConfig();
    const isGlm = cfg && cfg.selected_backend === 'glm';
    if (isGlm) {
      send({
        type: 'data',
        data: '\r\n\x1b[33m[PhysMind] GLM backend is active for analysis features.\x1b[0m\r\n' +
              '\x1b[90mThe AI terminal requires a MiniMax or Anthropic key.\x1b[0m\r\n' +
              '\x1b[90mGo to Settings and add a MiniMax API key (sk-api-...) to enable the terminal.\x1b[0m\r\n\r\n',
      });
    } else {
      send({
        type: 'data',
        data: '\r\n\x1b[31m[PhysMind] No API key configured.\x1b[0m\r\n' +
              '\x1b[90mGo to Settings and select a model backend, then enter your API key.\x1b[0m\r\n\r\n',
      });
    }
    return;
  }

  // Show which backend is active
  const backendLabel = getTerminalBackendLabel();
  if (backendLabel) {
    send({ type: 'data', data: '\r\n\x1b[32m[PhysMind] Backend: ' + backendLabel + '\x1b[0m\r\n\r\n' });
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

  // ── Startup model-selection prompt suppression ──────────────────────────────
  // CLAUDE_MODEL_SELECTION_DONE=1 is injected via buildClawEnv, so physmind
  // skips its interactive "Select model backend:" prompt entirely.
  // selectionPhase stays false — all PTY output flows through immediately.
  let selectionPhase = false;
  let selectionBuf = '';

  // Determine which numeric choice to send to the upstream CLI:
  //   1 = Claude (Anthropic)
  //   2 = MiniMax
  // GLM is not a native CLI option, so we use the best Anthropic-compatible
  // backend available (MiniMax preferred, then Claude).
  function resolveCliChoice() {
    const cfg = readMindActConfig();
    const sel = cfg && cfg.selected_backend;
    const minimaxKey = readMinimaxKey() || process.env.MINIMAX_API_KEY;
    if (sel === 'anthropic') return '1';
    if (sel === 'glm') return minimaxKey ? '2' : '1';
    // minimax (default) or any key-presence fallback
    return minimaxKey ? '2' : '1';
  }

  // Safety timeout: if the selection prompt never appears (e.g., future CLI
  // version removes it), stop suppressing output after 4 seconds.
  const selectionTimeout = setTimeout(() => {
    if (!selectionPhase) return;
    selectionPhase = false;
    if (selectionBuf) {
      // Flush whatever was buffered (minus the partial prompt if any)
      const cleaned = applyOutputFilters(selectionBuf);
      if (cleaned) send({ type: 'data', data: cleaned });
      selectionBuf = '';
    }
  }, 4000);

  function applyOutputFilters(raw) {
    let filtered = raw
      .replace(/missing DashScope credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/missing Anthropic credentials[^\r\n]*/g, 'No KeploreAI key found. Go to Settings and enter your kplr-... key.')
      .replace(/export ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export ANTHROPIC_API_KEY[^\r\n]*/g, '')
      .replace(/ANTHROPIC_AUTH_TOKEN[^\r\n]*/g, '')
      .replace(/export DASHSCOPE_API_KEY[^\r\n]*/g, '')
      .replace(/DASHSCOPE_API_KEY[^\r\n]*/g, '');
    if (PHYSMIND_MACRO_VERSION) {
      filtered = filtered.replace(
        new RegExp('v' + PHYSMIND_MACRO_VERSION.replace(/\./g, '\\.'), 'g'),
        'v' + MINDACT_VERSION
      );
    }
    filtered = filtered.replace(
      /Opus now defaults to 1M context · 5x more room, same pricing/g,
      'Sign in to sync Decision Dependencies automatically across devices · /auth'
    );
    filtered = filtered.replace(/Claude Code/g, 'PhysMind');
    return filtered;
  }

  term.onData((data) => {
    if (selectionPhase) {
      selectionBuf += data;
      // Detect the model-selection prompt ("Choice [1/2]:" or "Choice [1/2/3]:" etc.)
      if (/Choice\s*\[\d[^\]]*\]\s*:/.test(selectionBuf) || selectionBuf.includes('Choice [1/2]')) {
        clearTimeout(selectionTimeout);
        selectionPhase = false;
        selectionBuf = '';
        // Auto-answer — the CLI reads a single digit followed by Enter
        const choice = resolveCliChoice();
        try { term.write(choice + '\r'); } catch {}
        // Suppress the entire selection UI — do not send anything to the frontend.
        return;
      }
      // Still buffering — suppress until we know whether there's a prompt
      return;
    }

    // Normal post-selection output processing
    send({ type: 'data', data: applyOutputFilters(data) });
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
