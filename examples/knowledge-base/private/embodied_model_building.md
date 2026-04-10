# 具身智能模型构建流程

具身智能模型通常需要把感知、状态估计、策略学习与控制闭环整合。

## 典型流水线

1. 任务定义与奖励设计
2. 仿真环境搭建（动力学与接触模型）
3. 策略训练（RL/模仿学习）
4. Sim2Real 迁移与鲁棒性验证

## 核心挑战

- 观测延迟与部分可观测性
- 接触动力学不稳定
- 仿真到真实差距（domain gap）

## 常见方法

- 域随机化（Domain Randomization）
- 系统辨识（System Identification）
- 行为克隆 + 强化学习微调

## 关联

- 轨迹与控制约束见 [[control_dynamics]] 与 [[trajectory_optimization]]
- 数值稳定性见 [[numerical_methods_physics]]
- 平台 VLA 架构参考见 {{VLA_Fundamentals}}
- 动作空间接口规范见 {{Action_Space_Definition}}
