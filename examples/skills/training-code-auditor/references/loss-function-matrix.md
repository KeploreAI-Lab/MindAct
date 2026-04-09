# Loss Function Matrix

Authoritative mapping: task → correct loss function → PyTorch implementation.
Use this during Phase 1 audit to verify generated code uses the right loss.

---

## Quick Reference Table

| Task | Primary Loss | Secondary Loss | Notes |
|------|-------------|----------------|-------|
| Binary instance segmentation | `BCEWithLogitsLoss` | `DiceLoss` | Always combine both |
| Multi-class semantic segmentation | `CrossEntropyLoss` | `DiceLoss` (optional) | Use class weights for imbalance |
| Object detection — bbox | `CIoULoss` | — | Never use MSE for bbox |
| Object detection — objectness | `BCEWithLogitsLoss` | — | |
| Object detection — class | `BCEWithLogitsLoss` | — | Multi-label style (YOLO) |
| Binary image classification | `BCEWithLogitsLoss` | — | |
| Multi-class image classification | `CrossEntropyLoss` | — | |
| Multi-label classification | `BCEWithLogitsLoss` | — | |
| Keypoint detection | `OKSLoss` or `SmoothL1Loss` | — | |
| Anomaly detection (reconstruction) | `MSELoss` or `SSIMLoss` | — | MSE valid here |
| Depth estimation | `SILogLoss` | `L1Loss` | |

---

## Correct Implementations

### 1. Binary Instance Segmentation

**Always use BCEWithLogitsLoss + DiceLoss together.**
BCE alone struggles with class imbalance (background >> foreground in defect images).
Dice alone can be unstable early in training.

```python
import torch
import torch.nn as nn
import torch.nn.functional as F


class DiceLoss(nn.Module):
    def __init__(self, smooth: float = 1.0):
        super().__init__()
        self.smooth = smooth

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        """
        Args:
            logits:  raw model output, shape [B, 1, H, W] or [B, H, W]
            targets: binary ground truth, same shape, values in {0, 1}
        """
        probs = torch.sigmoid(logits)
        probs   = probs.view(-1)
        targets = targets.view(-1).float()
        intersection = (probs * targets).sum()
        dice = (2. * intersection + self.smooth) / \
               (probs.sum() + targets.sum() + self.smooth)
        return 1 - dice


class BceDiceLoss(nn.Module):
    """Combined BCE + Dice for binary segmentation."""
    def __init__(self, bce_weight: float = 0.5, dice_weight: float = 0.5):
        super().__init__()
        self.bce  = nn.BCEWithLogitsLoss()
        self.dice = DiceLoss()
        self.bce_w  = bce_weight
        self.dice_w = dice_weight

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        return self.bce_w  * self.bce(logits, targets.float()) + \
               self.dice_w * self.dice(logits, targets)


# Usage
criterion = BceDiceLoss(bce_weight=0.5, dice_weight=0.5)
loss = criterion(pred_masks, gt_masks)
```

### 2. Multi-Class Semantic Segmentation

```python
import torch
import torch.nn as nn

# Standard — equal class weights
criterion = nn.CrossEntropyLoss()
loss = criterion(pred, target)   # pred: [B, C, H, W], target: [B, H, W] long

# With class weights (for imbalanced datasets — e.g. background >> defect)
class_counts = torch.tensor([10000., 200., 150.])   # pixels per class
weights = 1.0 / class_counts
weights = weights / weights.sum()
criterion = nn.CrossEntropyLoss(weight=weights.to(device))

# With ignore_index (for unlabeled pixels)
criterion = nn.CrossEntropyLoss(ignore_index=255)
```

### 3. Object Detection — Bounding Box Regression

**Never use MSELoss for bounding boxes.** IoU-based losses directly optimize the metric.

```python
# CIoU Loss — best for bbox regression (used by YOLOv8 internally)
def ciou_loss(pred_boxes, target_boxes):
    """
    pred_boxes, target_boxes: [N, 4] in xyxy format
    Returns scalar loss.
    """
    # Intersection
    x1 = torch.max(pred_boxes[:, 0], target_boxes[:, 0])
    y1 = torch.max(pred_boxes[:, 1], target_boxes[:, 1])
    x2 = torch.min(pred_boxes[:, 2], target_boxes[:, 2])
    y2 = torch.min(pred_boxes[:, 3], target_boxes[:, 3])
    inter = (x2 - x1).clamp(0) * (y2 - y1).clamp(0)

    # Union
    area_p = (pred_boxes[:, 2]   - pred_boxes[:, 0])   * (pred_boxes[:, 3]   - pred_boxes[:, 1])
    area_t = (target_boxes[:, 2] - target_boxes[:, 0]) * (target_boxes[:, 3] - target_boxes[:, 1])
    union  = area_p + area_t - inter + 1e-7
    iou    = inter / union

    # Enclosing box diagonal
    cw = torch.max(pred_boxes[:, 2], target_boxes[:, 2]) - \
         torch.min(pred_boxes[:, 0], target_boxes[:, 0])
    ch = torch.max(pred_boxes[:, 3], target_boxes[:, 3]) - \
         torch.min(pred_boxes[:, 1], target_boxes[:, 1])
    c2 = cw**2 + ch**2 + 1e-7

    # Center distance
    pred_cx = (pred_boxes[:, 0] + pred_boxes[:, 2]) / 2
    pred_cy = (pred_boxes[:, 1] + pred_boxes[:, 3]) / 2
    tgt_cx  = (target_boxes[:, 0] + target_boxes[:, 2]) / 2
    tgt_cy  = (target_boxes[:, 1] + target_boxes[:, 3]) / 2
    rho2    = (pred_cx - tgt_cx)**2 + (pred_cy - tgt_cy)**2

    # Aspect ratio consistency term
    pred_w = pred_boxes[:, 2] - pred_boxes[:, 0]
    pred_h = pred_boxes[:, 3] - pred_boxes[:, 1]
    tgt_w  = target_boxes[:, 2] - target_boxes[:, 0]
    tgt_h  = target_boxes[:, 3] - target_boxes[:, 1]
    v = (4 / (torch.pi**2)) * \
        (torch.atan(tgt_w / (tgt_h + 1e-7)) - torch.atan(pred_w / (pred_h + 1e-7)))**2
    with torch.no_grad():
        alpha = v / (1 - iou + v + 1e-7)

    ciou = iou - rho2/c2 - alpha*v
    return (1 - ciou).mean()
```

### 4. Focal Loss — for extreme class imbalance in detection

```python
class FocalLoss(nn.Module):
    """Focal Loss for dense object detection (RetinaNet, FCOS style)."""
    def __init__(self, alpha: float = 0.25, gamma: float = 2.0):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce   = F.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        p_t   = torch.exp(-bce)
        focal = self.alpha * (1 - p_t) ** self.gamma * bce
        return focal.mean()
```

---

## Loss Function Red Flags

### MSELoss on class labels
```python
# ❌ FAIL — regression loss on classification output
loss = F.mse_loss(logits, one_hot_labels.float())
# Why wrong: MSE doesn't produce proper probability calibration; gradients
# don't reflect the actual class error structure
```

### BCELoss (not BCEWithLogitsLoss) on raw logits
```python
# ❌ FAIL — numerical instability; may produce NaN
loss = F.binary_cross_entropy(logits, targets)   # expects probabilities 0-1

# ✅ PASS — numerically stable; applies sigmoid internally
loss = F.binary_cross_entropy_with_logits(logits, targets)
```

### CrossEntropyLoss on sigmoid output
```python
# ❌ FAIL — CE expects raw logits, not softmaxed/sigmoided values
probs = torch.softmax(logits, dim=1)
loss  = F.cross_entropy(probs, targets)   # wrong — double-softmax effectively

# ✅ PASS — raw logits only
loss = F.cross_entropy(logits, targets)
```

### DiceLoss alone on early training
```python
# ⚠ WARNING — Dice alone is unstable when pred is near 0.5 everywhere (early epochs)
# Always pair with BCE for stability
loss = dice_loss(logits, targets)   # may oscillate wildly in first 10 epochs
```

---

## YOLOv8 Internal Losses (for reference — do NOT override)

YOLOv8 uses these internally. When using `model.train()`, these are already correct:

| Loss component | Implementation | Weight |
|---------------|---------------|--------|
| Box loss | CIoU | `box=7.5` |
| Classification loss | BCE with logits | `cls=0.5` |
| Distribution focal loss | DFL | `dfl=1.5` |
| Segmentation mask loss | BCE on downsampled masks | `seg=1.0` (seg models) |

If you see code that **overrides** these with custom losses on top of `model.train()`, that is almost always wrong and should be flagged.
