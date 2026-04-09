---
name: training-code-auditor
description: >
  Use this skill BEFORE executing any machine learning training script — especially YOLOv8, PyTorch, or custom training code. This skill audits the generated training code for: (1) correct loss functions for the task (e.g. BCE+DiceLoss for segmentation, NOT MSE), (2) correct evaluation metrics at the right IoU thresholds (mAP@IoU=0.75 for instance segmentation, not just mAP@0.5), (3) fake, placeholder, random, or stub code that would silently produce garbage results, (4) data pipeline correctness (no random labels, real file paths, correct normalization). Trigger this skill whenever training code is generated or reviewed, when the user says "check my training script", "is this code correct", "audit the training code", "review before training", or any time code contains TODO, pass, random, np.random, torch.randn used as fake data, or placeholder comments. NEVER let training start without passing this audit.
---

# Training Code Auditor

A mandatory pre-flight checklist that runs on any training script before execution.
Catches silent failures — wrong loss functions, fake data pipelines, placeholder metrics —
that produce plausible-looking output but meaningless results.

---

## The Core Problem This Skill Solves

AI-generated training code often contains:
- **Wrong loss function for the task** — using MSELoss for segmentation, or BCELoss alone without Dice for imbalanced masks
- **Wrong IoU threshold** — reporting mAP@0.5 and calling it "segmentation quality" when the task needs mAP@0.75
- **Stub / placeholder code** — `return torch.zeros(batch_size, num_classes)` that compiles and runs but outputs nothing real
- **Random fake data** — `labels = torch.randint(0, num_classes, (B,))` silently replacing the real dataset
- **Disconnected metric** — computing a metric that isn't the one the model optimizes, leading to misleading validation numbers
- **Silent NaN** — loss that never raises an error but quietly becomes NaN after epoch 1

**Rule: if the audit finds ANY of these, STOP and fix before running.**

---

## Audit Phases

Run all five phases in order. Every FAIL blocks training.

---

## Phase 1 — Task / Loss Function Match

**Read `references/loss-function-matrix.md`** for the authoritative task → loss mapping.

For each loss function in the code, verify it matches the task:

| Task | Required Loss | Common Wrong Choices |
|------|-------------|----------------------|
| Instance segmentation (binary mask) | `BCEWithLogitsLoss` + `DiceLoss` | MSELoss, CrossEntropyLoss alone |
| Multi-class semantic segmentation | `CrossEntropyLoss` (with class weights if imbalanced) | BCELoss |
| Object detection (bbox regression) | `CIoULoss` or `GIoULoss` | `MSELoss`, `L1Loss` alone |
| Object detection (classification head) | `BCEWithLogitsLoss` (multi-label) | `CrossEntropyLoss` (wrong for YOLO-style) |
| Binary classification | `BCEWithLogitsLoss` | `MSELoss` |
| Multi-class classification | `CrossEntropyLoss` | `BCELoss` |
| Keypoint regression | `OKSLoss` or `SmoothL1Loss` | `MSELoss` (acceptable but suboptimal) |

**Check specifically:**
```python
# PASS — correct for binary mask segmentation
criterion = nn.BCEWithLogitsLoss()
dice      = DiceLoss()
loss      = criterion(pred, target) + dice(pred, target)

# FAIL — MSE on masks produces nonsense gradients
criterion = nn.MSELoss()
loss      = criterion(pred_mask, gt_mask)

# FAIL — CE alone on binary segmentation (not wrong but suboptimal — flag it)
criterion = nn.CrossEntropyLoss()
```

**YOLOv8 note**: If using Ultralytics `model.train()`, loss functions are internal and correct — skip this phase. Only audit custom PyTorch training loops.

---

## Phase 2 — Metric / IoU Threshold Correctness

**Read `references/metrics-matrix.md`** for the correct metric per task and threshold.

### Critical thresholds by task

| Task | Primary Metric | IoU Threshold | Why |
|------|---------------|---------------|-----|
| Instance segmentation (industrial QC) | `mAP@IoU=0.50:0.95` + **`mAP@IoU=0.75`** | 0.75 required | Tight mask quality check; 0.5 is too lenient for production |
| Object detection (industrial QC) | `mAP@IoU=0.50` + `mAP@IoU=0.75` | Both | 0.5 catches approximate, 0.75 catches precise |
| General object detection (COCO-style) | `mAP@0.50:0.95` | 0.50–0.95 sweep | Standard benchmark |
| Semantic segmentation | `mIoU` (mean IoU per class) | Pixel-level | Not bbox IoU |
| Anomaly detection | `AUROC` + `F1@best_threshold` | N/A | IoU not applicable |
| Binary defect classification | `F1`, `Precision`, `Recall` | N/A | |

### What to check in code

```python
# FAIL — only reporting mAP50, missing mAP75 for segmentation QC
metrics = model.val(iou=0.5)
print(metrics.seg.map50)  # ← insufficient alone for production inspection

# PASS — reporting both thresholds
metrics = model.val()   # Ultralytics computes 0.5:0.95 by default
print(f"mAP50   : {metrics.seg.map50:.4f}")
print(f"mAP75   : {metrics.seg.map75:.4f}")   # ← this is what matters for tight QC
print(f"mAP50-95: {metrics.seg.map:.4f}")

# FAIL — using bbox metrics to evaluate mask quality
print(metrics.box.map50)  # ← wrong metric for segmentation task; use metrics.seg.*

# FAIL — using accuracy for detection (measures nothing useful)
correct = (pred_classes == gt_classes).float().mean()
print(f"Accuracy: {correct}")  # ← meaningless for detection
```

### Custom metric check

If the code computes IoU manually, verify the formula:
```python
# PASS — correct binary mask IoU
def iou(pred, target):
    intersection = (pred & target).float().sum()
    union        = (pred | target).float().sum()
    return (intersection + 1e-6) / (union + 1e-6)

# FAIL — divides by pred area only (= precision, not IoU)
def iou(pred, target):
    intersection = (pred & target).float().sum()
    return intersection / pred.float().sum()  # ← this is precision, not IoU

# FAIL — uses MSE between mask values as a proxy for IoU
loss = F.mse_loss(pred_mask.float(), gt_mask.float())
iou_approx = 1 - loss  # ← completely wrong
```

---

## Phase 3 — Fake / Placeholder / Random Code Detection

This is the most insidious failure mode. Code runs without errors but produces garbage.

### Automatic red-flag patterns — STOP if any found:

```python
# RED FLAG 1 — random labels replacing real dataset
labels = torch.randint(0, num_classes, (batch_size,))
labels = np.random.randint(0, num_classes, size=len(images))

# RED FLAG 2 — random images replacing real data
images = torch.randn(batch_size, 3, 640, 640)
x = torch.zeros(B, C, H, W)  # used as input, not initialization

# RED FLAG 3 — stub forward pass
def forward(self, x):
    return torch.zeros(x.shape[0], self.num_classes)  # ← always returns zeros

# RED FLAG 4 — TODO / NotImplemented in critical path
def compute_loss(pred, target):
    # TODO: implement loss
    return torch.tensor(0.0)   # ← loss is always zero; model never learns

# RED FLAG 5 — hardcoded perfect metric (sanity check passes but means nothing)
def validate():
    return {"mAP50": 0.95, "mAP75": 0.91}  # ← fake result

# RED FLAG 6 — dataset __getitem__ returns fixed sample
def __getitem__(self, idx):
    return self.images[0], self.labels[0]  # ← always same sample

# RED FLAG 7 — loss not connected to optimizer
loss = criterion(pred, target)
# Missing: loss.backward() and optimizer.step()

# RED FLAG 8 — model not in train mode during training
model.eval()          # ← set before training loop — dropout/BN behave incorrectly
for batch in loader:
    ...
```

### Check: is the data pipeline actually loading real files?

```python
# AUDIT CHECK — run this before training to verify dataset is real
dataset = YourDataset(root="path/to/data", split="train")
print(f"Dataset size: {len(dataset)}")           # must be > 0
img, label = dataset[0]
print(f"Image shape: {img.shape}, dtype: {img.dtype}")  # must be real tensor
print(f"Label: {label}")                          # must be real class/mask
assert img.max() > 0, "Image is all zeros — check loading"
assert img.max() <= 1.0 or img.max() <= 255, "Check normalization range"
# For segmentation:
# assert label.sum() > 0, "Mask is empty — check annotation loading"
```

---

## Phase 4 — Data Pipeline Correctness

### Normalization check

```python
# PASS — standard ImageNet normalization for pretrained models
transforms.Normalize(mean=[0.485, 0.456, 0.406],
                     std=[0.229, 0.224, 0.225])

# FAIL — normalizing with wrong stats (common copy-paste error)
transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
# ^ Works for training from scratch but wrong for fine-tuning pretrained models

# FAIL — normalizing grayscale image with RGB stats
transforms.Normalize(mean=[0.485, 0.456, 0.406], ...)
# ^ Applied to 1-channel image — shapes won't broadcast correctly

# PASS — grayscale normalization
transforms.Normalize(mean=[0.449], std=[0.226])  # grayscale ImageNet stats
```

### File path check

```python
# Run before training — verify paths actually exist
import yaml
from pathlib import Path

with open("data.yaml") as f:
    cfg = yaml.safe_load(f)

root = Path(cfg["path"])
for split in ["train", "val"]:
    img_dir = root / cfg[split]
    assert img_dir.exists(), f"❌ Path not found: {img_dir}"
    imgs = list(img_dir.rglob("*.png")) + list(img_dir.rglob("*.jpg")) + \
           list(img_dir.rglob("*.tif"))
    assert len(imgs) > 0, f"❌ No images found in {img_dir}"
    print(f"  ✅ {split}: {len(imgs)} images found at {img_dir}")
```

### Label / image pairing check

```python
# Verify every image has a corresponding label file
from pathlib import Path

img_dir = Path("dataset/images/train")
lbl_dir = Path("dataset/labels/train")

imgs   = {f.stem for f in img_dir.rglob("*") if f.suffix.lower() in [".jpg",".png",".tif"]}
labels = {f.stem for f in lbl_dir.rglob("*.txt")}

missing_labels = imgs - labels
extra_labels   = labels - imgs

print(f"Images:         {len(imgs)}")
print(f"Labels:         {len(labels)}")
print(f"Missing labels: {len(missing_labels)}")
print(f"Extra labels:   {len(extra_labels)}")

if missing_labels:
    print(f"  ⚠ Images with no label: {list(missing_labels)[:5]}")
    # Empty label file = image with no objects — that is VALID for hard negatives
    # Truly missing file = annotation not done yet — INVALID, do not train
```

---

## Phase 5 — Pre-Run Smoke Test

Before full training, run a 2-epoch smoke test to catch runtime errors cheaply.

```python
# Smoke test — catches shape errors, CUDA OOM, corrupt batches
# Add this before the real training call

print("Running smoke test (2 epochs)...")
try:
    model.train(
        data   = "data.yaml",
        epochs = 2,
        batch  = 4,           # small batch to catch OOM early
        imgsz  = 320,         # small size for speed
        device = args.device,
        project= "runs/smoke",
        name   = "test",
        exist_ok = True,
    )
    print("✅ Smoke test passed — safe to run full training")
except Exception as e:
    print(f"❌ Smoke test FAILED: {e}")
    print("Fix the error above before starting full training")
    raise SystemExit(1)
```

**What smoke test catches:**
- Shape mismatch between model output and loss function
- CUDA out of memory (better to know at batch=4 than at epoch 50)
- Corrupt images that crash the data loader
- Wrong `nc` (num classes) in data.yaml vs model
- Missing label directory structure

---

## Audit Report Format

After running all phases, produce this report before allowing training to proceed:

```
╔══════════════════════════════════════════════════════════════╗
║  TRAINING CODE AUDIT REPORT                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Task              : Instance Segmentation                   ║
║  Script            : train_iter.py                          ║
╠══════════════════════════════════════════════════════════════╣
║  Phase 1 — Loss Function         : ✅ PASS                   ║
║    BCEWithLogitsLoss + DiceLoss — correct for binary masks   ║
╠══════════════════════════════════════════════════════════════╣
║  Phase 2 — Metrics / IoU         : ⚠ WARNING                ║
║    mAP@0.75 not reported — added to validation script        ║
╠══════════════════════════════════════════════════════════════╣
║  Phase 3 — Fake/Placeholder Code : ✅ PASS                   ║
║    No random labels, no stub functions found                 ║
╠══════════════════════════════════════════════════════════════╣
║  Phase 4 — Data Pipeline         : ✅ PASS                   ║
║    train: 847 images ✅  val: 203 images ✅                   ║
║    All label files present ✅                                 ║
╠══════════════════════════════════════════════════════════════╣
║  Phase 5 — Smoke Test            : ✅ PASS  (2 epochs, ok)   ║
╠══════════════════════════════════════════════════════════════╣
║  VERDICT: ✅ CLEARED FOR TRAINING (1 warning noted above)    ║
╚══════════════════════════════════════════════════════════════╝
```

**FAIL on any Phase 1–4 finding = do not start training.**
**WARNING on Phase 2 = fix metrics before reporting results, but can train.**
**PASS all = cleared to run.**

---

## Reference Files

- `references/loss-function-matrix.md` — Authoritative task → loss function mapping with correct PyTorch implementations. **Read for Phase 1.**
- `references/metrics-matrix.md` — Correct metrics and IoU thresholds per task, with PyTorch/Ultralytics code to extract them. **Read for Phase 2.**
