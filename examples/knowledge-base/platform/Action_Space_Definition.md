# Action_Space_Definition

**Type:** Platform Decision Dependency  
**Domain:** Robot Control Interface  
**Status:** Stable

---

## 动作空间定义

动作空间是 VLA 模型输出层与机器人底层控制器之间的**接口契约**。它定义了模型每步输出的维度、物理含义、量纲和约束范围。

---

## 常见动作空间类型

### 末端执行器增量控制（Delta EEF）
最常用于通用操作任务。

```
action = [Δx, Δy, Δz, Δroll, Δpitch, Δyaw, gripper]
维度：7
单位：Δxyz in meters, Δrpy in radians, gripper in [0,1]
典型步长：Δxyz ≤ 0.02m/step, Δrpy ≤ 0.05rad/step
控制频率：3-10 Hz（VLA推理周期）
```

### 关节空间控制（Joint Position）
精度更高，但泛化性较弱。

```
action = [q1, q2, q3, q4, q5, q6, q7, gripper]
维度：7-8（取决于机械臂DOF）
单位：radians
适用场景：高重复性、对精度要求极高的任务
```

### 混合控制（Hybrid）
π0 等新架构采用，前几步用 EEF 粗调，后几步用关节精调。

---

## 动作归一化

所有动作值在送入模型训练和推理前必须归一化至 [-1, 1]。

归一化统计量（均值和标准差）需从训练数据中计算，并存储为项目级资产：
- 路径：见 [[Training_Data_Pipeline]] 中的 `action_stats.json`
- 推理时反归一化：`a_real = a_normalized * std + mean`

⚠️ 归一化统计量是与特定数据集绑定的，**跨数据集迁移必须重新计算**。

---

## 动作平滑

VLA 输出的原始动作序列可能存在高频噪声，需要在控制器侧做平滑处理：

- **时序集成（Temporal Ensemble）**：对最近 N 帧的预测动作取加权平均，权重随时间衰减
- 参数 `chunk_size`（预测步数）和 `ensemble_window` 需要与 [[Inference_Latency_Budget]] 联合调优

---

## 与本项目的关联依赖

- [[VLA_Fundamentals]] — 动作空间选型与模型架构相互约束
- [[Sensor_IO_Spec]] — 传感器帧率决定了动作控制频率的上限
- [[Safety_Constraints]] — 动作范围限制必须在此定义中体现
- [[Inference_Latency_Budget]] — chunk_size 设置依赖延迟预算
- [[Training_Data_Pipeline]] — 归一化统计量由训练数据生成

---

## 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| - | 采用 Delta EEF 7DOF | 泛化性优先，任务类型多样 |
| - | chunk_size=16 | 平衡平滑性与响应速度 |
| - | 控制频率 5Hz | 受 [[Inference_Latency_Budget]] 约束 |
