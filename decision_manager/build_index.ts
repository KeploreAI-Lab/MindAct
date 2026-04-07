import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

export const BRAIN_INDEX_PATH = join(homedir(), ".physmind", "BRAIN_INDEX.md");

export function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(d: string) {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(d, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith(".md")) files.push(full);
    }
  }
  walk(dir);
  return files;
}

export function parseLinks(content: string): string[] {
  // Matches both [[wiki]] and {{ cross }} links
  const re = /\[\[([^\]]+)\]\]|\{\{([^}]+)\}\}/g;
  const links: string[] = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    links.push((m[1] || m[2]).trim());
  }
  return links;
}

export interface BuildIndexOptions {
  vaultPath: string;
  platformDir?: string;
}

export function buildIndex(options: BuildIndexOptions): string {
  const { vaultPath, platformDir = join(homedir(), ".physmind", "platform") } = options;

  const privateFiles = vaultPath && existsSync(vaultPath) ? collectMdFiles(vaultPath) : [];
  const platformFiles = existsSync(platformDir) ? collectMdFiles(platformDir) : [];

  // Build name → source map
  const nameToSource = new Map<string, "platform" | "private">();
  for (const f of platformFiles) nameToSource.set(basename(f, ".md"), "platform");
  for (const f of privateFiles) nameToSource.set(basename(f, ".md"), "private");

  // Build adjacency lists
  const adj = new Map<string, Set<string>>();
  for (const f of [...platformFiles, ...privateFiles]) {
    const name = basename(f, ".md");
    if (!adj.has(name)) adj.set(name, new Set());
    try {
      const links = parseLinks(readFileSync(f, "utf-8"));
      for (const link of links) if (nameToSource.has(link)) adj.get(name)!.add(link);
    } catch {}
  }

  // Extract description from first non-heading paragraph
  const getDesc = (f: string): string => {
    try {
      const lines = readFileSync(f, "utf-8").split("\n");
      const descLine = lines.find(l => l.trim() && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("|"));
      return (descLine || "").replace(/[*_`]/g, "").trim().slice(0, 60);
    } catch { return ""; }
  };

  // Group adjacency lines by relationship type
  const platInternal: string[] = [];
  const privToPlatform: string[] = [];
  const privInternal: string[] = [];

  for (const [name, targets] of adj) {
    if (!targets.size) continue;
    const src = nameToSource.get(name);
    if (src === "platform") {
      platInternal.push(`${name.padEnd(30)} → ${[...targets].join(", ")}`);
    } else {
      const crossLinks = [...targets].filter(t => nameToSource.get(t) === "platform");
      const internalLinks = [...targets].filter(t => nameToSource.get(t) === "private");
      if (crossLinks.length) privToPlatform.push(`${name.padEnd(30)} → ${crossLinks.join(", ")}`);
      if (internalLinks.length) privInternal.push(`${name.padEnd(30)} → ${internalLinks.join(", ")}`);
    }
  }

  const adjSection = [
    "# Platform 内部连接",
    ...platInternal,
    "",
    "# Private → Platform 连接",
    ...privToPlatform,
    "",
    "# Private 内部连接",
    ...privInternal,
  ].join("\n");

  // Build file index tables
  const platRows = platformFiles.map(f => {
    const name = basename(f, ".md");
    return `| [[${name}]] | - | ${getDesc(f)} |`;
  }).join("\n");

  const privRows = privateFiles.map(f => {
    const name = basename(f, ".md");
    return `| [[${name}]] | - | ${getDesc(f)} |`;
  }).join("\n");

  const now = new Date().toLocaleDateString("zh-CN");
  const content = `# Decision Dependency Vault — Brain Index

**生成时间：** ${now}
**Platform 模块数：** ${platformFiles.length}  **Private 文件数：** ${privateFiles.length}
**用途：** AI Agent 推理时的结构化决策上下文索引
**维护规范：** 每个文件的 \`本项目的关联依赖\` 章节定义所有边，供 graph 遍历使用

---

## 文件索引

### Platform（通用知识，可跨项目复用）

| 文件 | 领域 | 核心内容 |
|------|------|----------|
${platRows || "| - | - | 暂无 Platform 文件 |"}

### Private（项目上层，与具体场景绑定）

| 文件 | 领域 | 核心内容 |
|------|------|----------|
${privRows || "| - | - | 暂无 Private 文件 |"}

---

## 依赖关系图（邻接表）

> ⚠️ 此区域由系统自动生成，请勿手动修改。如需更新请点击「重新生成」。

\`\`\`
${adjSection}
\`\`\`

---

## AI Graph 检索使用说明

**入口策略：** 根据任务类型选择入口节点
${platformFiles.slice(0, 5).map(f => `- 问 ${basename(f, ".md")} 相关 → 从 \`${basename(f, ".md")}\` 出发`).join("\n")}
${privateFiles.slice(0, 3).map(f => `- 问 ${basename(f, ".md")} 相关 → 从 \`${basename(f, ".md")}\` 出发`).join("\n")}

**遍历规则：**
1. 读取入口文件
2. 提取 \`本项目的关联依赖\` 中的 \`[[链接]]\` 或 \`{{ 跨链 }}\`
3. 判断是否需要读取（有任务相关性）
4. 递归展开（最大深度建议 2-3 跳）
5. Platform 文件优先读取（通用知识），Private 文件按需加载（具体参数）
`;

  writeFileSync(BRAIN_INDEX_PATH, content, "utf-8");
  return content;
}
