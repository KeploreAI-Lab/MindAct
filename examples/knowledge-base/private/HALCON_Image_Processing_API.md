# HALCON Image Processing API - 磁性材料缺陷检测项目基础

## 1. 项目概述

<!-- TODO: 填写项目名称、目标和应用场景 --> {{ Sensor_IO_Spec }}
- **项目名称**: 磁性材料缺陷检测系统
- **目标**: 使用HALCON实现自动化缺陷检测
- **应用场景**: 工业制造、质量控制
- **预期精度**: <!-- TODO: 定义缺陷检测的精度要求 -->

## 2. HALCON环境配置

### 2.1 系统要求
<!-- TODO: 列出HALCON版本、操作系统、硬件要求 -->
- HALCON版本: <!-- TODO: 指定版本号 (如 21.11, 22.05) -->
- 操作系统: <!-- TODO: Windows/Linux/macOS -->
- 内存需求: <!-- TODO: 最小内存配置 -->
- GPU支持: <!-- TODO: 是否需要GPU加速 -->

### 2.2 开发环境搭建
<!-- TODO: 详细说明HALCON IDE安装步骤 -->
```
1. 下载HALCON安装包
2. 运行安装程序
3. 配置许可证
4. 验证安装
```

### 2.3 项目目录结构
```
halcon_defect_detection/
├── src/
│   ├── main.hdev          <!-- TODO: 主程序入口 -->
│   ├── preprocessing.hdev  <!-- TODO: 图像预处理模块 -->
│   ├── detection.hdev      <!-- TODO: 缺陷检测核心算法 -->
│   └── postprocessing.hdev <!-- TODO: 后处理和结果输出 -->
├── data/
│   ├── training/          <!-- TODO: 训练数据集 -->
│   ├── testing/           <!-- TODO: 测试数据集 -->
│   └── models/            <!-- TODO: 保存的模型文件 -->
├── config/
│   └── parameters.hdev    <!-- TODO: 参数配置文件 -->
└── docs/
    └── README.md          <!-- TODO: 项目文档 -->
```

## 3. 图像采集与预处理

### 3.1 图像采集配置
<!-- TODO: 定义相机参数和采集设置 -->
- **相机类型**: <!-- TODO: 工业相机型号 -->
- **分辨率**: <!-- TODO: 图像分辨率 (如 1920x1080) -->
- **帧率**: <!-- TODO: 采集帧率 (FPS) -->
- **光源配置**: <!-- TODO: 照明方式 (如 同轴光、背光) -->
- **图像格式**: <!-- TODO: 输出格式 (如 Mono8, RGB) -->

### 3.2 预处理算法
<!-- TODO: 列出所需的预处理