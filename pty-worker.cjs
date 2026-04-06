// PTY worker — runs under Node.js (not Bun) so node-pty native addon works.
// Communicates via newline-delimited JSON on stdin/stdout.
'use strict';

const pty = require('./node_modules/node-pty');
const readline = require('readline');

const bunBin = '/Users/jtu/.bun/bin/bun';
const cliEntry = '/Users/jtu/important-code/src/entrypoints/cli.tsx';
const cwd = process.env.PTY_CWD || process.cwd();

let term = null;

function send(msg) {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
  // Force flush on pipe
  if (process.stdout.writableNeedDrain) process.stdout.uncork();
}

function spawnTerm(cols, rows) {
  if (term) { try { term.kill(); } catch {} }

  term = pty.spawn(bunBin, ['run', cliEntry], {
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
// Auto-select Claude (choice 1)
setTimeout(() => { if (term) term.write('1\r'); }, 1500);
// Auto-confirm "Yes, I trust this folder" (Enter to confirm)
setTimeout(() => { if (term) term.write('\r'); }, 4000);

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
