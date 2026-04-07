// PTY worker — runs under Node.js (not Bun) so node-pty native addon works.
// Communicates via newline-delimited JSON on stdin/stdout.
'use strict';

const pty = require('./node_modules/node-pty');
const readline = require('readline');

const cwd = process.env.PTY_CWD || process.cwd();

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
  const { execSync } = require('child_process');
  for (const c of candidates) {
    if (!c) continue;
    try {
      execSync(`which ${JSON.stringify(c)} 2>/dev/null || test -x ${JSON.stringify(c)}`, { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return 'claude'; // fallback — will show a clear error in terminal
}

const claudeBin = findClaude();

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  if (term) { try { term.kill(); } catch {} }

  term = pty.spawn(claudeBin, [], {
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
