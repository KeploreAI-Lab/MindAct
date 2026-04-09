# Diagnosis Rules — Full Decision Tree

Use this after reading the validation report. Apply rules top to bottom.
Stop at the first rule that matches and execute the recommended action.

---

## Level 0: Sanity Checks (always run first)

### Rule 0.1 — Training did not start / loss is NaN
**Signal**: Loss is NaN or infinity from epoch 1.
**Causes & Fixes**:
- LR too high → set `lr0=0.001`
- Corrupt image in dataset → run `python -c "import cv2; [cv2.imread(str(f)) for f in Path('images').rglob('*.png')]"` and find None returns
- Wrong image normalization (values > 255 fed as uint8 to float) → check dtype pipeline

### Rule 0.2 — mAP50 = 0.0 after 20 epochs
**Signal**: All classes at 0.0 mAP.
**Causes & Fixes** (in order of likelihood):
1. Label files not found / wrong directory structure → verify `labels/train/` mirrors `images/train/`
2. Class IDs in labels don't match `names` in data.yaml → print first label file and compare to data.yaml
3. Wrong image channel adaptation (model expects gray, got RGB or vice versa) → check input shape
4. `conf` threshold too high during val → rerun with `conf=0.01`
5. All predictions are out of image bounds → check for coordinate normalization error

---

## Level 1: Global Performance

### Rule 1.1 — mAP50 < 0.50 overall
**Signal**: All or most classes well below target.
**Decision tree**:
```
Is val loss HIGHER than train loss by 2× or more?
├── YES → Overfitting. See Rule 2.1
└── NO
    Is val loss still DECREASING at the final epoch?
    ├── YES → Underfitting / too few epochs. See Rule 2.2
    └── NO (plateau)
        Audit 50 random labels from each class.
        Are > 10% of labels clearly wrong?
        ├── YES → Label quality problem. See Rule 3.1
        └── NO → Class imbalance or domain gap. See Rule 3.2
```

### Rule 1.2 — mAP50 improving slowly (< 0.02 gain per iteration)
**Signal**: Progress exists but is very slow.
**Likely causes**:
- Learning rate too low after warmup → try raising `lrf` slightly
- Val set too small to give stable signal → if val set < 50 images, re-split with more val data
- Model has hit capacity ceiling → upgrade to yolov8s-seg

---

## Level 2: Loss Curve Analysis

### Rule 2.1 — Overfitting (val loss diverges up while train loss goes down)
**Signal**: val/box_loss or val/seg_loss rises after epoch ~50 while train losses keep falling.
**Fix priority**:
1. Add data (most effective)
2. Increase `copy_paste` to 0.4–0.6
3. Increase `degrees` augmentation
4. Add `dropout=0.1`
5. Reduce `epochs` (use `patience=30` to auto-stop)
6. `freeze=10` to freeze backbone and only train detection head

### Rule 2.2 — Underfitting (both losses still decreasing at end)
**Signal**: val loss still trending down at final epoch.
**Fix**: Simply increase `epochs` (add 50% more). Do not change anything else.

### Rule 2.3 — Loss spike mid-training
**Signal**: Loss suddenly jumps up at a specific epoch then recovers.
**Cause**: Corrupt image batch occasionally encountered.
**Fix**: `python scripts/find_corrupt_images.py` — scan all images with opencv and remove unreadable ones.

---

## Level 3: Data Quality

### Rule 3.1 — Label quality issues
**Signal**: Manual audit finds inconsistent or wrong annotations.
**Symptoms**:
- mAP50 is very inconsistent between similar-looking classes
- Precision and recall both low for a class (not just one of them)
- Confusion matrix shows class A predicted as class B at > 40%

**Actions**:
1. Re-annotate the affected class from scratch using a consistent guideline
2. Write a labeling guide: "scratch = any linear mark > 0.5mm visible at 10× magnification"
3. Have a second person re-label 20% of the data and compute inter-annotator agreement
4. If two classes are consistently confused → consider merging them into one class

### Rule 3.2 — Class imbalance
**Signal**: Common classes have high mAP, rare classes have low mAP.
**Check**: Count images per class. If ratio > 5:1, imbalance is likely the problem.
**Fix**:
1. `copy_paste=0.4–0.6` (most effective — synthesizes rare instances automatically)
2. Collect more data for the rare class specifically
3. Replicate rare class images in the dataset (simple but effective for extreme imbalance)
4. Per-class loss weighting (advanced — see training-config.md)

### Rule 3.3 — Domain gap between val and real world
**Signal**: mAP on val set looks good (≥ 0.85) but model fails on production images.
**Actions**:
1. Add real production images to the val set immediately
2. Check: are production images different resolution, lighting, or camera than training data?
3. Add augmentation to simulate production conditions:
   - Different brightness: `hsv_v=0.3`
   - Motion blur: `blur=0.02`
   - Noise: custom albumentation transform

---

## Level 4: Per-Class Specific Issues

### Rule 4.1 — High precision, low recall for a class
**Signal**: P > 0.80 but R < 0.50.
**Meaning**: Model detects it accurately when it detects it, but misses many instances.
**Causes**:
- Too few training samples → collect more
- Defects are small and get missed → increase `imgsz` to 1280 or use SAHI tiling
- Confidence threshold too high → lower `conf` during inference (not training)
- Augmentation doesn't cover the variation seen in val → increase `scale`, `degrees`

### Rule 4.2 — Low precision, high recall for a class
**Signal**: P < 0.50 but R > 0.80.
**Meaning**: Model finds it everywhere (too many FPs).
**Causes**:
- Background texture visually similar to this defect → add hard negative images (images with similar texture but no defect)
- Mislabeled negatives (some clean images have this defect marked) → audit negatives
- Class definition too broad → tighten annotation guidelines

### Rule 4.3 — Both precision and recall low for a class
**Signal**: P < 0.60 AND R < 0.60.
**Meaning**: Model has not learned this class at all.
**Causes** (in order):
1. Too few samples (< 50) → collect more immediately
2. Label errors → audit
3. Visual overlap with another class → consider merging or adding a discriminating feature to annotations

### Rule 4.4 — One class is fine, one is failing, they look similar
**Signal**: Class A at 0.90, Class B at 0.45, and they look visually similar.
**Example**: "deep scratch" vs "light scratch" both annotated — model can't tell them apart.
**Options**:
1. Merge them into one class ("scratch") — simpler and usually works better
2. Add a discriminating feature to images: measure actual depth with microscope, use different class boundary

---

## Level 5: Infrastructure / Reproducibility Issues

### Rule 5.1 — Results vary a lot between runs with same config
**Signal**: Two identical training runs give mAP50 ± 0.05 or more.
**Causes**:
- Small dataset → high variance is expected; report mean ± std over 3 runs
- Random seed not fixed → add `seed=42` to training args

### Rule 5.2 — Model is good on local test but bad in deployment
**Signal**: mAP good in validation, but inference in HALCON / production system is poor.
**Checks**:
1. Is preprocessing identical? (normalization, resize, channel order)
2. Is confidence threshold the same?
3. Is the image resolution the same? (model trained on 640 but inference at 1280 or 320)
4. Export format issues? (ONNX vs PT vs TensorRT may give slightly different results)

---

## Escalation Decision

After 3 iterations with < 0.02 mAP gain despite following rules:

| Current mAP50 | Action |
|--------------|--------|
| < 0.50 | **Data problem** — stop training, fix labels/data before any more runs |
| 0.50–0.70 | Upgrade model: try `yolov8s-seg` |
| 0.70–0.82 | Fine-tune specific failing classes; consider larger `imgsz` |
| 0.82–0.87 | Likely val set issue — add harder/more diverse val images; re-examine target |
| ≥ target | 🎯 Done — move to test set and deployment |
