# HALCON Project Structure & HDevelop - 磁性材料缺陷检测

## 1. 项目概述 {{ Inference_Latency_Budget }}

<!-- TODO: 填写项目基本信息
- 项目名称：磁性材料缺陷检测系统
- 应用领域：工业制造/质量检测
- 主要目标：自动化检测磁性材料表面缺陷
- 预期精度要求：填写具体指标（如缺陷识别率>95%）
-->

## 2. HALCON 项目结构设计

### 2.1 目录组织架构

```
MagneticDefectDetection/
├── hdevelop/
│   ├── main.hdev                    <!-- TODO: 主程序入口 -->
│   ├── procedures/                  <!-- TODO: 子程序库 -->
│   │   ├── image_preprocessing.hdev
│   │   ├── defect_detection.hdev
│   │   ├── feature_extraction.hdev
│   │   └── result_output.hdev
│   └── libraries/                   <!-- TODO: 外部库和工具函数 -->
│       └── utility_functions.hdev
├── images/                          <!-- TODO: 样本图像存储 -->
│   ├── training/
│   ├── testing/
│   └── reference/
├── models/                          <!-- TODO: 训练好的模型文件 -->
│   ├── defect_classifier.hdl
│   └── edge_detection_params.hdict
├── config/                          <!-- TODO: 配置文件 -->
│   └── parameters.hdict
├── output/                          <!-- TODO: 结果输出目录 -->
│   ├── detected_defects/
│   └── reports/
└── documentation/                   <!-- TODO: 文档 -->
    └── README.md
```

### 2.2 核心模块划分

<!-- TODO: 根据实际需求调整模块 -->

| 模块名称 | 文件名 | 主要功能 | 输入 | 输出 |
|---------|--------|---------|------|------|
| 图像预处理 | image_preprocessing.hdev | 灰度化、去噪、增强 | 原始图像 | 预处理图像 |
| 缺陷检测 | defect_detection.hdev | 边缘检测、区域分割 | 预处理图像 | 缺陷区域 |
| 特征提取 | feature_extraction.hdev | 形状、纹理、灰度特征 | 缺陷区域 | 特征向量 |
| 分类判断 | classification.hdev | 缺陷分类与评级 | 特征向量 | 缺陷类型/等级 |
| 结果输出 | result_output.hdev | 可视化、报告生成 | 检测结果 | 图像/报告 |

##