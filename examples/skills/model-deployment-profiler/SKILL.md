---
name: model-deployment-profiler
description: >
  Use this skill whenever deploying a trained model to production. This skill clarifies hardware environment (CUDA GPU, TensorRT, Jetson, CPU-only), model format (PT, ONNX, TensorRT engine, TFLite), precision (FP32, FP16, INT8), and inference speed requirements (FPS target, latency deadline in ms). It then generates a deployment wrapper with a profiling switch that breaks down timing into: preprocessing (image read, resize, channel conversion, normalization), inference, and postprocessing (mask binarization, coordinate rescaling, result sorting, confidence filtering). Trigger when the user says: "deploy the model", "run in production", "inference speed", "TensorRT", "ONNX", "FP16", "how fast is the model", "latency requirement", "preprocessing time", "postprocessing time", "timing breakdown", "benchmark inference", or when asking about running a model on specific hardware.
---

# Model Deployment Profiler

Clarifies hardware, format, precision, and speed requirements — then generates a
deployment wrapper with a `PROFILE=True` switch that times every stage separately.

---

## Phase 1: Clarify Deployment Requirements

**Always ask these questions before writing any deployment code.**
Never assume hardware or format — the wrong combination silently degrades performance.

### 1A — Hardware Environment

Ask the user:

```
1. What hardware will run inference?
   □ NVIDIA GPU (desktop/server) — which model? (RTX 3090, A100, etc.)
   □ NVIDIA Jetson (edge)        — which model? (Nano, Xavier NX, Orin)
   □ CPU only                    — which CPU / how many cores?
   □ AMD GPU
   □ Apple Silicon (M1/M2/M3)
   □ Intel integrated / Arc GPU
   □ Mobile (Android / iOS)

2. Is CUDA available and installed?
   Run: python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"

3. Is TensorRT installed? (NVIDIA only)
   Run: python -c "import tensorrt; print(tensorrt.__version__)"

4. What OS? (Windows / Linux / embedded Linux)
```

### 1B — Model Format

Ask:
```
What format is your model in?
   □ .pt  — PyTorch weights (most flexible, CPU/GPU, slowest)
   □ .onnx — ONNX (cross-platform, good for OpenCV DNN, ONNX Runtime)
   □ .engine — TensorRT engine (fastest on NVIDIA, hardware-locked)
   □ .tflite — TensorFlow Lite (mobile/embedded)
   □ .mlmodel — CoreML (Apple Silicon / iOS)

If .pt: do you want to export to a faster format for production?
```

### 1C — Precision

```
What numerical precision should inference use?
   □ FP32 — full precision (slowest, most accurate, safe default)
   □ FP16 — half precision (2× faster on NVIDIA, minimal accuracy loss, recommended)
   □ INT8 — integer quantization (4× faster, needs calibration dataset, check accuracy)

Note:
  FP16 requires: NVIDIA GPU with compute capability ≥ 6.0 (Pascal and newer)
  INT8 requires: calibration on ~500 representative images
  Jetson: FP16 is strongly recommended (hardware-optimized)
```

### 1D — Inference Speed Requirements

```
What is your latency / throughput requirement?

   Latency deadline:  ___ ms per image  (e.g. 50ms = 20 FPS)
   Throughput target: ___ FPS           (e.g. 30 FPS for real-time video)
   Batch size:        ___ images at once (1 = online, >1 = batch processing)

Common targets:
   Real-time video streaming : ≤ 33ms total (30 FPS)
   Inline production inspection: ≤ 100ms total
   Offline batch processing  : no strict deadline
   Robotics / safety system  : ≤ 16ms (60 FPS)
```

### 1E — Pipeline Details

```
Describe your full inference pipeline:

Preprocessing:
  □ Read image from disk (file path) or receive from socket/camera?
  □ Input: grayscale (1-channel) or RGB (3-channel)?
  □ Does the model expect 3-channel input even if source is grayscale?
    (1ch → 3ch conversion: replicate or stack?)
  □ Resize to what resolution? (e.g. 640×640)
  □ Normalization: ImageNet stats? [0,1]? [-1,1]? Custom?

Postprocessing:
  □ Detection: NMS threshold? confidence threshold?
  □ Segmentation: threshold mask at 0.5? rescale back to original resolution?
  □ Need to map coordinates from model space back to original image space?
  □ Sort results by confidence? by position? by class?
  □ Any domain-specific postprocessing? (e.g. filter by minimum area, merge overlapping masks)
```

---

## Phase 2: Hardware → Format → Precision Decision Matrix

After collecting answers, recommend the optimal combination:

**Read `references/hardware-matrix.md`** for the full decision table.

Quick guide:

| Hardware | Recommended Format | Precision | Expected speedup vs PT/FP32 |
|----------|-------------------|-----------|----------------------------|
| NVIDIA GPU (server) | TensorRT `.engine` | FP16 | 3–5× |
| NVIDIA Jetson Nano | TensorRT `.engine` | FP16 | 4–6× |
| NVIDIA Jetson Orin | TensorRT `.engine` | FP16/INT8 | 5–8× |
| CPU (x86 Intel/AMD) | ONNX Runtime | FP32 | 1.5–2× vs PT |
| Apple M1/M2 | CoreML or ONNX | FP16 | 2–3× |
| Any (cross-platform) | ONNX Runtime | FP32 | portable |

---

## Phase 3: Export the Model

**Read `references/export-guide.md`** for exact export commands per format.

Always verify the exported model before deploying:
```bash
# After export — sanity check
python verify_export.py --model model.onnx --input test_image.png
```

---

## Phase 4: Generate Deployment Wrapper with Profiler

**Read `references/deployment-wrapper.md`** for complete wrapper templates.

Every wrapper includes a `PROFILE` mode that times:

```
┌─────────────────────────────────────────────────────┐
│  PROFILING BREAKDOWN  (PROFILE=True)                │
├─────────────────────────────────────────────────────┤
│  1. Image Read          :   2.1 ms                  │
│  2. Resize              :   0.8 ms                  │
│  3. Channel Convert     :   0.3 ms   (gray→3ch)     │
│  4. Normalize           :   0.2 ms                  │
│  5. To Tensor / GPU     :   0.4 ms                  │
│  ─────────────────────────────────────────────────  │
│  PREPROCESSING TOTAL    :   3.8 ms                  │
├─────────────────────────────────────────────────────┤
│  6. Model Inference     :  12.4 ms   ← GPU time     │
├─────────────────────────────────────────────────────┤
│  7. NMS / Decode        :   1.2 ms                  │
│  8. Mask Threshold      :   0.3 ms   (logit→0/1)    │
│  9. Rescale to Orig     :   0.4 ms                  │
│ 10. Sort / Filter       :   0.1 ms                  │
│  ─────────────────────────────────────────────────  │
│  POSTPROCESSING TOTAL   :   2.0 ms                  │
├─────────────────────────────────────────────────────┤
│  TOTAL PIPELINE         :  18.2 ms   (55 FPS)       │
│  Latency budget         :  33.0 ms   (30 FPS target)│
│  Budget remaining       :  14.8 ms   ✅ OK          │
└─────────────────────────────────────────────────────┘
```

Available wrapper templates:
| Template | Use for |
|----------|---------|
| `yolov8-trt-fp16` | YOLOv8 det/seg, TensorRT FP16, NVIDIA GPU |
| `yolov8-onnx-cpu` | YOLOv8 det/seg, ONNX Runtime, CPU |
| `yolov8-pt-gpu` | YOLOv8 det/seg, PyTorch .pt, CUDA |
| `grayscale-1ch-to-3ch` | Any model needing channel conversion |
| `jetson-trt` | Jetson-specific TensorRT wrapper |

---

## Phase 5: Benchmark and Report

After deploying, always run the benchmark script:

```bash
python benchmark.py \
    --model model.engine \
    --images test_images/ \
    --runs 100 \
    --warmup 10 \
    --profile
```

Produces:
- Mean / P50 / P95 / P99 latency per stage
- FPS achieved vs target
- GPU memory usage
- ✅ / ❌ vs the latency deadline specified in Phase 1

---

## Interaction Style

- After Phase 1, **summarize the confirmed requirements** back to the user before writing any code.
- If the user doesn't know TensorRT version: provide the detection command and wait for their output.
- If latency target is tighter than physically possible for the hardware: say so clearly with an estimated achievable FPS and suggest options (INT8, smaller model, reduced imgsz).
- Always generate BOTH the `PROFILE=True` and `PROFILE=False` paths — profiling adds overhead and should be off in production.

---

## Reference Files

- `references/hardware-matrix.md` — Full hardware × format × precision decision table with expected latency numbers. **Read in Phase 2.**
- `references/export-guide.md` — Exact export commands for TensorRT, ONNX, TFLite, CoreML with verification steps. **Read in Phase 3.**
- `references/deployment-wrapper.md` — Complete deployment wrapper templates with profiling for all hardware/format combinations. **Read in Phase 4.**
