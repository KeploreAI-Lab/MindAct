# 物理知识库索引（示例）

本目录为示例笔记，供 MindAct 图谱与依赖分析演示使用。文件之间用 `[[文件名]]` 互链（不含 `.md` 后缀亦可按工具配置解析）。

## 主题导航

| 主题 | 文件 |
|------|------|
| 牛顿力学 | [[newtonian_mechanics]] |
| 拉格朗日形式 | [[lagrangian_formalism]] |
| 热力学定律 | [[thermodynamics_laws]] |
| 麦克斯韦方程提要 | [[electromagnetism_maxwell]] |
| 狭义相对论入门 | [[special_relativity_intro]] |
| 哈密顿力学 | [[hamiltonian_mechanics]] |
| 统计物理基础 | [[statistical_mechanics]] |
| 连续介质力学 | [[continuum_mechanics]] |
| 控制与动力学 | [[control_dynamics]] |
| 信号与系统 | [[signal_and_systems]] |
| 数值方法 | [[numerical_methods_physics]] |
| 轨迹优化 | [[trajectory_optimization]] |
| 单位与量纲分析 | [[units_and_dimensional_analysis]] |
| 轨道动力学 | [[orbital_dynamics]] |
| 具身智能建模 | [[embodied_model_building]] |
| Sim2Real 迁移 | [[embodied_sim2real]] |
| 医学模型构建 | [[medical_model_building]] |
| 医学评估指标 | [[medical_evaluation_metrics]] |
| 医学多模态融合 | [[medical_multimodal_fusion]] |

## 平台文件（{{}} 链接）

| 主题 | 文件 |
|------|------|
| VLA 基础架构 | {{VLA_Fundamentals}} |
| 动作空间定义 | {{Action_Space_Definition}} |
| 传感器接口规范 | {{Sensor_IO_Spec}} |
| 安全约束 | {{Safety_Constraints}} |
| 推理延迟预算 | {{Inference_Latency_Budget}} |
| 训练数据管线 | {{Training_Data_Pipeline}} |

## 阅读顺序建议

1. [[newtonian_mechanics]] → [[lagrangian_formalism]]
2. [[electromagnetism_maxwell]] ↔ [[special_relativity_intro]]
3. [[thermodynamics_laws]] 可独立阅读，与经典力学并列补充“多粒子/统计”视角
4. [[lagrangian_formalism]] → [[hamiltonian_mechanics]] → [[trajectory_optimization]]
5. [[control_dynamics]] ↔ [[signal_and_systems]]，并配合 [[numerical_methods_physics]] 实现
