# VLA_Fundamentals

**Type:** Platform Decision Dependency  
**Domain:** Vision-Language-Action Model Architecture  
**Status:** Stable

---

## 什么是 VLA（Vision-Language-Action）

VLA 是一类将视觉感知、语言理解与动作规划统一在单一模型中的机器人控制架构。与传统感知-规划-控制分离管线不同，VLA 模型直接从像素和语言指令输出机器人动作序列。

核心输入输出关系：
- 输入：RGB图像流 + 自然语言指令
- 输出：机器人末端执行器的动作向量（位姿增量 或 关节角度）

---

## 主流 VLA 架构谱系

| 架构 | 基础模型 | 动作表示 | 代表工作 |
|------|----------|----------|----------|
| RT-2 | PaLM-E | 离散token | Google DeepMind |
| OpenVLA | LLaVA-7B | 离散token | Stanford |
| π0 | PaliGemma | 连续flow | Physical Intelligence |
| RoboVLMs | 通用VLM | 混合 | 学术集合 |

---

## 动作表示的核心设计决策

### 离散化 vs 连续

**离散token方案：**  
将连续动作值分箱（bin）为词表中的特殊token，直接用语言模型 next-token prediction 输出动作。优点是架构统一，缺点是精度受限于分箱粒度（通常256级）。

**连续动作方案：**  
使用 Diffusion Policy 或 Flow Matching 作为动作头（action head），保留连续精度。π0 采用此方案，在灵巧操作任务上优于离散方案。

---

## 与本项目的关联依赖

- [[Sensor_IO_Spec]] — 摄像头与力矩传感器的接口规范影响模型输入构建
- [[Action_Space_Definition]] — 动作空间设计直接决定使用离散还是连续方案
- [[Safety_Constraints]] — 动作输出必须通过安全层过滤
- [[Training_Data_Pipeline]] — 数据格式与模型架构需要对齐
- [[Inference_Latency_Budget]] — 实时控制对推理延迟的硬性要求约束模型选型

---

## 关键参考

- RT-2: Robotic Transformer 2 (Brohan et al., 2023)
- OpenVLA: An Open-Source Vision-Language-Action Model (Kim et al., 2024)
- π0: A Vision-Language-Action Flow Model (Black et al., 2024)
