# MindAct

> **从 ReAct 到 MindAct。** ReAct 让 Agent 在行动前先推理。MindAct 更进一步 —— 在 Agent 行动前，它先知道自己不知道什么。

**MindAct** 是一款桌面 AI 工作台，将 Claude Code 终端、内置的 Obsidian 风格知识图谱和智能依赖分析引擎融为一体，专为从事机器人、物理仿真、控制系统等领域工程项目的研发人员打造。

<p align="center">
  <img src="assets/mindact_ecosystem.png" alt="MindAct 完整生态" width="78%" style="border-radius: 10px;">
  <br>
  <em>MindAct：以人类专属知识驱动的 AI Agent</em>
</p>

MindAct 围绕两个相互强化的循环构建。右侧是**知识积累循环**：人类将真实挑战和领域经验结构化为知识库，知识库反过来深化人类对领域的理解。左侧是**人在回路执行循环**：Agent 调用这些知识完成规划、调用 Skill、驱动工具执行，将输出和日志返回给人类验证。当结果有误或知识缺失时，人类直接补充知识给 Agent —— 循环持续收紧。

Skill 站在两个循环的交叉点：它是从知识中提炼出来的可执行方案，随时可被调用。系统的设计目标是：每次执行让知识库更完整，每次知识更新让下次执行更可靠。

你可以把 MindAct 理解成"做菜系统"：

- **Knowledge Base（知识库）** = 菜谱库、食材知识、火候经验
- **Skill（技能）** = 一套可执行的做菜流程模块
- **Execution Tool（执行工具）** = 锅、灶台、机械臂、CLI 工具
- **Agent（智能体）** = 调用流程并真正把菜做出来的人/系统

MindAct 的核心是"知识优先"：持续积累、结构化和扩展领域知识。Skill 只是建立在知识之上的复用层，用来加速重复任务执行。

<p align="center">
  <img src="assets/hero_screenshot.jpg" alt="MindAct 桌面 — Brain Graph × Claude Code 终端" width="100%" style="border-radius: 10px;">
  <br>
  <em>MindAct 桌面 — Brain Graph（左）× Claude Code 终端（右）</em>
</p>

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
            可信度：中等
            → 携带完整上下文的富化 Prompt 发送给 Claude
```

---

## 它能做什么

```
用户任务 → Skill 匹配 → （未命中时）依赖分析 → 知识检索 → 富化 Prompt → Claude
```

**从用户视角看，一次任务是这样跑的：**

1. 你在终端输入任务。
2. MindAct 先判断是否有可复用 Skill 命中。
3. 若命中，你可选择：
   - `Apply this Skill`（按 Skill 引导执行），或
   - `Without skill`（原始任务直接发送）。
4. 若未命中，进入依赖分析 + 知识检索流程。
5. 你会看到报告，包含：
   - 已覆盖依赖，
   - 缺失依赖，
   - 可信度等级（`High / Medium / Low`）。
6. 若 AI 结论不确定（缺失依赖、链路断裂、低可信度），先补充或修正知识。
7. MindAct 通过 Ghost 节点模板帮你快速填写缺失知识。
8. 补完后重新分析，再执行，让 Claude 基于更完整上下文工作。

**核心功能：**

- **Claude Code 终端** — 在应用内嵌入完整的 Claude Code 交互会话
- **知识优先工作流** — 每次任务都可以反哺知识库，持续提升后续任务质量
- **Skill 复用层** — 用于加速高重复任务，不替代知识沉淀本身
- **Skills 工作区** — 独立 `Skills` 标签页，可浏览/编辑 `skills_path` 下的 Skill 文件
- **Obsidian 风格 Brain Graph** — 你的知识库以交互式 `[[wiki 链接]]` 图谱呈现，任务相关节点自动发光高亮
- **依赖分析引擎** — 多阶段 LLM 流水线，检测任务所需知识、匹配知识库文件、在执行前给出可信度
- **Ghost 节点** — 缺失依赖以空心红圈形式出现在图谱中，点击即可获得 AI 生成的结构化模板
- **流式分析日志** — 以 SSE 实时推送进度，悬浮显示在图谱上方，不阻断你的工作流
- **上下文富化执行** — 点击执行时，Claude 会同时收到你的任务和所有相关知识库内容
- **知识模板** — 当知识缺失时，MindAct 生成的不是空白文件，而是针对该依赖和任务背景定制的结构化模板
- **Knowledge → Skill 转化** — 当模式稳定后，将已验证知识沉淀为可复用 Skill 草稿

---

## 背后的智能机制

MindAct 基于你的 `[[wiki 链接]]` Markdown 文件构建一张实时知识图谱，检索层正是建立在这张图谱之上。它不做简单的文本相似度匹配，而是将词频相关性、字符 n-gram 语义相似度和图谱结构邻近度结合起来打分——既话题相关、又在图谱中与最优候选节点相连的文件会获得更高排名。检索前还会通过领域词典对查询词做扩展，让专业缩写和工程术语也能准确找到目标文件。

依赖项被显式拆解，而非隐式假设。若第一轮拆解结果为空或过于模糊，系统会先检索最相关的文件，以此为提示重试 —— 这一自纠错循环能显著减少模糊任务下"找不到依赖"的结果。最终匹配结果经过确定性后处理：覆盖率归一化、去重、缺口由本地检索兜底填补、结果按固定规则排序。相同的任务在不同时间运行，输出一致。

可信度是多因素的加权融合：依赖覆盖率（关键项权重 3 倍）、检索内容与每个依赖描述的语义对齐程度，以及缺失项带来的噪声惩罚。除此之外，MindAct 还会验证关键依赖是否在知识图谱中构成连通链路——拥有正确的文件还不够，这些文件在逻辑上也必须相互衔接。断裂链路会在执行前被明确标出，而不是在执行中途才暴露。

这套设计借鉴了 [CRAG](https://arxiv.org/abs/2401.15884) 基于评估器的检索纠错思路、[GraphRAG](https://arxiv.org/abs/2404.16130) 的图结构证据检索设计，以及 [Self-RAG](https://arxiv.org/abs/2310.11511) 的选择性重生成原则，并参考后验概率校准方法处理可信度输出。目标不是理论上的完备性，而是让输出在工程场景中足够可靠——在那些"答错了代价很高"的工作流里。

---

## 从 ReAct 到 MindAct

**ReAct**（推理 + 行动）是一个突破：让 Agent 在行动前一步步思考。

**MindAct** 补上了缺失的一层：*结构化领域记忆*。

| | ReAct | MindAct |
|---|---|---|
| 推理能力 | ✅ 思维链 | ✅ 继承 |
| 行动能力 | ✅ 工具调用 | ✅ Claude Code |
| **领域记忆** | ❌ 无状态 | ✅ 知识图谱 |
| **依赖感知** | ❌ 隐式 | ✅ 显式执行前检查 |
| **可信度评分** | ❌ 无 | ✅ 执行前高/中/低等级 |
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
│   ├── graph_retrieval.ts     # 混合检索
│   ├── skill_matcher.ts       # Skill 匹配
│   ├── prompts/               # 所有 LLM Prompt（按任务分文件管理）
│   └── tasks/
│       └── dependency_analysis.ts  # 主分析流水线
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
git clone https://github.com/KeploreAI-Lab/MindAct
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
- **Skills 路径** — 复用 Skill 的根目录（如 `skills-test`）

---

## 依赖分析

<p align="center">
  <img src="assets/dependency_analysis.jpg" alt="依赖分析 — 流式日志、Ghost 节点、可信度报告" width="100%" style="border-radius: 10px;">
  <br>
  <em>依赖分析 — 流式日志、Ghost 节点（红色虚线）和可信度报告</em>
</p>

在 Skill 未命中时触发。系统先识别任务所属领域，再将任务显式拆解为若干知识依赖项，通过混合检索匹配知识库文件，最终输出可信度等级。整个过程通常耗时 3–8 秒。

**可信度等级：**
- ≥ 75% → **高** — `▶ Execute`，注入富化 Prompt
- 40–74% → **中等** — `▶ Execute`，附缺失依赖警告
- < 40% → **低** — 优先补齐知识；仅在必要时使用 `⚠ Execute anyway`

**Ghost 节点**对应缺失依赖，点击后打开一个新 Markdown 文件，内容是针对该依赖和任务背景定制的 AI 生成模板 —— 不是空白文件，而是告诉你该写什么的结构化向导。

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

AGPL-3.0

---

<p align="center">
  由 <a href="https://github.com/KeploreAI-Lab">KeploreAI Lab</a> 构建 · <a href="https://discord.gg/hpq9t4QQ">💬 加入 Discord</a>
</p>
