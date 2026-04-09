# Inference_Latency_Budget

**Type:** Platform Decision Dependency  
**Domain:** Real-Time Systems  
**Status:** Stable

---

## 延迟预算框架

VLA 系统用于实时机器人控制，端到端延迟直接决定可用的控制频率。本文档定义延迟预算的分解方式和各环节的约束。

---

## 端到端延迟分解

```
总预算 = 图像采集延迟 + 预处理延迟 + 模型推理延迟 + 安全检查延迟 + 控制指令发送延迟
```

以控制频率 **5 Hz**（200ms/步）为例：

| 环节 | 预算 | 说明 |
|------|------|------|
| 图像采集 & 传输 | ≤ 20ms | USB3 / GigE 摄像头 |
| 图像预处理（resize, normalize） | ≤ 10ms | CPU端，见 [[Sensor_IO_Spec]] |
| 模型推理（VLM backbone + action head） | ≤ 150ms | **主要瓶颈** |
| 安全层检查 | ≤ 10ms | 见 [[Safety_Constraints]] |
| 指令发送 & 底层响应 | ≤ 10ms | 见 [[Robot_Hardware_Config]]（private）|
| **合计** | **≤ 200ms** | **= 5 Hz 控制周期** |

---

## 模型推理延迟分解

推理延迟是主要可控变量，受以下因素影响：

**模型规模：**
- 7B 参数模型（如 OpenVLA）：A100上约 80-120ms，边缘GPU（RTX 4090）约 150-200ms
- 3B 参数模型：可在边缘GPU达到 50-80ms

**chunk_size（预测步数）：**
- chunk_size 增大 → 单次推理覆盖更多步 → 等效控制频率降低但平滑性提升
- 与 [[Action_Space_Definition]] 中的时序集成参数联合优化

**量化策略：**
- INT8量化：推理速度提升约 1.5-2x，精度损失通常可接受
- 量化配置见 [[Model_Deployment_Config]]（private）

---

## 异步推理架构

为解决推理延迟与控制频率的矛盾，采用异步流水线：

```
[控制线程] 以 500Hz 运行底层控制器，消费动作队列
     ↑
[动作队列] 缓冲 chunk_size 步预测动作
     ↑
[推理线程] 以 5Hz 异步更新动作队列
     ↑
[感知线程] 持续采集最新帧，供推理线程取用
```

队列空时（推理超时）的降级策略：保持末端执行器静止，触发告警。

---

## 与本项目的关联依赖

- [[VLA_Fundamentals]] — 模型规模选型直接决定推理延迟
- [[Action_Space_Definition]] — chunk_size 和时序集成参数设置
- [[Sensor_IO_Spec]] — 图像采集和预处理延迟
- [[Safety_Constraints]] — 安全检查延迟纳入预算
- [[Training_Data_Pipeline]] — 模型选型（7B vs 3B）影响数据需求量

---

## 延迟测量工具

```bash
# 端到端延迟 profiling
python scripts/benchmark_latency.py --config configs/deploy.yaml --n_runs 100

# 输出各环节 P50/P95/P99 延迟分布
```
