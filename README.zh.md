# MindAct

> **从 ReAct 到 MindAct。** ReAct 让 Agent 在行动前先推理。MindAct 更进一步 —— 在 Agent 行动前，它先知道自己不知道什么。

**MindAct** 是一款桌面 AI 工作台，将 Claude Code 终端、内置的 Obsidian 风格知识图谱和智能依赖分析引擎融为一体，专为从事机器人、物理仿真、控制系统等领域工程项目的研发人员打造。

不要再裸发 prompt 给 Claude 了。MindAct 会自动从你的知识库中检索相关上下文，在执行前评分可信度、标出知识缺口 —— 让 Claude 每次都有足够的弹药，把任务做对。

> English documentation: [README.md](./README.md)

---

## 为什么需要 MindAct？

大多数 AI 编码助手对所有任务一视同仁：你输入，它生成。这对 CRUD 应用够用了。对领域专项工程，这行不通。

**问题所在：** Claude 不知道你机器人的关节限位、你电机控制器的 PID 参数，也不知道你团队的坐标系约定 —— 除非你每次都告诉它。

**解决方案：** MindAct 维护一个与项目关联的结构化知识库。每次执行任务前，它会运行一条依赖分析流水线：检查任务需要什么知识、你已有什么、缺什么。然后自动将正确的上下文注入到 prompt 中。

```
❌  以前：  "设计一个 6-DOF 机械臂的轨迹规划方案"
            → Claude 开始猜。结果质量不稳定。调试耗时数小时。

✅  现在：  MindAct 识别：机器人工程领域
            已找到：joint_constraints.md、workspace_config.md
            缺失：trajectory_algorithm.md  ← 自动生成填写模板
            可信度：72% 中等
            → 携带完整上下文的富化 Prompt 发送给 Claude
```

---

## 它能做什么

```
用户任务 → 依赖分析 → 知识检索 → 富化 Prompt → Claude
```

**核心功能：**

- **Claude Code 终端** — 在应用内嵌入完整的 Claude Code 交互会话
- **Obsidian 风格 Brain Graph** — 你的知识库以交互式 `[[wiki 链接]]` 图谱呈现，任务相关节点自动发光高亮
- **依赖分析引擎** — 四阶段 LLM 流水线，检测任务所需知识、匹配知识库文件、在执行前评分可信度
- **Ghost 节点** — 缺失依赖以空心红圈形式出现在图谱中，点击即可获得 AI 生成的结构化模板
- **流式分析日志** — 以 SSE 实时推送进度，悬浮显示在图谱上方，不阻断你的工作流
- **上下文富化执行** — 点击执行时，Claude 会同时收到你的任务和所有相关知识库内容
- **知识模板** — 当知识缺失时，MindAct 生成的不是空白文件，而是针对该依赖和任务背景定制的结构化模板

---

## 从 ReAct 到 MindAct

**ReAct**（推理 + 行动）是一个突破：让 Agent 在行动前一步步思考。

**MindAct** 补上了缺失的一层：*结构化领域记忆*。

| | ReAct | MindAct |
|---|---|---|
| 推理能力 | ✅ 思维链 | ✅ 继承 |
| 行动能力 | ✅ 工具调用 | ✅ Claude Code |
| **领域记忆** | ❌ 无状态 | ✅ 知识图谱 |
| **依赖感知** | ❌ 隐式 | ✅ 显式 pre-flight 检查 |
| **可信度评分** | ❌ 无 | ✅ 执行前 0–100% 评分 |
| **知识缺口检测** | ❌ 无 | ✅ Ghost 节点 + 填写模板 |

> ReAct 问的是：*"我下一步该做什么？"*
> MindAct 先问：*"我有没有把这件事做对所需要的一切？"*

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面外壳 | Electron |
| 服务器 / 运行时 | Bun |
| 前端 | React + Vite |
| 终端 | xterm.js + node-pty |
| 知识图谱 | D3.js 力导向图（Obsidian 风格 `[[链接]]`） |
| 代码编辑器 | CodeMirror 6 |
| AI | Anthropic Claude API（`claude-sonnet-4-6` / `claude-haiku-4-5`） |

---

## 项目结构

```
mindact/
├── server.ts                  # Bun HTTP 服务器（REST + SSE + WebSocket）
├── electron-main.cjs          # Electron 主进程
├── client/                    # React + Vite 前端
│   └── src/
│       ├── components/
│       │   ├── Terminal.tsx        # Claude Code 终端 + 分析输入框
│       │   ├── KBPanel.tsx         # 知识库面板
│       │   ├── Graph.tsx           # Brain Graph（d3）
│       │   ├── GraphLogDrawer.tsx  # 分析日志悬浮层
│       │   └── DependencyReport.tsx
│       ├── graph_manager/          # D3 渲染器、类型定义、配置
│       └── store.ts                # Zustand 全局状态
├── decision_manager/          # AI 分析引擎
│   ├── ai_client.ts           # Anthropic SDK 封装
│   ├── build_index.ts         # Markdown 图谱索引构建
│   ├── prompts/               # 所有 LLM Prompt（按任务分文件管理）
│   └── tasks/
│       └── dependency_analysis.ts  # 四阶段分析流水线
└── tests/                     # Bun 测试套件（102 个测试）
```

---

## 快速开始

### 环境要求

- [Bun](https://bun.sh) ≥ 1.0
- [Node.js](https://nodejs.org) ≥ 18（node-pty 依赖）
- [Electron](https://electronjs.org)
- [Claude Code CLI](https://docs.anthropic.com/claude-code) — `npm install -g @anthropic-ai/claude-code`
- [Anthropic API Key](https://console.anthropic.com)

### 安装

```bash
git clone https://github.com/your-username/mindact
cd mindact
bun install
cd client && bun install && cd ..
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，填入你的 Anthropic API Key
```

### 启动

```bash
# 一键启动（服务器 + Vite + Electron）
./restart.sh

# 或：仅启动服务器 + 前端（浏览器中打开）
bun run dev
# 访问 http://localhost:5173
```

首次启动时，MindAct 会引导你配置：
- **Vault 路径** — 存放私有知识库 Markdown 文件的文件夹
- **项目路径** — 你的工作项目目录（在 Claude Code 终端中打开）

---

## 依赖分析原理

四阶段 LLM 流水线（全部使用 `claude-haiku`，典型耗时 3–8 秒）：

1. **领域识别** — 判断任务是否为领域专项任务（机器人、物理仿真等）
2. **依赖拆解** — 分析执行该任务需要哪些知识模块
3. **知识匹配** — 将依赖项与知识库中的现有文件进行匹配
4. **可信度评分** — 必要依赖权重 3×，部分覆盖 = 50%

**可信度等级：**
- ≥ 75% → **高** — `▶ Execute`，注入富化 Prompt
- 40–74% → **中等** — `▶ Execute`，附缺失依赖警告
- < 40% → **低** — `⚠ Execute anyway` 或先补充知识

**Ghost 节点**对应缺失依赖，点击后打开一个新 Markdown 文件，内容是针对该依赖和任务背景定制的 AI 生成模板。

---

## 知识库格式

MindAct 使用普通 Markdown 文件作为知识库，与 Obsidian 完全兼容。文件之间通过 `[[文件名]]` wiki 风格语法互相引用，Brain Graph 自动根据链接关系构建图谱并实时更新。

知识库分为两类：
- **Private（私有）** — 你自己创建的文件，可编辑，存储在 vault 路径下
- **Platform（平台）** — 只读参考知识模块（物理、算法、机器人等），可从平台库安装

---

## 运行测试

```bash
bun test tests/              # 完整套件（102 个测试）
bun test tests/decision_manager/
bun test tests/graph_manager/
bun test tests/api/          # 需要服务器运行中
```

---

## 环境变量

| 变量名 | 是否必需 | 说明 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 是 | 用于依赖分析流水线 |

---

## 开源协议

MIT
