# Deployment Wrapper Templates

Complete inference wrappers with PROFILE switch that times every stage separately.
Select the template matching the user's hardware × format confirmed in Phase 1–2.

---

## Table of Contents
1. [Universal Profiling Timer (import into all templates)](#1-universal-profiling-timer)
2. [YOLOv8 — TensorRT FP16 (NVIDIA GPU)](#2-yolov8--tensorrt-fp16)
3. [YOLOv8 — ONNX Runtime (CPU)](#3-yolov8--onnx-runtime-cpu)
4. [YOLOv8 — PyTorch .pt (GPU / CPU)](#4-yolov8--pytorch-pt)
5. [Grayscale 1-channel → 3-channel Preprocessing Block](#5-grayscale-1ch--3ch-preprocessing)
6. [Benchmark Script](#6-benchmark-script)

---

## 1. Universal Profiling Timer

```python
# profiler.py — import this into every deployment wrapper
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Dict, List
import numpy as np


@dataclass
class StageTimer:
    """Accumulates timing for one named stage across multiple calls."""
    name:    str
    times_ms: List[float] = field(default_factory=list)

    def record(self, ms: float):
        self.times_ms.append(ms)

    @property
    def mean(self)  -> float: return float(np.mean(self.times_ms))   if self.times_ms else 0.0
    @property
    def p50(self)   -> float: return float(np.percentile(self.times_ms, 50))  if self.times_ms else 0.0
    @property
    def p95(self)   -> float: return float(np.percentile(self.times_ms, 95))  if self.times_ms else 0.0
    @property
    def p99(self)   -> float: return float(np.percentile(self.times_ms, 99))  if self.times_ms else 0.0
    @property
    def last(self)  -> float: return self.times_ms[-1] if self.times_ms else 0.0


class PipelineProfiler:
    """Tracks timing for all stages in the inference pipeline."""

    STAGES = [
        "img_read",        # disk read or memory decode
        "resize",          # resize to model input resolution
        "channel_convert", # gray→3ch or BGR→RGB etc.
        "normalize",       # pixel value normalization
        "to_tensor_gpu",   # numpy → tensor, CPU → GPU transfer
        "inference",       # pure model forward pass
        "nms_decode",      # NMS, bbox decode, softmax
        "mask_threshold",  # logit → binary 0/1 mask
        "rescale",         # model coords → original image coords
        "sort_filter",     # sort by conf, filter by area, etc.
    ]

    def __init__(self):
        self.timers: Dict[str, StageTimer] = {s: StageTimer(s) for s in self.STAGES}
        self._t0: float = 0.0
        self._stage: str = ""

    @contextmanager
    def measure(self, stage: str):
        """Context manager: with profiler.measure('inference'): ..."""
        t0 = time.perf_counter()
        yield
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if stage in self.timers:
            self.timers[stage].record(elapsed_ms)

    def report_last(self, latency_deadline_ms: float = None) -> str:
        """Print timing breakdown for the most recent call."""
        pre_stages  = ["img_read", "resize", "channel_convert", "normalize", "to_tensor_gpu"]
        post_stages = ["nms_decode", "mask_threshold", "rescale", "sort_filter"]

        pre_total  = sum(self.timers[s].last for s in pre_stages)
        infer_time = self.timers["inference"].last
        post_total = sum(self.timers[s].last for s in post_stages)
        total      = pre_total + infer_time + post_total

        lines = [
            "┌─────────────────────────────────────────────────────┐",
            "│  PROFILING BREAKDOWN (last call)                    │",
            "├─────────────────────────────────────────────────────┤",
        ]
        for s in pre_stages:
            t = self.timers[s].last
            if t > 0.01:
                lines.append(f"│  {s:<22} : {t:>7.2f} ms                 │")
        lines.append(f"│  {'PREPROCESSING':<22} : {pre_total:>7.2f} ms  total         │")
        lines.append("├─────────────────────────────────────────────────────┤")
        lines.append(f"│  {'INFERENCE':<22} : {infer_time:>7.2f} ms                 │")
        lines.append("├─────────────────────────────────────────────────────┤")
        for s in post_stages:
            t = self.timers[s].last
            if t > 0.01:
                lines.append(f"│  {s:<22} : {t:>7.2f} ms                 │")
        lines.append(f"│  {'POSTPROCESSING':<22} : {post_total:>7.2f} ms  total         │")
        lines.append("├─────────────────────────────────────────────────────┤")
        fps = 1000.0 / total if total > 0 else 0
        lines.append(f"│  {'TOTAL PIPELINE':<22} : {total:>7.2f} ms  ({fps:.1f} FPS)     │")
        if latency_deadline_ms:
            remaining = latency_deadline_ms - total
            status = "✅ OK " if remaining >= 0 else "❌ OVER"
            lines.append(f"│  Deadline: {latency_deadline_ms:.0f}ms  Remaining: {remaining:+.1f}ms  {status}      │")
        lines.append("└─────────────────────────────────────────────────────┘")
        return "\n".join(lines)

    def report_stats(self) -> str:
        """Print P50/P95/P99 summary after N runs."""
        lines = ["\n=== LATENCY STATISTICS (all runs) ===",
                 f"  {'Stage':<22}  {'Mean':>8}  {'P50':>8}  {'P95':>8}  {'P99':>8}  (ms)"]
        groups = {
            "--- Preprocessing ---": ["img_read","resize","channel_convert","normalize","to_tensor_gpu"],
            "--- Inference ---":     ["inference"],
            "--- Postprocessing ---":["nms_decode","mask_threshold","rescale","sort_filter"],
        }
        for header, stages in groups.items():
            lines.append(f"\n  {header}")
            for s in stages:
                t = self.timers[s]
                if t.times_ms:
                    lines.append(f"  {s:<22}  {t.mean:>8.2f}  {t.p50:>8.2f}  "
                                 f"{t.p95:>8.2f}  {t.p99:>8.2f}")
        return "\n".join(lines)
```

---

## 2. YOLOv8 — TensorRT FP16

```python
"""
deploy_trt.py — YOLOv8 deployment with TensorRT FP16 + full profiling
Hardware: NVIDIA GPU (server or Jetson Xavier/Orin)
Format: .engine (TensorRT)
Precision: FP16
"""

import cv2
import numpy as np
import torch
from pathlib import Path
from ultralytics import YOLO
from profiler import PipelineProfiler

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH          = "best.engine"          # TensorRT engine
INPUT_IS_GRAYSCALE  = True                   # True if source images are 1-channel
MODEL_INPUT_SIZE    = 640                    # model was trained at this imgsz
CONF_THRESHOLD      = 0.25
IOU_THRESHOLD       = 0.45
LATENCY_DEADLINE_MS = 33.0                   # e.g. 33ms = 30 FPS target
PROFILE             = True                   # ← set False in production
WARMUP_RUNS         = 5                      # GPU warmup before timing
TASK                = "segment"              # "detect" or "segment"
# ─────────────────────────────────────────────────────────────

model    = YOLO(MODEL_PATH)
profiler = PipelineProfiler()


def preprocess(image_path: str, orig_size: list) -> tuple:
    """
    Full preprocessing pipeline with per-stage timing.
    Returns (tensor_on_gpu, original_image).
    """
    # Stage 1: Read image
    with profiler.measure("img_read"):
        if isinstance(image_path, str):
            img_raw = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
            assert img_raw is not None, f"Cannot read: {image_path}"
        else:
            img_raw = image_path   # already numpy array (e.g. from camera)

    orig_size[:] = [img_raw.shape[1], img_raw.shape[0]]  # W, H

    # Stage 2: Resize
    with profiler.measure("resize"):
        img_resized = cv2.resize(
            img_raw, (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE),
            interpolation=cv2.INTER_LINEAR
        )

    # Stage 3: Channel conversion
    with profiler.measure("channel_convert"):
        if INPUT_IS_GRAYSCALE:
            if img_resized.ndim == 2:
                # 1-channel → 3-channel: stack the same channel 3 times
                img_3ch = cv2.cvtColor(img_resized, cv2.COLOR_GRAY2BGR)
            else:
                img_3ch = img_resized  # already 3ch
        else:
            # BGR → RGB (OpenCV default is BGR, model expects RGB)
            img_3ch = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB)

    # Stage 4: Normalize
    with profiler.measure("normalize"):
        # [0,255] uint8 → [0,1] float32
        img_norm = img_3ch.astype(np.float32) / 255.0
        # ImageNet normalization (required for pretrained backbone)
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_norm = (img_norm - mean) / std

    # Stage 5: To tensor + GPU
    with profiler.measure("to_tensor_gpu"):
        # HWC → CHW → add batch dim → GPU
        tensor = torch.from_numpy(img_norm).permute(2, 0, 1).unsqueeze(0)
        tensor = tensor.cuda().half()   # FP16 for TensorRT

    return tensor, img_raw


def postprocess(results, orig_w: int, orig_h: int) -> dict:
    """
    Full postprocessing pipeline with per-stage timing.
    Returns structured detection/segmentation output in original image coordinates.
    """
    scale_x = orig_w / MODEL_INPUT_SIZE
    scale_y = orig_h / MODEL_INPUT_SIZE

    # Stage 7: NMS + decode (Ultralytics handles this internally — measure the whole val call)
    with profiler.measure("nms_decode"):
        boxes      = results.boxes
        n          = len(boxes)
        detections = []
        if n > 0:
            xyxy   = boxes.xyxy.cpu().numpy()    # [N, 4] in model space
            confs  = boxes.conf.cpu().numpy()    # [N]
            clsids = boxes.cls.cpu().numpy().astype(int)  # [N]

    # Stage 8: Mask threshold (segmentation only)
    masks_binary = []
    with profiler.measure("mask_threshold"):
        if TASK == "segment" and results.masks is not None:
            for mask_tensor in results.masks.data:
                # mask_tensor: [H_model, W_model] float logits or probabilities
                mask_np = mask_tensor.cpu().numpy()
                # Threshold at 0.5 → binary 0/1 mask
                binary = (mask_np > 0.5).astype(np.uint8)
                masks_binary.append(binary)

    # Stage 9: Rescale to original image space
    with profiler.measure("rescale"):
        for i in range(n):
            x1, y1, x2, y2 = xyxy[i]
            # Scale bbox from model coords back to original image coords
            det = {
                "bbox_orig": [
                    int(x1 * scale_x), int(y1 * scale_y),
                    int(x2 * scale_x), int(y2 * scale_y),
                ],
                "confidence": float(confs[i]),
                "class_id":   int(clsids[i]),
            }
            if i < len(masks_binary):
                # Resize binary mask from model resolution to original resolution
                mask_orig = cv2.resize(
                    masks_binary[i], (orig_w, orig_h),
                    interpolation=cv2.INTER_NEAREST   # NEAREST preserves binary values
                )
                det["mask"] = mask_orig   # shape: [orig_H, orig_W], values: {0, 1}
            detections.append(det)

    # Stage 10: Sort and filter
    with profiler.measure("sort_filter"):
        # Sort by confidence descending
        detections.sort(key=lambda d: d["confidence"], reverse=True)
        # Filter by minimum confidence
        detections = [d for d in detections if d["confidence"] >= CONF_THRESHOLD]
        # Optional: filter by minimum bbox area
        min_area = 100   # pixels² in original image space — adjust per application
        detections = [
            d for d in detections
            if (d["bbox_orig"][2] - d["bbox_orig"][0]) *
               (d["bbox_orig"][3] - d["bbox_orig"][1]) >= min_area
        ]

    return {"detections": detections, "count": len(detections)}


def infer(image_path: str) -> dict:
    """Full pipeline: preprocess → infer → postprocess."""
    orig_size = [0, 0]

    tensor, img_raw = preprocess(image_path, orig_size)
    orig_w, orig_h  = orig_size

    # Stage 6: Pure inference
    with profiler.measure("inference"):
        with torch.no_grad():
            results = model(tensor, conf=CONF_THRESHOLD, iou=IOU_THRESHOLD, verbose=False)[0]

    output = postprocess(results, orig_w, orig_h)

    if PROFILE:
        print(profiler.report_last(LATENCY_DEADLINE_MS))

    return output


def warmup():
    """GPU warmup — first N calls are slower due to CUDA initialization."""
    import numpy as np
    dummy = np.zeros((640, 640, 3), dtype=np.uint8)
    print(f"Warming up ({WARMUP_RUNS} runs)...")
    for _ in range(WARMUP_RUNS):
        infer(dummy)
    # Reset profiler after warmup so warmup times don't pollute stats
    global profiler
    profiler = PipelineProfiler()
    print("Warmup done.\n")


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--image",  required=True)
    p.add_argument("--runs",   type=int, default=1)
    p.add_argument("--warmup", type=int, default=WARMUP_RUNS)
    args = p.parse_args()

    WARMUP_RUNS = args.warmup
    warmup()

    for i in range(args.runs):
        result = infer(args.image)
        print(f"Run {i+1}: {result['count']} detections")

    if args.runs > 1:
        print(profiler.report_stats())
```

---

## 3. YOLOv8 — ONNX Runtime (CPU)

```python
"""
deploy_onnx.py — YOLOv8 ONNX Runtime on CPU, with full profiling.
"""

import cv2, numpy as np
from pathlib import Path
import onnxruntime as ort
from profiler import PipelineProfiler

MODEL_PATH          = "best.onnx"
INPUT_IS_GRAYSCALE  = True
MODEL_INPUT_SIZE    = 640
CONF_THRESHOLD      = 0.25
IOU_THRESHOLD       = 0.45
LATENCY_DEADLINE_MS = 100.0      # CPU — more generous deadline
PROFILE             = True
TASK                = "segment"

# ONNX Runtime session — use CPU EP or CUDA EP if available
providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
session   = ort.InferenceSession(MODEL_PATH, providers=providers)
print("Using providers:", session.get_providers())
profiler  = PipelineProfiler()
input_name = session.get_inputs()[0].name


def preprocess(image_path: str, orig_size: list) -> np.ndarray:
    with profiler.measure("img_read"):
        img_raw = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
        assert img_raw is not None

    orig_size[:] = [img_raw.shape[1], img_raw.shape[0]]

    with profiler.measure("resize"):
        img_r = cv2.resize(img_raw, (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE))

    with profiler.measure("channel_convert"):
        if INPUT_IS_GRAYSCALE and img_r.ndim == 2:
            img_3ch = cv2.cvtColor(img_r, cv2.COLOR_GRAY2BGR)
        else:
            img_3ch = cv2.cvtColor(img_r, cv2.COLOR_BGR2RGB)

    with profiler.measure("normalize"):
        img_f = img_3ch.astype(np.float32) / 255.0

    with profiler.measure("to_tensor_gpu"):
        # CHW, batch=1, float32 (ONNX Runtime expects numpy)
        tensor = img_f.transpose(2, 0, 1)[np.newaxis, :]   # [1,3,H,W]

    return tensor, img_raw


def postprocess(outputs, orig_w, orig_h):
    scale_x = orig_w / MODEL_INPUT_SIZE
    scale_y = orig_h / MODEL_INPUT_SIZE

    with profiler.measure("nms_decode"):
        # YOLOv8 ONNX output: [1, 4+nc+masks, 8400] for seg, or [1, 4+nc, 8400] for det
        pred = outputs[0][0]   # [4+nc(+masks), 8400]
        pred = pred.T          # [8400, 4+nc...]
        nc = pred.shape[1] - 4
        boxes   = pred[:, :4]
        scores  = pred[:, 4:4+nc]
        conf    = scores.max(axis=1)
        cls_ids = scores.argmax(axis=1)
        mask    = conf >= CONF_THRESHOLD
        boxes, conf, cls_ids = boxes[mask], conf[mask], cls_ids[mask]
        # cx cy w h → x1 y1 x2 y2
        x1 = boxes[:, 0] - boxes[:, 2] / 2
        y1 = boxes[:, 1] - boxes[:, 3] / 2
        x2 = boxes[:, 0] + boxes[:, 2] / 2
        y2 = boxes[:, 1] + boxes[:, 3] / 2

    with profiler.measure("mask_threshold"):
        # For segmentation: outputs[1] contains mask prototypes
        # Simplified: skip mask for ONNX demo (full implementation per model)
        pass

    with profiler.measure("rescale"):
        detections = []
        for i in range(len(conf)):
            detections.append({
                "bbox_orig": [int(x1[i]*scale_x), int(y1[i]*scale_y),
                              int(x2[i]*scale_x), int(y2[i]*scale_y)],
                "confidence": float(conf[i]),
                "class_id":   int(cls_ids[i]),
            })

    with profiler.measure("sort_filter"):
        detections.sort(key=lambda d: d["confidence"], reverse=True)

    return {"detections": detections, "count": len(detections)}


def infer(image_path: str) -> dict:
    orig_size = [0, 0]
    tensor, img_raw = preprocess(image_path, orig_size)
    orig_w, orig_h  = orig_size

    with profiler.measure("inference"):
        outputs = session.run(None, {input_name: tensor})

    result = postprocess(outputs, orig_w, orig_h)
    if PROFILE:
        print(profiler.report_last(LATENCY_DEADLINE_MS))
    return result
```

---

## 5. Grayscale 1ch → 3ch Preprocessing Block

Reusable function for any wrapper when `INPUT_IS_GRAYSCALE=True`:

```python
def convert_gray_to_3ch(img: np.ndarray, method: str = "replicate") -> np.ndarray:
    """
    Convert 1-channel grayscale image to 3-channel for models expecting RGB input.

    Methods:
      "replicate" — stack same channel 3 times: [G, G, G]
                    Use when: model trained on grayscale-as-RGB input
      "bgr2rgb"   — cv2 COLOR_GRAY2BGR then COLOR_BGR2RGB
                    Equivalent to replicate but via OpenCV
      "clahe"     — apply CLAHE contrast enhancement, then replicate
                    Use when: image contrast is very low

    Args:
        img: [H, W] uint8 grayscale OR [H, W, 1]
        method: "replicate", "bgr2rgb", or "clahe"
    Returns:
        [H, W, 3] uint8
    """
    if img.ndim == 3 and img.shape[2] == 1:
        img = img[:, :, 0]

    if method == "replicate":
        return np.stack([img, img, img], axis=2)

    elif method == "bgr2rgb":
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    elif method == "clahe":
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(img)
        return np.stack([enhanced, enhanced, enhanced], axis=2)

    else:
        raise ValueError(f"Unknown method: {method}")
```

---

## 6. Benchmark Script

```python
"""
benchmark.py — run N inference calls, report full latency statistics
"""
import argparse, time
from pathlib import Path
from profiler import PipelineProfiler

def benchmark(infer_fn, image_paths, runs: int, warmup: int,
              deadline_ms: float, profiler: PipelineProfiler):
    print(f"Warmup: {warmup} runs...")
    for p in (image_paths * (warmup // len(image_paths) + 1))[:warmup]:
        infer_fn(str(p))
    profiler.timers  # reset after warmup
    global_profiler = PipelineProfiler()

    print(f"Benchmarking: {runs} runs...")
    total_times = []
    for i, p in enumerate((image_paths * (runs // len(image_paths) + 1))[:runs]):
        t0 = time.perf_counter()
        infer_fn(str(p))
        total_times.append((time.perf_counter() - t0) * 1000)

    import numpy as np
    print("\n=== BENCHMARK RESULTS ===")
    print(f"  Runs          : {runs}")
    print(f"  Mean total    : {np.mean(total_times):.2f} ms")
    print(f"  P50           : {np.percentile(total_times,50):.2f} ms")
    print(f"  P95           : {np.percentile(total_times,95):.2f} ms")
    print(f"  P99           : {np.percentile(total_times,99):.2f} ms")
    print(f"  FPS (mean)    : {1000/np.mean(total_times):.1f}")
    print(f"  FPS (P95)     : {1000/np.percentile(total_times,95):.1f}")
    if deadline_ms:
        pct_over = 100 * sum(t > deadline_ms for t in total_times) / runs
        status   = "✅" if pct_over < 5 else "❌"
        print(f"  Deadline {deadline_ms:.0f}ms : {pct_over:.1f}% over  {status}")
    print(profiler.report_stats())

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--model",    required=True)
    p.add_argument("--images",   required=True)
    p.add_argument("--runs",     type=int,   default=100)
    p.add_argument("--warmup",   type=int,   default=10)
    p.add_argument("--deadline", type=float, default=33.0)
    args = p.parse_args()

    img_paths = list(Path(args.images).rglob("*.png")) + \
                list(Path(args.images).rglob("*.tif"))
    assert img_paths, f"No images found in {args.images}"

    # Import the right infer function based on model extension
    ext = Path(args.model).suffix
    if ext == ".engine":
        from deploy_trt import infer, profiler
    elif ext == ".onnx":
        from deploy_onnx import infer, profiler
    else:
        from deploy_pt import infer, profiler

    benchmark(infer, img_paths, args.runs, args.warmup, args.deadline, profiler)
```
