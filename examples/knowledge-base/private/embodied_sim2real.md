# Sim2Real 与策略迁移

Sim2Real 目标是在仿真中训练、在真实机器人上稳定部署。

## 关键技术

- 动力学参数随机化（质量、摩擦、阻尼）
- 传感器噪声注入与延迟建模
- 残差策略（Residual Policy）

## 评估指标

- 成功率
- 平均回报
- 故障率与安全停机率

## 关联

- 底层动力学建模见 [[newtonian_mechanics]] / [[hamiltonian_mechanics]]
- 控制实现见 [[control_dynamics]]
