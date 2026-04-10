# Safety_Constraints

**Type:** Platform Decision Dependency  
**Domain:** Robot Safety Architecture  
**Status:** Stable — 任何修改需经过安全评审

---

## 安全约束体系

VLA 模型输出的动作在执行前必须通过多层安全过滤。安全层是模型推理与底层控制器之间的强制中间件，**不可绕过**。

---

## 第一层：运动学约束（硬约束）

在动作执行前实时检查，违反则立即拒绝并输出零动作：

```
关节角度范围：q_min ≤ q ≤ q_max（从 Robot_Hardware_Config 读取）
关节速度限制：|dq/dt| ≤ dq_max
末端执行器工作空间：EEF位置需在预定义安全包络内
单步动作幅度：|Δa| ≤ threshold（防止突变）
```

---

## 第二层：碰撞检测（软约束）

基于几何模型的实时碰撞预测：
- 使用简化凸包模型（非精确mesh，保证实时性）
- 检测机械臂自碰撞 和 与已知静态障碍物的碰撞
- 动态障碍物检测依赖 {{Sensor_IO_Spec}} 中的深度相机（若有）

碰撞预测正常时：放行动作  
碰撞风险 > 阈值时：减速并请求重规划  
碰撞不可避免时：急停

---

## 第三层：任务级监控（语义约束）

通过语言模型对当前执行状态进行高频语义检查（每 N 步一次）：
- 对照任务指令验证当前动作序列是否合理
- 检测异常模式（如重复原地运动、夹爪反复开合）
- 触发条件与恢复策略见 Error_Recovery_Policy（private）

---

## 传感器失效处理

| 传感器状态 | 处理策略 |
|-----------|----------|
| 摄像头信号丢失 > 100ms | 立即暂停，等待恢复 |
| 关节编码器异常 | 急停，需人工确认 |
| 力矩传感器超量程 | 减速至零，记录日志 |

传感器接口定义见 {{Sensor_IO_Spec}}。

---

## 安全参数来源

所有具体数值参数（关节限位、工作空间包络、速度阈值）均存储在项目私有配置中：
- 见 Robot_Hardware_Config（private）
- 见 Workspace_Envelope_Config（private）

⚠️ Platform 层只定义安全架构和检查逻辑，**具体参数值属于 private 范畴**，不在此文档中硬编码。

---

## 与本项目的关联依赖

- {{VLA_Fundamentals}} — 模型输出格式决定安全检查的接入点
- {{Action_Space_Definition}} — 动作范围定义是硬约束的来源
- {{Sensor_IO_Spec}} — 传感器失效是安全触发条件
- {{Inference_Latency_Budget}} — 安全检查本身的计算开销需纳入延迟预算
- {{Training_Data_Pipeline}} — 训练数据中的安全边界需与此保持一致
