# Grayscale Fine-Tune: First-Layer Weight Averaging

Complete, ready-to-run pipeline for training YOLOv8n-seg on 1-channel grayscale TIF images.

---

## Step 0: Install & Verify

```bash
pip install ultralytics opencv-python pillow numpy tqdm --break-system-packages
```

```python
# Quick sanity check on your TIF files
import cv2
from pathlib import Path

sample_tifs = list(Path("your_image_dir").rglob("*.tif"))[:5]
for f in sample_tifs:
    img = cv2.imread(str(f), cv2.IMREAD_UNCHANGED)
    print(f.name, img.dtype, img.shape)
# Expect e.g.: 000001.tif uint16 (2048, 2048) or uint8 (640, 640)
```

---

## Step 1: Preprocess TIF Dataset (16-bit → 8-bit)

Skip this step if your TIFs are already uint8.

```python
"""
Normalize 16-bit grayscale TIF images to 8-bit.
Writes output to <source_dir>_8bit/ preserving folder structure.
"""
import cv2
import numpy as np
from pathlib import Path
from tqdm import tqdm

SOURCE_DIR = Path("your_dataset/images")   # ← edit
OUTPUT_DIR = Path("your_dataset/images_8bit")

img_files = list(SOURCE_DIR.rglob("*.tif")) + list(SOURCE_DIR.rglob("*.tiff"))
print(f"Found {len(img_files)} TIF files")

for src in tqdm(img_files):
    img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"  ⚠ Cannot read {src}"); continue

    if img.dtype == np.uint16:
        img8 = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    elif img.dtype == np.uint8:
        img8 = img
    else:
        img8 = cv2.normalize(img.astype(np.float32), None, 0, 255,
                              cv2.NORM_MINMAX).astype(np.uint8)

    rel = src.relative_to(SOURCE_DIR)
    out = OUTPUT_DIR / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img8)

print(f"✅ 8-bit TIFs written to {OUTPUT_DIR}")
```

---

## Step 2: Adapt YOLOv8n-seg First Layer for 1-Channel Input

This is the core technique. Run once to produce a `yolov8n_seg_gray.pt` checkpoint.

```python
"""
Adapt YOLOv8n-seg pretrained weights for 1-channel grayscale input.

What this does:
  - Original first conv: weight shape [64, 3, 3, 3]  (64 filters, 3 in_ch, 3×3 kernel)
  - We average across in_ch dimension → [64, 1, 3, 3]
  - This preserves all 64 learned feature detectors while accepting 1-channel input
  - Result: fast convergence, no loss of pretrained knowledge

Output: yolov8n_seg_gray.pt  (use as --weights or model= in training)
"""

import torch
import yaml
from pathlib import Path
from ultralytics import YOLO
from ultralytics.nn.tasks import SegmentationModel
from copy import deepcopy

OUTPUT_PATH = Path("yolov8n_seg_gray.pt")

# ── Step A: Load pretrained model and extract state dict ──
print("Loading yolov8n-seg.pt pretrained weights...")
base = YOLO("yolov8n-seg.pt")
state_dict = deepcopy(base.model.state_dict())

# ── Step B: Find first conv weight and inspect ──
first_conv_key = "model.0.conv.weight"
w3 = state_dict[first_conv_key]
print(f"  Original first conv weight shape: {w3.shape}")  # [64, 3, 3, 3]
assert w3.shape[1] == 3, f"Expected 3 input channels, got {w3.shape[1]}"

# ── Step C: Average across channel dimension ──
# mean(dim=1, keepdim=True) → [64, 1, 3, 3]
w1 = w3.mean(dim=1, keepdim=True)
print(f"  Averaged gray weight shape:       {w1.shape}")  # [64, 1, 3, 3]

# ── Step D: Build new model config with ch=1 ──
# Read the YOLOv8n-seg architecture YAML and patch channels
import ultralytics
yolo_dir = Path(ultralytics.__file__).parent
cfg_path  = yolo_dir / "cfg" / "models" / "v8" / "yolov8n-seg.yaml"
with open(cfg_path) as f:
    cfg = yaml.safe_load(f)

# Patch input channels to 1
cfg_patched = deepcopy(cfg)
cfg_patched["ch"] = 1

# Build new model with 1-channel input
print("Building 1-channel model...")
new_model = SegmentationModel(cfg_patched, ch=1, nc=cfg["nc"])

# ── Step E: Load all weights except first conv, then assign averaged weight ──
new_state = new_model.state_dict()
loaded = 0; skipped = 0
for k, v in state_dict.items():
    if k == first_conv_key:
        new_state[k] = w1          # ← averaged gray weight
        print(f"  ✅ Assigned averaged weight to {k}")
        loaded += 1
    elif k in new_state and new_state[k].shape == v.shape:
        new_state[k] = v
        loaded += 1
    else:
        skipped += 1

new_model.load_state_dict(new_state, strict=False)
print(f"  Weights loaded: {loaded}, skipped (shape mismatch): {skipped}")

# ── Step F: Save as a YOLO-compatible checkpoint ──
ckpt = {
    "model": new_model,
    "train_args": {"ch": 1},
    "epoch": -1,
    "optimizer": None,
    "best_fitness": None,
    "ema": None,
    "updates": 0,
}
torch.save(ckpt, OUTPUT_PATH)
print(f"\n✅ Saved: {OUTPUT_PATH}")
print(f"   Use this as your starting weights in training.")
```

---

## Step 3: Prepare data.yaml

```yaml
# data.yaml — edit paths and class names
path: /home/user/my_dataset        # absolute path to dataset root
train: images/train
val:   images/val
test:  images/test                 # optional

nc: 3                              # number of defect classes
names:
  0: scratch
  1: dent
  2: crack
  # add your actual class names here
```

Labels must be in YOLO segmentation format (`.txt` files alongside images):
```
# One line per instance: class_id x1 y1 x2 y2 ... (normalized polygon)
0 0.512 0.334 0.521 0.341 0.518 0.352 0.509 0.344
```

---

## Step 4: Train with the Adapted Weights

```python
"""
Fine-tune YOLOv8n-seg on grayscale industrial defect dataset.
Uses the weight-averaged checkpoint from Step 2.
"""

from ultralytics import YOLO

# Load the adapted 1-channel checkpoint
model = YOLO("yolov8n_seg_gray.pt")

results = model.train(
    data    = "data.yaml",          # ← your data.yaml from Step 3
    epochs  = 200,
    imgsz   = 640,
    batch   = 16,                   # reduce to 8 if OOM
    device  = 0,                    # GPU index; "cpu" for CPU-only

    # Learning rate — lower for small industrial datasets
    lr0     = 0.005,
    lrf     = 0.001,
    warmup_epochs = 5,

    # Augmentation — tuned for industrial inspection
    mosaic      = 0.8,
    copy_paste  = 0.4,              # paste defect instances onto clean backgrounds
    degrees     = 180.0,            # magnets/metal parts are rotation-invariant
    fliplr      = 0.5,
    flipud      = 0.5,
    hsv_s       = 0.1,              # grayscale — saturation irrelevant
    hsv_v       = 0.2,              # small lighting variation
    hsv_h       = 0.0,              # grayscale — hue irrelevant
    mixup       = 0.0,              # NEVER use mixup for defect detection

    # Save & logging
    project = "runs/defect",
    name    = "yolov8n_seg_gray_v1",
    save    = True,
    plots   = True,
    verbose = True,
)

print(f"Best weights: {results.save_dir}/weights/best.pt")
```

---

## Step 5: Validate and Inspect Results

```python
from ultralytics import YOLO

model   = YOLO("runs/defect/yolov8n_seg_gray_v1/weights/best.pt")
metrics = model.val(data="data.yaml", conf=0.25, iou=0.5, plots=True)

print("\n=== Segmentation Metrics ===")
print(f"  mAP50      : {metrics.seg.map50:.4f}")
print(f"  mAP50-95   : {metrics.seg.map:.4f}")
print(f"  Precision  : {metrics.seg.mp:.4f}")
print(f"  Recall     : {metrics.seg.mr:.4f}")

print("\n=== Per-Class Breakdown ===")
for i, (name, ap50) in enumerate(zip(metrics.names.values(), metrics.seg.ap50)):
    flag = " ⚠ LOW" if ap50 < 0.75 else ""
    print(f"  {name:20s}: mAP50={ap50:.4f}{flag}")
```

---

## Step 6: Run Inference on a TIF File

```python
import cv2
import numpy as np
from ultralytics import YOLO

model = YOLO("runs/defect/yolov8n_seg_gray_v1/weights/best.pt")

def infer_tif(tif_path: str, conf: float = 0.25):
    img = cv2.imread(tif_path, cv2.IMREAD_UNCHANGED)
    if img.dtype == np.uint16:
        img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    # Model expects grayscale — do NOT convert to BGR
    results = model(img, conf=conf, verbose=False)[0]
    return results

results = infer_tif("test_sample.tif")
print(f"Detections: {len(results.boxes)}")
for box in results.boxes:
    print(f"  class={int(box.cls)}, conf={float(box.conf):.3f}, "
          f"bbox={list(map(int, box.xyxy[0].tolist()))}")
```

---

## Quick-Reference: When Weight Averaging Fails

If training does not converge (loss stays high, mAP < 0.3 after 50 epochs):

1. **Check image normalization** — verify 8-bit conversion is correct (histogram should spread 0–255)
2. **Check label files** — run `model.val()` on train set first; if mAP is also low, labels are wrong
3. **Reduce LR** — try `lr0=0.001`
4. **Increase warmup** — try `warmup_epochs=10`
5. **Fallback** — convert images to 3-channel RGB (replicate gray channel) and use standard `yolov8n-seg.pt`
