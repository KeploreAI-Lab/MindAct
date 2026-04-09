# Validation & Diagnosis Script

Run after every training iteration. Produces per-class metrics, failure gallery,
learning curves, and a structured diagnosis report.

---

## Main Validation Script

```python
"""
YOLOv8 Validation + Diagnosis Script
Produces: per-class metrics, confusion analysis, failure gallery, learning curves,
          and a written diagnosis report for the next plan.

Usage:
    python validate_iter.py --iter 1 --weights runs/iter1/weights/best.pt --data data.yaml
"""

import argparse
import csv
import json
import random
from datetime import datetime
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from ultralytics import YOLO

RUNS_ROOT = Path("runs")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--iter",    type=int,  required=True)
    p.add_argument("--weights", type=str,  required=True)
    p.add_argument("--data",    type=str,  default="data.yaml")
    p.add_argument("--conf",    type=float, default=0.25)
    p.add_argument("--iou",     type=float, default=0.50)
    p.add_argument("--target",  type=float, default=0.88,  help="Target mAP50")
    p.add_argument("--max_failures", type=int, default=20, help="Failure images to save")
    return p.parse_args()


# ── 1. Run official validation ─────────────────────────────────────────────

def run_validation(model, args, val_dir):
    print("\n── Running official validation ──")
    metrics = model.val(
        data    = args.data,
        conf    = args.conf,
        iou     = args.iou,
        plots   = True,
        save_json = True,
        project = str(val_dir.parent),
        name    = val_dir.name,
    )
    return metrics


# ── 2. Per-class metrics table ────────────────────────────────────────────

def print_per_class_table(metrics, target_map50: float) -> dict:
    names   = metrics.names          # {0: 'scratch', 1: 'dent', ...}
    ap50    = metrics.seg.ap50       # per-class mAP50 array
    prec    = metrics.seg.p          # per-class precision
    rec     = metrics.seg.r          # per-class recall

    # Also get bbox metrics
    bbox_ap50 = metrics.box.ap50

    print("\n" + "="*70)
    print(f"  PER-CLASS METRICS (conf={metrics.args['conf']}, iou={metrics.args['iou']})")
    print("="*70)
    print(f"  {'Class':<20} {'mAP50':>8} {'Prec':>8} {'Recall':>8} {'BBox mAP50':>12}  Status")
    print("  " + "-"*66)

    per_class = {}
    for i, (cls_id, cls_name) in enumerate(names.items()):
        m50  = ap50[i]   if i < len(ap50)    else 0.0
        p    = prec[i]   if i < len(prec)    else 0.0
        r    = rec[i]    if i < len(rec)     else 0.0
        bm50 = bbox_ap50[i] if i < len(bbox_ap50) else 0.0
        flag = "✅" if m50 >= target_map50 else "❌"
        print(f"  {cls_name:<20} {m50:>8.4f} {p:>8.4f} {r:>8.4f} {bm50:>12.4f}  {flag}")
        per_class[cls_name] = {"mAP50": m50, "precision": p, "recall": r, "bbox_mAP50": bm50}

    print("  " + "-"*66)
    print(f"  {'OVERALL':<20} {metrics.seg.map50:>8.4f} {metrics.seg.mp:>8.4f} "
          f"{metrics.seg.mr:>8.4f}  {'✅' if metrics.seg.map50 >= target_map50 else '❌'}")
    print(f"  mAP50-95: {metrics.seg.map:.4f}")
    print("="*70)
    return per_class


# ── 3. Learning curves ────────────────────────────────────────────────────

def plot_learning_curves(iter_n: int, output_dir: Path):
    """Plot train/val loss and mAP over all past iterations."""
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(f"Learning Curves — All Iterations up to iter{iter_n}", fontsize=13)

    for n in range(1, iter_n + 1):
        csv_path = RUNS_ROOT / f"iter{n}" / "results.csv"
        if not csv_path.exists():
            continue
        rows = list(csv.DictReader(open(csv_path)))
        if not rows:
            continue
        epochs = list(range(1, len(rows) + 1))

        def col(name):
            key = next((k for k in rows[0] if name in k), None)
            return [float(r[key]) for r in rows if key and r[key].strip()] if key else []

        label = f"iter{n}"
        color = plt.cm.tab10(n / 10)

        # Box loss
        ax = axes[0][0]
        tl = col("train/box_loss"); vl = col("val/box_loss")
        if tl: ax.plot(epochs[:len(tl)], tl, color=color, ls="-",  label=f"{label} train")
        if vl: ax.plot(epochs[:len(vl)], vl, color=color, ls="--", label=f"{label} val")
        ax.set_title("Box Loss"); ax.set_xlabel("Epoch"); ax.legend(fontsize=7)

        # Seg loss
        ax = axes[0][1]
        tl = col("train/seg_loss"); vl = col("val/seg_loss")
        if tl: ax.plot(epochs[:len(tl)], tl, color=color, ls="-",  label=f"{label} train")
        if vl: ax.plot(epochs[:len(vl)], vl, color=color, ls="--", label=f"{label} val")
        ax.set_title("Seg Loss"); ax.set_xlabel("Epoch"); ax.legend(fontsize=7)

        # mAP50
        ax = axes[1][0]
        m50 = col("metrics/mAP50(M)") or col("metrics/mAP50(B)")
        if m50: ax.plot(epochs[:len(m50)], m50, color=color, label=label)
        ax.set_title("mAP50"); ax.set_xlabel("Epoch"); ax.legend(fontsize=7)

        # Precision / Recall
        ax = axes[1][1]
        pr = col("metrics/precision(M)") or col("metrics/precision(B)")
        rc = col("metrics/recall(M)")    or col("metrics/recall(B)")
        if pr: ax.plot(epochs[:len(pr)], pr, color=color, ls="-",  label=f"{label} P")
        if rc: ax.plot(epochs[:len(rc)], rc, color=color, ls="--", label=f"{label} R")
        ax.set_title("Precision / Recall"); ax.set_xlabel("Epoch"); ax.legend(fontsize=7)

    plt.tight_layout()
    out = output_dir / "learning_curves.png"
    plt.savefig(out, dpi=150)
    plt.close()
    print(f"  Learning curves saved: {out}")


# ── 4. Failure gallery ────────────────────────────────────────────────────

def build_failure_gallery(model, args, per_class: dict, output_dir: Path):
    """Find and save images where model made significant errors."""
    import yaml
    data_cfg = yaml.safe_load(open(args.data))
    data_root = Path(data_cfg.get("path", "."))
    val_img_dir = data_root / data_cfg.get("val", "images/val")

    if not val_img_dir.exists():
        print(f"  ⚠ Val image dir not found: {val_img_dir}"); return

    img_files = [f for f in val_img_dir.rglob("*")
                 if f.suffix.lower() in [".jpg", ".jpeg", ".png", ".tif", ".bmp"]]
    random.shuffle(img_files)
    img_files = img_files[:min(200, len(img_files))]  # sample up to 200

    failures = []
    for img_path in img_files:
        img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
        if img is None: continue
        if img.dtype != np.uint8:
            img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

        results = model(img, conf=args.conf, iou=args.iou, verbose=False)[0]
        n_det = len(results.boxes)

        # Load ground truth
        lbl_path = img_path.parent.parent.parent / "labels" / \
                   img_path.parent.name / img_path.with_suffix(".txt").name
        n_gt = 0
        if lbl_path.exists():
            n_gt = len([l for l in lbl_path.read_text().strip().splitlines() if l.strip()])

        # Flag as failure: missed detections (FN) or excess detections (FP)
        if n_gt > 0 and n_det == 0:
            failures.append((img_path, results, "MISS", n_gt, n_det))
        elif n_det > n_gt * 2 and n_gt > 0:
            failures.append((img_path, results, "FP", n_gt, n_det))
        elif n_det > 0 and n_gt == 0:
            failures.append((img_path, results, "FP_on_clean", n_gt, n_det))

    failures = failures[:args.max_failures]
    if not failures:
        print("  ✅ No obvious failures in sampled val images"); return

    # Save gallery grid
    cols = 4
    rows = (len(failures) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 4, rows * 4))
    axes = np.array(axes).flatten()

    for ax_i, (img_path, results, failure_type, n_gt, n_det) in enumerate(failures):
        img_disp = cv2.imread(str(img_path))
        if img_disp is None:
            img_disp = cv2.cvtColor(cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE),
                                     cv2.COLOR_GRAY2BGR)
        ax = axes[ax_i]
        ax.imshow(cv2.cvtColor(img_disp, cv2.COLOR_BGR2RGB))
        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            rect = patches.Rectangle((x1, y1), x2-x1, y2-y1,
                                      linewidth=1.5, edgecolor="red", facecolor="none")
            ax.add_patch(rect)
        ax.set_title(f"{failure_type}\nGT={n_gt} Det={n_det}\n{img_path.stem[:20]}",
                     fontsize=7, color="red" if failure_type == "MISS" else "orange")
        ax.axis("off")

    for ax in axes[len(failures):]:
        ax.axis("off")

    plt.suptitle(f"Failure Gallery — iter{args.iter}", fontsize=12)
    plt.tight_layout()
    out = output_dir / "failure_gallery.png"
    plt.savefig(out, dpi=120)
    plt.close()
    print(f"  Failure gallery saved: {out}  ({len(failures)} failures)")


# ── 5. Diagnosis report ───────────────────────────────────────────────────

def write_diagnosis_report(args, per_class: dict, metrics, output_dir: Path):
    """Write a structured markdown diagnosis to feed into the next plan."""
    overall_map50 = metrics.seg.map50
    target        = args.target
    reached       = overall_map50 >= target

    lines = [
        f"# Diagnosis Report — Iteration {args.iter}",
        f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Weights: {args.weights}",
        "",
        "## Overall Result",
        f"- mAP50:    {overall_map50:.4f}  (target: {target})  {'✅ REACHED' if reached else '❌ NOT YET'}",
        f"- mAP50-95: {metrics.seg.map:.4f}",
        f"- Precision: {metrics.seg.mp:.4f}",
        f"- Recall:    {metrics.seg.mr:.4f}",
        "",
        "## Per-Class Results",
        f"| Class | mAP50 | Precision | Recall | Status |",
        f"|-------|-------|-----------|--------|--------|",
    ]
    failing_classes = []
    for cls_name, m in per_class.items():
        status = "✅" if m["mAP50"] >= target else "❌"
        if m["mAP50"] < target:
            failing_classes.append((cls_name, m))
        lines.append(f"| {cls_name} | {m['mAP50']:.4f} | {m['precision']:.4f} | {m['recall']:.4f} | {status} |")

    lines += ["", "## Failing Classes Analysis"]
    if not failing_classes:
        lines.append("All classes met target. ✅")
    else:
        for cls_name, m in failing_classes:
            lines.append(f"\n### {cls_name}  (mAP50={m['mAP50']:.4f})")
            p, r = m["precision"], m["recall"]
            if m["mAP50"] < 0.4:
                lines.append("- **Critical**: mAP50 < 0.4 — likely label errors or wrong class mapping")
                lines.append("- Action: audit 30 random labels for this class")
            elif r < 0.5:
                lines.append(f"- **Low recall ({r:.3f})**: model misses too many instances")
                lines.append("- Possible causes: too few training samples, small defect size, bad augmentation")
                lines.append("- Action: add more samples OR increase copy_paste OR check if defects are very small")
            elif p < 0.5:
                lines.append(f"- **Low precision ({p:.3f})**: too many false positives")
                lines.append("- Possible causes: visually similar background regions, mislabeled negatives")
                lines.append("- Action: add hard negative images, audit background regions")
            else:
                lines.append(f"- Moderate gap: P={p:.3f} R={r:.3f}")
                lines.append("- Action: increase training epochs and check if val curve is still improving")

    lines += [
        "",
        "## Recommended Next Actions",
        "Fill these into plan_iter{N+1}.md:",
        "",
    ]
    if reached:
        lines.append("🎯 **TARGET REACHED** — proceed to test set evaluation and deployment.")
    else:
        lines.append(f"1. Address failing classes: {[c for c,_ in failing_classes]}")
        lines.append("2. Review learning_curves.png — is val loss still decreasing?")
        lines.append("3. Review failure_gallery.png — what patterns appear in failures?")
        lines.append("4. Max 2–3 changes for next iteration.")

    report_path = output_dir / f"diagnosis_iter{args.iter}.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n  Diagnosis report: {report_path}")

    # Also print to console
    print("\n" + "\n".join(lines[2:20]))  # print first part
    return reached


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    args    = parse_args()
    val_dir = RUNS_ROOT / f"iter{args.iter}_val"
    val_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  VALIDATION — ITERATION {args.iter}")
    print(f"  Weights: {args.weights}")
    print(f"  Target mAP50: {args.target}")
    print(f"{'='*60}")

    model   = YOLO(args.weights)
    metrics = run_validation(model, args, val_dir)

    per_class = print_per_class_table(metrics, args.target)
    plot_learning_curves(args.iter, val_dir)
    build_failure_gallery(model, args, per_class, val_dir)
    reached = write_diagnosis_report(args, per_class, metrics, val_dir)

    print(f"\n{'='*60}")
    if reached:
        print(f"  🎯 TARGET REACHED: mAP50={metrics.seg.map50:.4f} ≥ {args.target}")
        print("  Ready for test set evaluation.")
    else:
        gap = args.target - metrics.seg.map50
        print(f"  Gap to target: {gap:.4f} mAP50 remaining")
        print(f"  Read: {val_dir}/diagnosis_iter{args.iter}.md")
        print(f"  Write: runs/plan_iter{args.iter + 1}.md")
        print(f"  Then run: python train_iter.py --iter {args.iter + 1} ...")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
```

---

## Usage

```bash
# After training iteration 1
python validate_iter.py --iter 1 \
    --weights runs/iter1/weights/best.pt \
    --data data.yaml \
    --target 0.88

# Produces in runs/iter1_val/:
#   diagnosis_iter1.md     ← read this, then write plan_iter2.md
#   learning_curves.png
#   failure_gallery.png
#   confusion_matrix.png   (from Ultralytics val)
```
