---
name: yolov8-industrial-finetune
description: >
  Use this skill for defect detection and instance segmentation on industrial products — magnets, metal parts, PCBs, ceramics, plastics, or any manufactured component with surface defects. The default base model is YOLOv8n-seg. When input images are single-channel (grayscale) TIF files — common with industrial cameras and microscopes — this skill applies the correct first-layer weight adaptation: average the 3-channel pretrained weights across the channel dimension and use that to initialize a 1-channel input model, then fine-tune. This is better than training from scratch or naively converting the image to RGB. Trigger this skill when the user mentions: "defect detection", "surface inspection", "magnet", "metal part", "PCB inspection", "TIF images", "single channel", "grayscale industrial", "fine-tune YOLOv8", "1-channel input", "instance segmentation defects", "train on my dataset". Always prefer this over generic training advice for industrial inspection tasks.
---

# YOLOv8n-seg Industrial Defect Fine-Tuning

Opinionated, production-tested training pipeline for industrial defect detection and segmentation. Covers the full path from raw TIF dataset → trained model → deployment.

---

## Default Model Choice: YOLOv8n-seg

For simple industrial products (magnets, stamped metal, cast parts, PCBs):

| Factor | Why YOLOv8n-seg |
|--------|----------------|
| Speed | Nano = fastest inference, fits Jetson/edge |
| Accuracy | Sufficient for surface defects with good data |
| Segmentation | Mask output enables area measurement, not just bbox |
| Training data | Converges well with 200–2000 labeled images |
| Upgrade path | Easy to swap to YOLOv8s-seg / m-seg if accuracy insufficient |

**When to upgrade from nano:**
- mAP plateau below acceptable threshold after augmentation → try `yolov8s-seg`
- Defects are very small (< 8×8 px on 640 input) → try `yolov8m-seg` with SAHI
- Multiple complex defect classes (> 8 classes) → try `yolov8m-seg`

---

## Phase 1: Input Image Check

Before anything else, determine the image type:

```python
from PIL import Image
img = Image.open("sample.tif")
print(img.mode, img.size)  # e.g. "L 2048x2048" = grayscale, "RGB 1920x1080" = color
```

| Result | Action |
|--------|--------|
| `L` or `I;16` or `I` (1-channel grayscale) | → **Use grayscale fine-tune path (Phase 2A)** |
| `RGB` or `RGBA` (3-channel color) | → **Use standard fine-tune path (Phase 2B)** |
| 16-bit (`I;16`) | → Normalize to 8-bit first (see Phase 2A note) |

---

## Phase 2A: Grayscale Input — First-Layer Weight Averaging

**This is the key technique for 1-channel TIF inputs.**

### Why this works better than alternatives

| Approach | Problem |
|----------|---------|
| Convert gray→RGB (replicate channel 3×) | Works but wastes memory and compute — 3× the input data |
| Train from scratch with `in_channels=1` | Loses all ImageNet pretrained features — needs much more data |
| **Average pretrained first-layer weights** ✅ | Preserves all learned feature detectors, correct channel count, fast convergence |

### The Math

YOLOv8's first conv layer has weights of shape `[64, 3, 3, 3]` (64 filters, 3 input channels, 3×3 kernel).
Average across the channel dimension → `[64, 1, 3, 3]`.
This maps each grayscale pixel to the same feature space the model expects.

### Implementation

**Read `references/grayscale-finetune.md`** for the complete ready-to-run script.

Key steps the script performs:
1. Load `yolov8n-seg.pt` pretrained weights
2. Rebuild model with `ch=1` (1 input channel)
3. Extract first conv weights: `w = model.model[0].conv.weight.data`  (shape [64, 3, 3, 3])
4. Average: `w_gray = w.mean(dim=1, keepdim=True)`  (shape [64, 1, 3, 3])
5. Assign: `model.model[0].conv.weight.data = w_gray`
6. Save modified model → use as starting checkpoint for training
7. Train with `model.train(data=..., epochs=..., imgsz=640)`

### TIF 16-bit Normalization

If images are 16-bit (common with industrial cameras):
```python
import cv2, numpy as np
img16 = cv2.imread("sample.tif", cv2.IMREAD_UNCHANGED)  # uint16
img8  = cv2.normalize(img16, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
cv2.imwrite("sample_8bit.tif", img8)
```
Do this as a preprocessing step for the whole dataset before training.

---

## Phase 2B: Standard RGB Fine-Tune

For RGB images, standard Ultralytics fine-tune:

```python
from ultralytics import YOLO
model = YOLO("yolov8n-seg.pt")
model.train(
    data    = "data.yaml",
    epochs  = 150,
    imgsz   = 640,
    batch   = 16,
    lr0     = 0.01,
    lrf     = 0.01,
    warmup_epochs = 3,
    device  = 0,
    project = "runs/defect",
    name    = "yolov8n_seg_v1",
)
```

---

## Phase 3: Training Configuration

**Read `references/training-config.md`** for full hyperparameter guidance, augmentation settings, and dataset YAML templates.

### Key hyperparameters for industrial defects

| Parameter | Default | Industrial recommendation | Reason |
|-----------|---------|--------------------------|--------|
| `imgsz` | 640 | 640 or 1280 | Use 1280 if defects are small (< 20px) |
| `epochs` | 100 | 150–300 | Industrial datasets are usually small — need more epochs |
| `batch` | 16 | 8–16 (GPU VRAM dependent) | |
| `lr0` | 0.01 | 0.005–0.01 | Lower for small datasets to avoid overfitting |
| `lrf` | 0.01 | 0.001 | Cosine decay to very low LR |
| `mosaic` | 1.0 | 0.5–1.0 | Reduce if defects are positionally critical |
| `degrees` | 0.0 | 0–180 | Enable if defects are rotation-invariant |
| `fliplr` | 0.5 | 0.5 | Usually safe |
| `flipud` | 0.0 | 0.5 | Enable if top/bottom symmetric |
| `hsv_s` | 0.7 | 0.2 | Reduce — industrial images have controlled lighting |
| `hsv_v` | 0.4 | 0.3 | |
| `copy_paste` | 0.0 | 0.3–0.5 | Very effective for defect segmentation with few samples |
| `mixup` | 0.0 | 0.0 | Do NOT use — distorts defect appearance |

### Dataset size rules of thumb

| Images per class | Strategy |
|-----------------|----------|
| < 100 | Heavy augmentation + copy_paste; consider anomaly detection instead |
| 100–500 | Standard fine-tune with copy_paste=0.4 |
| 500–2000 | Standard fine-tune, reduce augmentation slightly |
| > 2000 | Can use larger model (yolov8s-seg) |

---

## Phase 4: Evaluation

```python
# After training
model = YOLO("runs/defect/yolov8n_seg_v1/weights/best.pt")
metrics = model.val(data="data.yaml", iou=0.5, conf=0.25)
print(metrics.seg.map)      # mAP50-95 for segmentation
print(metrics.seg.map50)    # mAP50
print(metrics.box.map50)    # bbox mAP50
```

**Target metrics for industrial inspection:**
- mAP50 > 0.85 → acceptable
- mAP50 > 0.92 → production-ready
- mAP50 < 0.75 → revisit data quality / add samples

**Per-class analysis matters more than overall mAP** for industrial use. A rare but critical defect class at 0.5 mAP is a problem even if overall mAP looks fine.

---

## Phase 5: Export for Deployment

```python
# TensorRT (NVIDIA GPU / Jetson)
model.export(format="engine", half=True, device=0)

# ONNX (cross-platform)
model.export(format="onnx", opset=12, simplify=True)

# TFLite (mobile/embedded)
model.export(format="tflite", int8=True)
```

---

## Reference Files

- `references/grayscale-finetune.md` — Complete script for first-layer weight averaging + grayscale training pipeline. **Read for any 1-channel / TIF input.**
- `references/training-config.md` — Full `data.yaml` template, hyperparameter file, augmentation presets, and multi-GPU setup. **Read before writing training code.**
