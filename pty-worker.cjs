// PTY worker — runs under Node.js (not Bun) so node-pty native addon works.
// Communicates via newline-delimited JSON on stdin/stdout.
'use strict';

const pty = require('./node_modules/node-pty');
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
    execSync(`which ${JSON.stringify(cmd)} 2>/dev/null || test -x ${JSON.stringify(cmd)}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Resolve the claude CLI — check common install locations
function findClaude() {
  const candidates = [
    process.env.CLAUDE_BIN,           // user override via env
    'claude',                          // system PATH (works if globally installed)
  ];
  // Also check common install paths
  const os = require('os');
  const path = require('path');
  candidates.push(
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  );
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

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  if (term) { try { term.kill(); } catch {} }
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

  try {
    term = pty.spawn(entry.command, entry.args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 40,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
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

  term.onData((data) => send({ type: 'data', data }));
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
