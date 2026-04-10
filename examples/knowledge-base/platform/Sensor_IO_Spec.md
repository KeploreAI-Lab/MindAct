# Sensor_IO_Spec

**Type:** Platform Decision Dependency  
**Domain:** Perception Hardware Interface  
**Status:** Stable

---

## 传感器接口规范

本文档定义 VLA 系统中所有传感器输入的标准接口，作为感知层与模型推理层之间的契约。

---

## 视觉传感器

### 标准摄像头配置

| 参数 | 规范值 | 说明 |
|------|--------|------|
| 分辨率（采集） | 640×480 或 1280×720 | 取决于场景精度需求 | {{ materials }}
| 分辨率（模型输入） | 224×224 或 336×336 | resize后送入VLM |
| 帧率 | 30 Hz（采集）/ 5-10 Hz（模型消费） | 中间缓冲队列解耦 |
| 色彩空间 | RGB（非BGR） | 注意OpenCV默认BGR需转换 |
| 归一化 | [0,1] float32 或 ImageNet均值/方差 | 依模型backbone而定 |

### 多视角配置

标准双目（Wrist + Base）配置：

```
base_camera:   固定于机器人底座或场景，提供全局视角
wrist_camera:  固定于末端执行器，提供操作特写视角
```

两路图像在时间戳上必须对齐（±5ms容差）。对齐方法见 {{Training_Data_Pipeline}} 中的同步策略。

---

## 本体感知传感器

### 关节编码器
- 输出：当前关节角度向量 `q ∈ R^7`，单位 radians
- 频率：500 Hz（底层）→ 降采样至模型输入频率
- 用途：作为状态观测 `s_t` 送入模型（部分架构需要）

### 末端执行器力矩传感器（可选）
- 输出：`[Fx, Fy, Fz, Tx, Ty, Tz]`，单位 N / Nm
- 用途：接触检测、顺应控制
- 注意：是否使用力矩信息影响 {{Action_Space_Definition}} 中的混合控制策略

---

## 数据流架构

```
[摄像头] --30Hz--> [帧缓冲] --5Hz--> [VLA模型推理]
[关节编码器] --500Hz--> [状态缓冲] --5Hz--> [VLA模型推理]
                                               |
                                        [动作输出]
                                               |
                              [安全过滤层 ← {{Safety_Constraints}}]
                                               |
                                        [底层控制器]
```

---

## 标定要求

手眼标定（Hand-Eye Calibration）是传感器接入的前置决策依赖：
- wrist_camera 相对于末端执行器的外参（`T_cam_to_ee`）
- 标定方法与频率：见 Robot_Hardware_Config（private）中的具体机器人参数

---

## 与本项目的关联依赖

- {{VLA_Fundamentals}} — 模型输入格式决定图像预处理标准
- {{Action_Space_Definition}} — 传感器帧率决定控制频率上限
- {{Training_Data_Pipeline}} — 数据采集必须遵循此规范保证训练-推理一致性
- {{Safety_Constraints}} — 传感器失效检测是安全层的触发条件之一
- {{Inference_Latency_Budget}} — 图像预处理延迟是总延迟预算的组成部分
