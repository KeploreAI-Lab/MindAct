# Hardware Matrix & Export Guide

---

## Hardware × Format × Precision Decision Table

| Hardware | CUDA | TRT | Best Format | Precision | Est. YOLOv8n latency |
|----------|------|-----|-------------|-----------|----------------------|
| RTX 3090 / 4090 | ✅ | ✅ | `.engine` TRT | FP16 | 3–6 ms |
| RTX 3060 / 3070 | ✅ | ✅ | `.engine` TRT | FP16 | 6–12 ms |
| Tesla T4 / A10 | ✅ | ✅ | `.engine` TRT | FP16/INT8 | 5–10 ms |
| Jetson Orin NX | ✅ | ✅ | `.engine` TRT | FP16 | 15–25 ms |
| Jetson Xavier NX | ✅ | ✅ | `.engine` TRT | FP16 | 25–40 ms |
| Jetson Nano | ✅ | ✅ | `.engine` TRT | FP16 | 80–150 ms |
| CPU (Intel i7/i9) | ❌ | ❌ | `.onnx` ORT | FP32 | 80–150 ms |
| CPU (ARM, Raspberry Pi) | ❌ | ❌ | `.tflite` | INT8 | 500ms+ |
| Apple M1/M2 | ❌ | ❌ | `.mlmodel` CoreML | FP16 | 10–20 ms |
| Any (portable) | any | ❌ | `.onnx` ORT | FP32 | varies |

*Latency = pure inference on 640×640 input, not including pre/postprocessing.*

---

## Environment Detection Commands

Run these on the TARGET deployment machine, not the training machine:

```bash
# Python / PyTorch
python -c "
import sys, platform
print('Python :', sys.version)
print('OS     :', platform.platform())
try:
    import torch
    print('PyTorch:', torch.__version__)
    print('CUDA   :', torch.cuda.is_available())
    if torch.cuda.is_available():
        print('CUDA v :', torch.version.cuda)
        print('GPU    :', torch.cuda.get_device_name(0))
        print('VRAM   :', round(torch.cuda.get_device_properties(0).total_memory/1e9, 1), 'GB')
        print('Compute:', torch.cuda.get_device_capability(0))
except ImportError:
    print('PyTorch not installed')
"

# TensorRT
python -c "
try:
    import tensorrt as trt
    print('TensorRT:', trt.__version__)
except ImportError:
    print('TensorRT: NOT installed')
"

# ONNX Runtime
python -c "
try:
    import onnxruntime as ort
    print('ORT version:', ort.__version__)
    print('Providers  :', ort.get_available_providers())
except ImportError:
    print('ONNX Runtime: NOT installed')
"

# Jetson-specific
python -c "
import subprocess
r = subprocess.run(['cat','/etc/nv_tegra_release'], capture_output=True, text=True)
if r.returncode == 0:
    print('Jetson detected:', r.stdout.strip())
else:
    print('Not a Jetson device')
"
```

---

## Export Guide

### Export to TensorRT FP16 (NVIDIA GPU / Jetson)

```python
from ultralytics import YOLO

model = YOLO("best.pt")

# Export — run this on the SAME machine that will do inference
# TensorRT engines are hardware-locked (cannot move between GPU models)
model.export(
    format   = "engine",
    half     = True,       # FP16
    device   = 0,
    imgsz    = 640,
    simplify = True,
    workspace= 4,          # GB of GPU memory for TRT build (increase if OOM)
    verbose  = False,
)
# Output: best.engine
```

**Jetson-specific flags:**
```python
model.export(
    format    = "engine",
    half      = True,
    device    = 0,
    imgsz     = 640,
    workspace = 2,         # Jetson has less VRAM — use 2 GB
)
```

### Export to ONNX (CPU / cross-platform)

```python
model.export(
    format   = "onnx",
    opset    = 12,         # opset 12 = broad compatibility
    simplify = True,       # simplify graph — always do this
    dynamic  = False,      # False = fixed batch/imgsz = faster
    imgsz    = 640,
)
# Output: best.onnx

# Verify export
import onnx
m = onnx.load("best.onnx")
onnx.checker.check_model(m)
print("ONNX model OK — inputs:", [i.name for i in m.graph.input])
```

### Export to TFLite INT8 (mobile / Raspberry Pi)

```python
# INT8 requires a calibration dataset (representative images)
model.export(
    format  = "tflite",
    int8    = True,
    data    = "data.yaml",   # used for INT8 calibration
    imgsz   = 320,           # reduce for mobile
)
```

### Export to CoreML (Apple Silicon / iOS)

```python
model.export(
    format = "coreml",
    imgsz  = 640,
    half   = True,    # FP16 on Apple Silicon
    nms    = True,    # include NMS in the CoreML model
)
```

---

## Post-Export Verification

Always run this before deploying to production:

```python
"""verify_export.py — confirm exported model produces same results as .pt"""
import argparse
import numpy as np
import cv2
from ultralytics import YOLO

def verify(pt_path, export_path, test_image, threshold=0.05):
    img = cv2.imread(test_image)
    assert img is not None, f"Cannot read {test_image}"

    model_pt  = YOLO(pt_path)
    model_exp = YOLO(export_path)

    r_pt  = model_pt (img, verbose=False)[0]
    r_exp = model_exp(img, verbose=False)[0]

    n_pt  = len(r_pt.boxes)
    n_exp = len(r_exp.boxes)

    print(f"PT model   : {n_pt} detections")
    print(f"Exported   : {n_exp} detections")

    if n_pt == 0 and n_exp == 0:
        print("✅ Both models: no detections (consistent)")
        return

    if n_pt > 0 and n_exp > 0:
        conf_pt  = float(r_pt.boxes.conf.mean())
        conf_exp = float(r_exp.boxes.conf.mean())
        delta    = abs(conf_pt - conf_exp)
        print(f"Mean conf PT : {conf_pt:.4f}")
        print(f"Mean conf EXP: {conf_exp:.4f}")
        print(f"Conf delta   : {delta:.4f}  ({'✅ OK' if delta < threshold else '⚠ CHECK'})")
    else:
        print(f"⚠ Detection count mismatch: PT={n_pt} vs Exported={n_exp}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--pt",     required=True)
    p.add_argument("--model",  required=True)
    p.add_argument("--image",  required=True)
    args = p.parse_args()
    verify(args.pt, args.model, args.image)
```

```bash
python verify_export.py --pt best.pt --model best.engine --image test.png
```

---

## FP16 Compatibility Check

Before enabling FP16, verify GPU compute capability:

```python
import torch
if torch.cuda.is_available():
    cap = torch.cuda.get_device_capability(0)
    major, minor = cap
    if major >= 6:
        print(f"✅ FP16 supported (compute {major}.{minor})")
    else:
        print(f"❌ FP16 NOT supported (compute {major}.{minor} — need ≥ 6.0)")
        print("   Use FP32 instead")
```

Compute capability ≥ 6.0 (Pascal) → FP16 hardware support.
Compute capability ≥ 7.0 (Volta/Turing) → Tensor Cores, full FP16 speedup.
Jetson Nano = 5.3 → FP16 **not** natively supported (use FP32 or INT8).
Jetson Xavier = 7.2 → FP16 ✅.
Jetson Orin = 8.7 → FP16 + INT8 ✅.
