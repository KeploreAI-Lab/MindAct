# Metrics Matrix

Correct evaluation metrics and IoU thresholds per CV task.
Use during Phase 2 audit to verify generated code reports the right numbers.

---

## Primary Metrics by Task

| Task | Primary Metric | IoU Threshold | Secondary | Never Use |
|------|---------------|---------------|-----------|-----------|
| Instance segmentation — production QC | `mAP@0.75` (mask) | **0.75** | mAP@0.5:0.95 | mAP@0.5 alone |
| Instance segmentation — general | `mAP@0.5:0.95` (mask) | 0.50–0.95 | mAP@0.75 | accuracy |
| Object detection — production QC | `mAP@0.75` (box) | **0.75** | mAP@0.5 | accuracy |
| Object detection — general (COCO) | `mAP@0.5:0.95` | 0.50–0.95 | mAP@0.5 | accuracy |
| Semantic segmentation | `mIoU` (pixel-level) | pixel | per-class IoU | bbox IoU |
| Anomaly detection | `AUROC` + `F1@best_thresh` | N/A | per-pixel AUROC | accuracy |
| Binary defect classification | `F1`, `Precision`, `Recall` | N/A | ROC-AUC | accuracy alone |
| Multi-class classification | `macro-F1` + per-class F1 | N/A | top-1 acc | accuracy alone |
| Keypoint estimation | `OKS-mAP` | OKS 0.5:0.95 | PCKh@0.5 | MSE |

---

## Why mAP@0.75 Matters for Industrial QC

For production defect inspection, **mAP@0.5 is misleading**:

```
Example: model predicts mask that covers 60% of actual defect area.
  IoU = 0.60 → counts as TRUE POSITIVE at @0.5 threshold
  IoU = 0.60 → counts as FALSE POSITIVE at @0.75 threshold

In production: a 60% mask means 40% of the defect is unmeasured.
For area/volume measurement, size estimation, or routing decisions → this is a failure.
mAP@0.5 would report this as "correct". mAP@0.75 correctly penalizes it.
```

**Rule for industrial inspection**: always report BOTH mAP@0.5 and mAP@0.75.
Use mAP@0.75 as the pass/fail gate for production readiness.

---

## Extracting Metrics from Ultralytics

### Complete metric extraction — segmentation model

```python
from ultralytics import YOLO

model   = YOLO("runs/iter1/weights/best.pt")
metrics = model.val(data="data.yaml", conf=0.25, iou=0.5)

# ── Segmentation metrics (mask quality) ──────────────────────
print("=== SEGMENTATION METRICS (MASK) ===")
print(f"  mAP50      : {metrics.seg.map50:.4f}")    # IoU=0.50
print(f"  mAP75      : {metrics.seg.map75:.4f}")    # IoU=0.75 ← KEY for QC
print(f"  mAP50-95   : {metrics.seg.map:.4f}")      # sweep 0.50→0.95, step 0.05
print(f"  Precision  : {metrics.seg.mp:.4f}")
print(f"  Recall     : {metrics.seg.mr:.4f}")

# ── Per-class segmentation metrics ────────────────────────────
print("\n=== PER-CLASS SEGMENTATION ===")
for i, name in metrics.names.items():
    ap50 = metrics.seg.ap50[i] if i < len(metrics.seg.ap50) else 0.0
    ap75 = metrics.seg.ap75[i] if hasattr(metrics.seg, 'ap75') and \
           i < len(metrics.seg.ap75) else float('nan')
    ap   = metrics.seg.ap[i]   if i < len(metrics.seg.ap)   else 0.0
    print(f"  {name:20s} mAP50={ap50:.4f}  mAP75={ap75:.4f}  mAP50-95={ap:.4f}")

# ── Bounding box metrics (detection quality) ──────────────────
print("\n=== BOUNDING BOX METRICS ===")
print(f"  mAP50      : {metrics.box.map50:.4f}")
print(f"  mAP75      : {metrics.box.map75:.4f}")    # ← also report for detection
print(f"  mAP50-95   : {metrics.box.map:.4f}")

# ── Speed ──────────────────────────────────────────────────────
print(f"\n  Inference : {metrics.speed['inference']:.1f} ms/image")
print(f"  NMS       : {metrics.speed['postprocess']:.1f} ms/image")
```

### Computing mAP@0.75 manually if not in Ultralytics version

Older Ultralytics versions may not expose `map75` directly. Extract from the full AP array:

```python
# Ultralytics computes AP at 10 thresholds: 0.50, 0.55, 0.60 ... 0.95
# Index 5 = IoU threshold 0.75
metrics = model.val(data="data.yaml")

# Full AP array per class: shape [num_classes, 10]
ap_array = metrics.seg.ap_class_index   # class indices
ap_full  = metrics.seg.ap              # [num_classes,] mean over thresholds

# To get mAP@0.75: need raw per-threshold values
# Access via: metrics.seg.maps  or metrics.box.maps
# maps is shape [10] — index 5 corresponds to IoU=0.75
if hasattr(metrics.seg, 'maps'):
    map75 = metrics.seg.maps[5]   # index 5 = IoU 0.75
    print(f"mAP@0.75: {map75:.4f}")
```

---

## Custom mAP@0.75 Computation (for non-Ultralytics code)

```python
import numpy as np


def compute_iou_mask(pred_mask: np.ndarray, gt_mask: np.ndarray) -> float:
    """Compute IoU between two binary masks."""
    intersection = np.logical_and(pred_mask, gt_mask).sum()
    union        = np.logical_or(pred_mask, gt_mask).sum()
    return float(intersection) / float(union + 1e-7)


def compute_ap_at_iou(
    pred_masks:   list,   # list of [H,W] binary arrays
    pred_scores:  list,   # list of float confidence scores
    gt_masks:     list,   # list of [H,W] binary arrays
    iou_threshold: float = 0.75,
) -> float:
    """
    Compute AP at a single IoU threshold using 11-point interpolation.
    Returns AP value in [0, 1].
    """
    # Sort by descending confidence
    order = np.argsort(pred_scores)[::-1]
    pred_masks  = [pred_masks[i]  for i in order]
    pred_scores = [pred_scores[i] for i in order]

    num_gt = len(gt_masks)
    matched_gt = set()
    tp = np.zeros(len(pred_masks))
    fp = np.zeros(len(pred_masks))

    for k, pred_mask in enumerate(pred_masks):
        best_iou = 0.0
        best_j   = -1
        for j, gt_mask in enumerate(gt_masks):
            if j in matched_gt:
                continue
            iou = compute_iou_mask(pred_mask > 0.5, gt_mask > 0.5)
            if iou > best_iou:
                best_iou = iou
                best_j   = j
        if best_iou >= iou_threshold and best_j not in matched_gt:
            tp[k] = 1
            matched_gt.add(best_j)
        else:
            fp[k] = 1

    cum_tp = np.cumsum(tp)
    cum_fp = np.cumsum(fp)
    recall    = cum_tp / (num_gt + 1e-7)
    precision = cum_tp / (cum_tp + cum_fp + 1e-7)

    # 11-point interpolation
    ap = 0.0
    for thr in np.linspace(0, 1, 11):
        prec_at_rec = precision[recall >= thr]
        ap += (prec_at_rec.max() if len(prec_at_rec) else 0.0) / 11.0
    return ap


def compute_map_at_thresholds(
    pred_masks:   list,
    pred_scores:  list,
    gt_masks:     list,
    thresholds:   list = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95],
) -> dict:
    """Compute mAP at multiple IoU thresholds."""
    aps = {thr: compute_ap_at_iou(pred_masks, pred_scores, gt_masks, thr)
           for thr in thresholds}
    aps["mAP50"]    = aps[0.50]
    aps["mAP75"]    = aps[0.75]
    aps["mAP50-95"] = np.mean([aps[t] for t in thresholds])
    return aps


# Usage:
# results = compute_map_at_thresholds(pred_masks, scores, gt_masks)
# print(f"mAP@0.50 : {results['mAP50']:.4f}")
# print(f"mAP@0.75 : {results['mAP75']:.4f}")   ← the one that matters for QC
# print(f"mAP@0.5:0.95: {results['mAP50-95']:.4f}")
```

---

## Semantic Segmentation — mIoU

```python
import numpy as np


def compute_miou(
    pred:       np.ndarray,  # [H, W] int, predicted class per pixel
    target:     np.ndarray,  # [H, W] int, ground truth class per pixel
    num_classes: int,
    ignore_index: int = 255,
) -> tuple[float, list]:
    """Returns (mean_iou, per_class_iou_list)."""
    iou_per_class = []
    for cls in range(num_classes):
        pred_mask   = (pred == cls)
        target_mask = (target == cls)
        if ignore_index is not None:
            valid = (target != ignore_index)
            pred_mask   = pred_mask   & valid
            target_mask = target_mask & valid
        intersection = (pred_mask & target_mask).sum()
        union        = (pred_mask | target_mask).sum()
        if union == 0:
            iou_per_class.append(float("nan"))  # class not present — skip in mean
        else:
            iou_per_class.append(float(intersection) / float(union))
    valid_ious = [x for x in iou_per_class if not np.isnan(x)]
    mean_iou   = float(np.mean(valid_ious)) if valid_ious else 0.0
    return mean_iou, iou_per_class
```

---

## Anomaly Detection — AUROC + F1

```python
from sklearn.metrics import roc_auc_score, f1_score, precision_recall_curve
import numpy as np


def compute_anomaly_metrics(
    scores:  np.ndarray,   # [N] anomaly scores, higher = more anomalous
    labels:  np.ndarray,   # [N] ground truth: 0=normal, 1=anomaly
) -> dict:
    auroc = roc_auc_score(labels, scores)

    # Find threshold that maximizes F1
    precision, recall, thresholds = precision_recall_curve(labels, scores)
    f1_scores = 2 * precision * recall / (precision + recall + 1e-7)
    best_idx   = np.argmax(f1_scores)
    best_thr   = thresholds[best_idx] if best_idx < len(thresholds) else 0.5
    best_f1    = f1_scores[best_idx]

    preds_at_best = (scores >= best_thr).astype(int)
    return {
        "AUROC":          round(float(auroc), 4),
        "F1@best_thresh": round(float(best_f1), 4),
        "best_threshold": round(float(best_thr), 4),
        "precision":      round(float(precision[best_idx]), 4),
        "recall":         round(float(recall[best_idx]), 4),
    }
```

---

## Metric Audit Checklist

Before accepting any validation script as complete, verify:

- [ ] For segmentation tasks: `mAP@0.75` is reported (not just `mAP@0.5`)
- [ ] Segmentation uses `metrics.seg.*` not `metrics.box.*`
- [ ] mIoU used for semantic segmentation (not bbox IoU)
- [ ] Anomaly detection uses AUROC + F1 (not accuracy)
- [ ] Per-class metrics reported, not just aggregate
- [ ] Metric is the same one used in the training plan's target
- [ ] Confidence threshold used during eval matches planned deployment threshold
