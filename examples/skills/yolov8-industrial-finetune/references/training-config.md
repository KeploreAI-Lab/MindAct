# Training Configuration Reference

Templates and guidance for YOLOv8n-seg industrial defect training.

---

## data.yaml Template

```yaml
# ── paths ────────────────────────────────────────────────────
path: /home/user/my_defect_dataset   # absolute root (or relative to where you run train)
train: images/train                  # relative to path
val:   images/val
test:  images/test                   # optional

# ── classes ──────────────────────────────────────────────────
nc: 2
names:
  0: scratch
  1: contamination
  # add all your defect class names here

# ── optional: per-class weights for imbalanced datasets ──────
# Not native YOLO — use cls_weights trick in custom trainer if needed
```

## Expected Directory Layout

```
my_defect_dataset/
├── images/
│   ├── train/    ← .png or .tif (8-bit) images
│   ├── val/
│   └── test/
└── labels/
    ├── train/    ← .txt files, same stem as images
    ├── val/
    └── test/
```

---

## Hyperparameter Presets by Dataset Size

### Tiny dataset (< 200 images per class)

```python
model.train(
    data         = "data.yaml",
    epochs       = 300,
    imgsz        = 640,
    batch        = 8,
    lr0          = 0.003,
    lrf          = 0.0005,
    warmup_epochs= 10,
    # Heavy augmentation to compensate
    mosaic       = 1.0,
    copy_paste   = 0.5,
    degrees      = 180.0,
    fliplr       = 0.5,
    flipud       = 0.5,
    scale        = 0.5,
    shear        = 5.0,
    perspective  = 0.0005,
    hsv_v        = 0.2,
    hsv_s        = 0.1,
    mixup        = 0.0,
    # Regularization
    dropout      = 0.1,
    weight_decay = 0.0005,
    # Patience
    patience     = 50,
)
```

### Standard dataset (200–1000 images per class)

```python
model.train(
    data         = "data.yaml",
    epochs       = 150,
    imgsz        = 640,
    batch        = 16,
    lr0          = 0.005,
    lrf          = 0.001,
    warmup_epochs= 5,
    mosaic       = 0.8,
    copy_paste   = 0.3,
    degrees      = 90.0,
    fliplr       = 0.5,
    flipud       = 0.5,
    scale        = 0.3,
    hsv_v        = 0.2,
    hsv_s        = 0.1,
    mixup        = 0.0,
    dropout      = 0.0,
    patience     = 30,
)
```

### Larger dataset (> 1000 images per class)

```python
model.train(
    data         = "data.yaml",
    epochs       = 100,
    imgsz        = 640,
    batch        = 32,
    lr0          = 0.01,
    lrf          = 0.01,
    warmup_epochs= 3,
    mosaic       = 0.5,
    copy_paste   = 0.1,
    degrees      = 45.0,
    fliplr       = 0.5,
    mixup        = 0.0,
    patience     = 20,
)
```

---

## Augmentation Decision Guide for Industrial Inspection

| Augmentation | Enable? | Notes |
|-------------|---------|-------|
| `degrees` | ✅ Yes (0–180) | Magnets, bolts, symmetric parts are rotation-invariant |
| `fliplr` | ✅ Yes | Almost always safe |
| `flipud` | ✅ Usually | Enable unless product has defined top/bottom |
| `copy_paste` | ✅ Yes (0.3–0.5) | Paste defect instances onto clean background — very effective |
| `mosaic` | ✅ Yes (0.5–1.0) | Helps generalize; reduce if context matters |
| `scale` | ✅ Yes (0.3–0.5) | Handles camera distance variation |
| `perspective` | ⚠ Small (< 0.001) | Only if camera angle varies |
| `mixup` | ❌ No | Blends images — destroys defect appearance |
| `hsv_h` | ❌ No for gray | Irrelevant for grayscale; small value for color |
| `hsv_s` | ⚠ Very small | Keep ≤ 0.1; industrial lighting is controlled |
| `hsv_v` | ⚠ Small (0.1–0.2) | Simulate lighting variation |
| `blur` | ⚠ Optional | Simulate focus variation: `blur=0.01` |
| `erasing` | ⚠ Optional | Simulate occlusion: `erasing=0.1` |

---

## Handling Class Imbalance

Common in industrial data: many "good" images, few of rare defect types.

### Option 1: Oversample rare classes in data.yaml splits

```python
# When creating train split, repeat rare class images
rare_class_images = [f for f in all_images if has_class(f, rare_class_id)]
train_images = common_images + rare_class_images * 3  # replicate 3×
```

### Option 2: copy_paste targeted augmentation

```python
# In a custom augmentation step, paste rare-class instances
# onto images that only contain common classes
# Ultralytics copy_paste does this automatically — just set copy_paste=0.4+
```

### Option 3: cls weight in loss

```python
# Not directly supported in Ultralytics CLI, but via custom trainer:
from ultralytics.models.yolo.segment.train import SegmentationTrainer
class WeightedTrainer(SegmentationTrainer):
    def get_model(self, cfg, weights, verbose):
        model = super().get_model(cfg, weights, verbose)
        # Set class weights on loss
        model.args.cls_weights = [1.0, 3.0, 5.0]  # weight rare classes higher
        return model
```

---

## Multi-GPU Training

```python
model.train(
    data   = "data.yaml",
    device = "0,1",       # use GPU 0 and 1
    batch  = 32,          # total batch across both GPUs
    ...
)
```

Or via CLI:
```bash
yolo segment train data=data.yaml model=yolov8n_seg_gray.pt \
    device=0,1 batch=32 epochs=150 imgsz=640
```

---

## Freeze Backbone for Very Small Datasets

When dataset is tiny (< 100 images/class), freeze backbone and only train head:

```python
model = YOLO("yolov8n_seg_gray.pt")

# Freeze first 10 layers (backbone)
model.train(
    data   = "data.yaml",
    freeze = 10,           # freeze layers 0–9
    epochs = 100,
    lr0    = 0.01,
    ...
)
# After head converges, unfreeze and fine-tune all layers at lower LR
model.train(
    data   = "data.yaml",
    freeze = 0,
    epochs = 50,
    lr0    = 0.001,
    ...
)
```

---

## Checklist Before Training

- [ ] All images normalized to 8-bit uint8
- [ ] Labels verified (run `model.val()` on a small subset first)
- [ ] data.yaml paths are absolute or correctly relative
- [ ] Class names in data.yaml match label class IDs exactly
- [ ] Val set is representative (has all defect classes)
- [ ] `mixup=0.0` confirmed
- [ ] `copy_paste` enabled if dataset is small
- [ ] `degrees=180` if product is rotation-symmetric (magnet, bolt, washer)
- [ ] GPU VRAM checked — reduce `batch` if OOM (rule: 4GB→8, 8GB→16, 16GB→32)
