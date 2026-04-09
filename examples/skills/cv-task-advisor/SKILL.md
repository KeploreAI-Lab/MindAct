---
name: cv-task-advisor
description: >
  Use this skill whenever a user describes a computer vision problem, AI vision task, or image/video analysis need — even vaguely. This skill helps classify the task into the right CV category (object detection, instance segmentation, semantic segmentation, anomaly detection, image classification, pose estimation, OCR/text detection, or multi-object tracking), gather all necessary requirements through structured questions, and produce a recommended model/framework plus a project setup plan. Trigger this skill when the user mentions: detecting objects, counting items, finding defects, reading text in images, tracking movement, identifying poses, segmenting regions, inspecting products, recognizing scenes, or any phrasing like "I want to build a vision system", "I need to analyze images/video", "detect X in images", "find Y on a camera feed", etc. Do NOT wait for the user to use exact CV terminology — trigger early and help them figure out what they actually need.
---

# CV Task Advisor

A skill for understanding a user's computer vision need, classifying it into the correct task type, gathering all relevant requirements, and producing a concrete recommendation and project plan.

---

## Phase 1: Task Classification

When the user describes their problem, map it to one of these task types. Use the decision rules below to disambiguate.

### Task Types & Decision Rules

| Task | What it does | Key signals |
|------|-------------|-------------|
| **Object Detection** | Locates and labels objects with bounding boxes | "find where X is", "count objects", "draw boxes around" |
| **Instance Segmentation** | Detects objects AND produces pixel-level masks per instance | "separate each object", "exact shape/outline needed", "measure area of each" |
| **Semantic Segmentation** | Labels every pixel with a class (no instance separation) | "segment the road/sky/background", "map regions", scene understanding |
| **Anomaly Detection** | Identifies unusual or defective regions with few/no defect labels | "find defects", "quality inspection", "no defect samples to train on" |
| **Image Classification** | Assigns a single label to the whole image | "what category is this image", "is this X or Y", "sort images into folders" |
| **Pose Estimation** | Detects keypoints/skeleton of humans or objects | "body posture", "joint positions", "gesture recognition", "action analysis" |
| **OCR / Text Detection** | Finds and reads text in images | "read license plates", "extract text from documents/signs/labels" |
| **Multi-Object Tracking** | Tracks identities of objects across video frames | "follow the same person across frames", "trajectory", "re-identification" |

### Ambiguous Cases — How to Disambiguate

- **Detection vs. Instance Segmentation**: Ask if they need pixel-precise masks or bounding boxes are enough.
- **Anomaly Detection vs. Detection**: Ask if they have labeled defect examples. If very few or none → Anomaly Detection.
- **Classification vs. Detection**: Ask if there's one object per image or multiple objects to locate.
- **Tracking vs. Detection**: Ask if it's video and whether identity persistence across frames matters.

If still unclear after initial description, **state your best guess and ask one confirmation question** before moving to requirements.

---

## Phase 2: Requirements Gathering

Once the task type is confirmed (or narrowed to 2 options), ask the following requirement questions. **Group them naturally in conversation — don't dump all at once.** Prioritize the most task-relevant ones first.

### 2.1 Hardware Environment
- What hardware will this run on? (e.g., NVIDIA GPU with X GB VRAM, CPU-only server, Jetson Nano/Xavier, Raspberry Pi, mobile phone, cloud VM)
- Is the hardware already fixed, or can you recommend what to use?

### 2.2 Inference Speed / Latency
- Is this real-time (live video stream) or batch processing (process saved images/videos)?
- If real-time: what FPS target? (e.g., 10 FPS, 30 FPS)
- Is latency per-frame critical (e.g., robotics, safety systems)?

### 2.3 Dataset & Annotations
- Do you have a dataset? If yes: how many images/videos, and are they labeled?
- What annotation format do you have or plan to use? (COCO, YOLO, Pascal VOC, custom)
- For anomaly detection: do you have defect samples, or only normal samples?
- Is data collection / annotation still needed?

### 2.4 Accuracy vs. Speed Trade-off
- What matters more: highest possible accuracy, or fast/lightweight inference?
- Is there a minimum acceptable accuracy threshold (e.g., mAP > 0.85, F1 > 0.9)?

### 2.5 Deployment Environment
- Where will the model run in production? (cloud API, on-prem server, edge device, mobile app, browser)
- Any containerization or MLOps constraints? (Docker, Kubernetes, ONNX export required, TensorRT)

### 2.6 Open-source vs. Commercial
- Any preference or constraint on using open-source frameworks vs. commercial solutions?
- Budget considerations for cloud APIs (e.g., Roboflow, AWS Rekognition)?
- Any licensing restrictions (e.g., GPL-incompatible code can't be used)?

### Task-Specific Extra Questions

**Object Detection / Instance Segmentation:**
- How many object classes?
- Are objects small, occluded, or densely packed?

**Anomaly Detection:**
- What types of defects are expected? (surface scratches, shape deformation, color anomaly)
- Inline (real-time on production line) or offline inspection?

**OCR:**
- Is text printed or handwritten?
- Multiple languages or scripts?
- Fixed layout (forms) or arbitrary text locations?

**Tracking:**
- Indoors or outdoors? Single camera or multi-camera?
- Is re-identification across camera views needed?

**Pose Estimation:**
- Human pose or object/hand pose?
- 2D or 3D keypoints needed?

---

## Phase 3: Output — Recommendation & Project Plan

After gathering requirements, produce all three of the following.

### 3.1 Structured Summary

```
Task Type: <confirmed task type>
Input: <image / video / stream>
Classes / Targets: <what needs to be detected/classified>
Hardware: <device + specs>
Latency requirement: <real-time Xfps / batch>
Dataset: <size, labeled?, format>
Accuracy target: <metric + threshold if given>
Deployment: <where and how>
Constraints: <open-source only / budget / licensing>
```

### 3.2 Model / Framework Recommendation

Use the reference table in `references/model-recommendations.md` to select the best fit. Always give:
- **Primary recommendation** with justification
- **Alternative** if trade-offs exist (e.g., lighter model for edge)
- **What to avoid** and why

### 3.3 Project Setup Plan

Provide a concise roadmap:
1. **Data** — collection, annotation tool recommendation, format
2. **Environment** — framework install, GPU setup, Docker image if relevant
3. **Training** — baseline config, key hyperparameters to tune, transfer learning strategy
4. **Evaluation** — metrics to track, validation strategy
5. **Deployment** — export format (ONNX, TensorRT, TFLite), serving approach
6. **Estimated timeline** — rough week-by-week if dataset is ready

---

## Interaction Style

- Be conversational, not interrogating. Acknowledge what the user said before asking follow-ups.
- State your classification hypothesis early: *"This sounds like an anomaly detection problem — let me ask a few questions to confirm and understand your setup."*
- If the user is clearly an expert, compress the questions. If they seem less technical, explain terms briefly.
- Never ask more than 3–4 questions at a time.
- Summarize confirmed requirements back to the user before giving the final recommendation.

---

## Reference Files

- `references/model-recommendations.md` — Model/framework lookup table by task type and constraints. **Read this before writing the recommendation in Phase 3.**
