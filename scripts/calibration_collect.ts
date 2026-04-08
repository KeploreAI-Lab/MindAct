import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { analyzeDependencies } from "../decision_manager/tasks/dependency_analysis";
import { aiCall, FAST_MODEL } from "../decision_manager/ai_client";

type Sample = {
  task: string;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  foundFiles: string[];
  missingDeps: string[];
  label: 0 | 1;
  rationale: string;
};

const DOMAIN_TOPICS = [
  "具身医疗机器人",
  "医疗多模态模型",
  "机器人轨迹优化",
  "控制系统离散实现",
  "医学诊断模型",
  "联邦医疗学习系统",
  "医学成像物理建模",
  "世界模型与策略学习",
  "轨道机动控制",
  "统计物理不确定性建模",
];

const GOALS = [
  "给出可执行的模型架构与训练流程",
  "明确关键约束并设计评估方案",
  "做部署前风险审查与回滚方案",
  "提出低资源条件下的落地路线",
  "比较两种方案并给出选择依据",
];

const REQUIREMENTS = [
  "包含多传感器融合、策略优化和上线监控",
  "包含数据处理、模型训练、验证和部署",
  "包含安全约束、隐私合规和错误恢复",
  "包含评价指标、消融实验和失败案例分析",
  "包含数值稳定性、实时性和资源开销分析",
];

const EXTRA_CONSTRAINTS = [
  "要求说明关键超参数范围与调参顺序",
  "要求说明缺失知识下的保守策略",
  "要求输出分阶段里程碑与验收标准",
  "要求标注高风险假设与验证实验",
  "要求给出可追踪日志字段设计",
];

function buildTasks(target = 100): string[] {
  const tasks: string[] = [];
  for (const d of DOMAIN_TOPICS) {
    for (const g of GOALS) {
      for (const r of REQUIREMENTS) {
        for (const e of EXTRA_CONSTRAINTS) {
          tasks.push(`请围绕“${d}”${g}；${r}；${e}。`);
          if (tasks.length >= target) return tasks;
        }
      }
    }
  }
  return tasks.slice(0, target);
}

function parseJudge(raw: string): { label: 0 | 1; rationale: string } {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : raw);
    return {
      label: Number(obj?.label) === 1 ? 1 : 0,
      rationale: String(obj?.rationale ?? ""),
    };
  } catch {
    return { label: 0, rationale: "parse_failed" };
  }
}

async function main() {
  const target = Number(process.env.CALIB_SAMPLES ?? 100);
  const TASKS = buildTasks(target);
  const vaultPath = join(process.cwd(), "knowledge_base");
  const outDir = join(process.cwd(), "research", "calibration");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "confidence_samples.jsonl");

  const rows: string[] = [];
  for (const task of TASKS) {
    const report = await analyzeDependencies({
      task,
      vaultPath,
      onEvent: () => {},
    });

    const judgeRaw = await aiCall({
      model: FAST_MODEL,
      maxTokens: 220,
      system:
        "你是严格评估器。判断该分析报告是否足以支持任务执行。只输出 JSON：{\"label\":0|1,\"rationale\":\"...\"}",
      messages: [
        {
          role: "user",
          content: `任务：${task}
置信度：${report.confidence}
找到文件：${report.foundFiles.join(", ")}
缺失依赖：${report.missingDeps.join(", ")}

标准：
1) 若缺失关键依赖较多或命中文档明显偏题，label=0；
2) 若可支持执行且缺失可接受，label=1。`,
        },
      ],
    });
    const judge = parseJudge(judgeRaw);

    const sample: Sample = {
      task,
      confidence: report.confidence,
      confidenceLevel: report.confidenceLevel,
      foundFiles: report.foundFiles,
      missingDeps: report.missingDeps,
      label: judge.label,
      rationale: judge.rationale,
    };
    rows.push(JSON.stringify(sample));
    console.log(`[collect] confidence=${sample.confidence} label=${sample.label} task=${task.slice(0, 28)}...`);
  }

  writeFileSync(outPath, rows.join("\n") + "\n", "utf-8");
  console.log(`[collect] wrote ${rows.length} samples -> ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

