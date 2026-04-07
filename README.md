# MindAct

> **From ReAct to MindAct.** ReAct taught agents to reason before acting. MindAct takes it further — before your agent acts, it knows what it doesn't know.

**MindAct** is a desktop AI workspace that combines a Claude Code terminal, a built-in Obsidian-style knowledge graph, and an intelligent Dependency Analysis engine — purpose-built for engineers working on domain-specific projects like robotics, physics simulation, and control systems.

Stop sending naked prompts to Claude. MindAct automatically retrieves the right context from your knowledge base, scores execution confidence, and surfaces knowledge gaps before you run — so Claude always has what it needs to get the job done right.

> 中文文档请见 [README.zh.md](./README.zh.md)

---

## Why MindAct?

Most AI coding assistants treat every task the same way: you type, it generates. That works for CRUD apps. It fails for domain-specific engineering.

**The problem:** Claude doesn't know your robot's joint limits, your motor controller's PID parameters, or your team's coordinate system conventions — unless you tell it every single time.

**The solution:** MindAct maintains a structured knowledge base linked to your project. Before every task, it runs a dependency analysis pipeline that checks what knowledge the task needs, what you already have, and what's missing. Then it enriches your prompt with the right context automatically.

```
❌  Before:  "Design a trajectory for the 6-DOF arm"
             → Claude guesses. Results vary. Debugging takes hours.

✅  After:   MindAct detects: robotics domain
             Finds: joint_constraints.md, workspace_config.md
             Missing: trajectory_algorithm.md  ← creates template for you
             Confidence: 72% Medium
             → Enriched prompt sent with full context injected
```

---

## What it does

```
User task → Dependency Analysis → Knowledge Retrieval → Enriched Prompt → Claude
```

**Core features:**

- **Claude Code terminal** — full interactive Claude Code session, embedded in the app
- **Obsidian-style Brain Graph** — your knowledge base as a live, interactive `[[wiki-linked]]` graph. Nodes glow when they're relevant to your current task
- **Dependency Analysis engine** — 4-stage LLM pipeline that detects what your task needs, matches it against your KB, and scores confidence before execution
- **Ghost nodes** — missing dependencies appear as hollow red circles in the graph. Click one → get an AI-generated structured template to fill in
- **Streaming analysis log** — real-time SSE progress visible as a floating overlay on the graph, not a modal blocking your work
- **Context-enriched execution** — when you hit Execute, Claude receives your task plus all relevant KB content, automatically
- **Knowledge templates** — when knowledge is missing, MindAct generates a domain-specific template (not a blank file) so you know exactly what to write

---

## From ReAct to MindAct

**ReAct** (Reasoning + Acting) was a breakthrough: give agents the ability to think step-by-step before taking action.

**MindAct** adds the missing layer: *structured domain memory*.

| | ReAct | MindAct |
|---|---|---|
| Reasoning | ✅ Chain-of-thought | ✅ Inherited |
| Acting | ✅ Tool use | ✅ Claude Code |
| **Domain memory** | ❌ Stateless | ✅ Knowledge graph |
| **Dependency awareness** | ❌ Implicit | ✅ Explicit pre-flight check |
| **Confidence scoring** | ❌ None | ✅ 0–100% before execution |
| **Knowledge gap detection** | ❌ None | ✅ Ghost nodes + templates |

> ReAct asks: *"What should I do next?"*
> MindAct asks first: *"Do I have everything I need to do this right?"*

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| Server / runtime | Bun |
| Frontend | React + Vite |
| Terminal | xterm.js + node-pty |
| Knowledge graph | D3.js force-directed (Obsidian-style `[[links]]`) |
| Code editor | CodeMirror 6 |
| AI | Anthropic Claude API (`claude-sonnet-4-6` / `claude-haiku-4-5`) |

---

## Project structure

```
mindact/
├── server.ts                  # Bun HTTP server (REST + SSE + WebSocket)
├── electron-main.cjs          # Electron main process
├── client/                    # React + Vite frontend
│   └── src/
│       ├── components/
│       │   ├── Terminal.tsx        # Claude Code terminal + analysis input
│       │   ├── KBPanel.tsx         # Knowledge base panel
│       │   ├── Graph.tsx           # Brain Graph (d3)
│       │   ├── GraphLogDrawer.tsx  # Analysis log overlay
│       │   └── DependencyReport.tsx
│       ├── graph_manager/          # D3 renderer, types, config
│       └── store.ts                # Zustand global state
├── decision_manager/          # AI analysis engine
│   ├── ai_client.ts           # Anthropic SDK wrapper
│   ├── build_index.ts         # Markdown graph indexer
│   ├── prompts/               # All LLM prompts (separated by task)
│   └── tasks/
│       └── dependency_analysis.ts  # 4-stage pipeline
└── tests/                     # Bun test suite (102 tests)
```

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Node.js](https://nodejs.org) ≥ 18 (for node-pty)
- [Electron](https://electronjs.org)
- An [Anthropic API key](https://console.anthropic.com)

### Installation

```bash
git clone https://github.com/your-username/mindact
cd mindact
bun install
cd client && bun install && cd ..
```

### Configuration

```bash
cp .env.example .env
# Add your Anthropic API key to .env
```

### Run

```bash
# Start everything (server + Vite dev + Electron)
./restart.sh

# Or: server + frontend only (no Electron, opens in browser)
bun run dev
# Then open http://localhost:5173
```

On first launch, MindAct will ask you to configure:
- **Vault path** — folder where your private knowledge base markdown files live
- **Project path** — your working project directory (opened in the Claude Code terminal)

---

## Dependency Analysis

The analysis runs a 4-stage LLM pipeline (all `claude-haiku` for speed, typically 3–8 seconds):

1. **Domain detection** — is this a domain-specific task (robotics, physics, etc.)?
2. **Dependency decomposition** — what knowledge modules does this task require?
3. **KB matching** — which of your existing files cover each dependency?
4. **Confidence scoring** — critical deps weight 3×, partial coverage = 50%

**Confidence levels:**
- ≥ 75% → **High** — `▶ Execute` with enriched prompt
- 40–74% → **Medium** — `▶ Execute` with missing dep warning
- < 40% → **Low** — `⚠ Execute anyway` or fill gaps first

**Ghost nodes** appear for missing deps. Clicking opens a new markdown file pre-filled with an AI-generated template specific to that dependency and your task context.

---

## Knowledge Base

MindAct works with plain markdown files. Files cross-reference each other using `[[filename]]` wiki-style links — the same format as Obsidian. The Brain Graph is built from these links automatically and updates live.

Two KB types:
- **Private** — your own files, editable, stored in your vault path
- **Platform** — read-only reference modules (physics, algorithms, robots, etc.) installable from the platform library

---

## Running tests

```bash
bun test tests/              # full suite (102 tests)
bun test tests/decision_manager/
bun test tests/graph_manager/
bun test tests/api/          # requires running server
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Used for dependency analysis pipeline |

---

## License

MIT
