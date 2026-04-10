---
name: computer-vision-industrial-manufacturing-workflow-skill
description: Domain workflow skill for Computer Vision & Industrial Manufacturing. Use this skill when user requests tasks related to Feature Extraction for Defect Detection / HALCON Image Processing API / HALCON Project Structure & HDevelop / Image Quality Assessment / Image Segmentation Techniques / Industrial Camera Integration, or asks to reuse a proven workflow in this domain.
---

# Purpose
Capture a reusable execution workflow from validated knowledge/context, so repeated tasks are handled consistently.

## Trigger Conditions
- User asks for tasks in domain: Computer Vision & Industrial Manufacturing
- User intent includes: Feature Extraction for Defect Detection / HALCON Image Processing API / HALCON Project Structure & HDevelop / Image Quality Assessment / Image Segmentation Techniques / Industrial Camera Integration
- User asks for standardized or repeatable execution

## Input
- Task prompt from user
- Optional constraints (latency/safety/quality)
- Optional project-specific parameters

## Dependency Checklist
- [critical] Feature Extraction for Defect Detection: Extraction of relevant features (shape, size, texture, edges) to distinguish defects from normal surfaces
- [critical] HALCON Image Processing API: HALCON library functions, operators, and syntax for image acquisition, preprocessing, and analysis
- [helpful] HALCON Project Structure & HDevelop: Project organization, HDevelop IDE workflow, code modularization, and deployment procedures
- [helpful] Image Quality Assessment: Evaluation of image contrast, noise levels, and preprocessing requirements for reliable defect detection
- [critical] Image Segmentation Techniques: Methods for separating defect regions from background (thresholding, region growing, morphological operations)
- [critical] Industrial Camera Integration: Camera calibration, image acquisition protocols, lighting setup for magnetic material inspection
- [critical] Machine Learning Classification in HALCON: HALCON's deep learning and classical ML operators (SVM, neural networks) for defect classification
- [critical] Magnetic Material Surface Defect Types: Classification and characteristics of defects in magnetic materials (cracks, voids, surface irregularities, oxidation, contamination)
- [helpful] Performance Optimization for Real-time Processing: Algorithm optimization, parallel processing, and computational efficiency for production-line speed requirements

## Context Files
- Sensor_IO_Spec

## Execution Procedure
1. Parse task objective and constraints.
2. Verify dependency checklist and mark missing items.
3. Use context files first; avoid unsupported assumptions.
4. Produce result using concise, testable steps.
5. If critical dependency is missing, return fallback plan and request missing info.

## Output Format
Use this structure:
1) Summary
2) Key assumptions
3) Step-by-step plan
4) Risks and fallback
5) Next actions

## Failure Handling
- If required dependency is missing: stop and ask for missing knowledge.
- If confidence is low: provide conservative fallback and validation steps.
- If context conflicts: report conflict sources explicitly.

## Notes
- Derived from task:
  我要做一个磁性材料缺陷检测的模型 要求能在halcon上运行 给我构建project 基础

