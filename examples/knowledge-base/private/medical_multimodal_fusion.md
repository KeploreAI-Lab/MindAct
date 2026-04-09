# 医学多模态融合

多模态医学模型把影像、文本病历、检验指标等联合建模。

## 融合策略

- Early Fusion：输入层拼接
- Late Fusion：独立编码后融合
- Cross-Attention：跨模态交互

## 常见问题

- 模态缺失
- 时间对齐误差
- 模态间噪声尺度不一致

## 关联

- 评估指标见 [[medical_evaluation_metrics]]
- 模型构建见 [[medical_model_building]]
