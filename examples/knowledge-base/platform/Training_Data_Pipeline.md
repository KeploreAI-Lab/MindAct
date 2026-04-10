# Training_Data_Pipeline

**Type:** Platform Decision Dependency  
**Domain:** Data Engineering  
**Status:** Stable

---

## 训练数据管线概述

VLA 模型训练依赖高质量的机器人演示数据（demonstration data）。本文档定义数据从采集到入库的完整流程规范，是保证训练-推理一致性的核心契约。

---

## 数据格式标准：RLDS / LeRobot

本项目采用 **LeRobot** 格式（基于 HuggingFace datasets），兼容主流 VLA 训练框架。

每条 episode 包含：
```python
{
  "observation.images.base":    # (T, H, W, 3) uint8 RGB
  "observation.images.wrist":   # (T, H, W, 3) uint8 RGB
  "observation.state":          # (T, 7) float32 关节角度
  "action":                     # (T, 7) float32 归一化动作
  "timestamp":                  # (T,) float64 Unix时间戳
  "episode_index":              # int
  "task_description":           # str 自然语言任务描述
}
```

图像规范遵循 {{Sensor_IO_Spec}} 中的采集标准。

---

## 动作归一化计算

在数据集构建时计算并存储归一化统计量：

```python
# 生成 action_stats.json
action_mean = dataset["action"].mean(axis=(0,1))   # shape (7,)
action_std  = dataset["action"].std(axis=(0,1))    # shape (7,)
```

此文件路径：`data/action_stats.json`  
推理时引用方式见 {{Action_Space_Definition}}。

---

## 时间戳同步策略

多传感器数据对齐方案：
1. 以底层控制器时钟为主时钟
2. 摄像头帧以最近邻插值对齐至控制频率
3. 容差 ±5ms，超出则标记并在数据清洗阶段丢弃

---

## 数据质量过滤规则

| 过滤条件 | 处理 |
|----------|------|
| episode 长度 < 10步 | 丢弃 |
| 触发安全急停的 episode | 标记，人工审核后决定是否保留 |
| 动作方差过低（机器人静止） | 丢弃 |
| 任务描述为空 | 丢弃 |

安全急停标准见 {{Safety_Constraints}}。

---

## 数据集构成（项目私有部分）

具体的数据集名称、数量、采集场景、任务分布属于项目私有信息：
- 见 Dataset_Registry（private）

数据采集的实际机器人型号与场景配置：
- 见 Robot_Hardware_Config（private）

---

## 与本项目的关联依赖

- {{VLA_Fundamentals}} — 模型架构决定数据格式细节（如是否需要多视角）
- {{Sensor_IO_Spec}} — 数据采集遵循传感器接口规范
- {{Action_Space_Definition}} — 归一化统计量对应特定动作空间定义
- {{Safety_Constraints}} — 安全事件数据的处理策略
- {{Inference_Latency_Budget}} — 数据加载效率影响训练吞吐

---

## 工具链

```bash
# 数据采集
python scripts/collect_demos.py --config configs/collection.yaml

# 数据集构建（生成 LeRobot 格式 + action_stats.json）
python scripts/build_dataset.py --input raw_demos/ --output data/

# 数据集统计检查
python scripts/dataset_stats.py --dataset data/
```
