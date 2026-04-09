# Training Script with Full Logging

Run this for every iteration. It saves everything needed to reproduce and diagnose the run.

---

## Main Training Script

```python
"""
YOLOv8 Iterative Training Script
Saves: weights, results.csv, train_log.txt, config snapshot, plan copy.

Usage:
    python train_iter.py --iter 1 --data data.yaml --epochs 150
    python train_iter.py --iter 2 --data data.yaml --epochs 200 --weights runs/iter1/weights/best.pt
"""

import argparse
import shutil
import sys
import time
import yaml
from datetime import datetime
from pathlib import Path

# ── USER CONFIG (edit or pass via CLI) ─────────────────────────
DEFAULT_MODEL   = "yolov8n-seg.pt"   # base weights (iter 1)
DEFAULT_DATA    = "data.yaml"
DEFAULT_EPOCHS  = 150
DEFAULT_IMGSZ   = 640
DEFAULT_BATCH   = 16
DEFAULT_DEVICE  = "0"                # "0", "0,1", "cpu"
RUNS_ROOT       = Path("runs")
# ───────────────────────────────────────────────────────────────


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--iter",    type=int,   required=True,        help="Iteration number (1, 2, 3...)")
    p.add_argument("--data",    type=str,   default=DEFAULT_DATA)
    p.add_argument("--weights", type=str,   default=DEFAULT_MODEL,help="Starting weights (.pt)")
    p.add_argument("--epochs",  type=int,   default=DEFAULT_EPOCHS)
    p.add_argument("--imgsz",   type=int,   default=DEFAULT_IMGSZ)
    p.add_argument("--batch",   type=int,   default=DEFAULT_BATCH)
    p.add_argument("--device",  type=str,   default=DEFAULT_DEVICE)
    # Key hyperparameters (override as needed each iter)
    p.add_argument("--lr0",          type=float, default=0.005)
    p.add_argument("--lrf",          type=float, default=0.001)
    p.add_argument("--warmup_epochs",type=float, default=5)
    p.add_argument("--mosaic",       type=float, default=0.8)
    p.add_argument("--copy_paste",   type=float, default=0.3)
    p.add_argument("--degrees",      type=float, default=90.0)
    p.add_argument("--fliplr",       type=float, default=0.5)
    p.add_argument("--flipud",       type=float, default=0.5)
    p.add_argument("--hsv_v",        type=float, default=0.2)
    p.add_argument("--hsv_s",        type=float, default=0.1)
    p.add_argument("--freeze",       type=int,   default=0,  help="Freeze first N layers")
    p.add_argument("--dropout",      type=float, default=0.0)
    return p.parse_args()


def save_config(args, run_dir: Path):
    """Save exact hyperparameters used — critical for reproducibility."""
    cfg = vars(args)
    cfg["timestamp"] = datetime.now().isoformat()
    cfg["weights_abs"] = str(Path(args.weights).resolve())
    cfg_path = run_dir / f"config_iter{args.iter}.yaml"
    with open(cfg_path, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False)
    print(f"  Config saved: {cfg_path}")
    return cfg_path


def copy_plan(iter_n: int, run_dir: Path):
    """Copy the training plan into the run directory."""
    plan_src = RUNS_ROOT / f"plan_iter{iter_n}.md"
    if plan_src.exists():
        shutil.copy2(plan_src, run_dir / f"plan_iter{iter_n}.md")
        print(f"  Plan copied: {plan_src}")
    else:
        print(f"  ⚠ No plan found at {plan_src} — write one before training!")


class TeeLogger:
    """Write stdout to both console and a log file simultaneously."""
    def __init__(self, log_path: Path):
        self.terminal = sys.stdout
        self.log      = open(log_path, "w", buffering=1)

    def write(self, msg):
        self.terminal.write(msg)
        self.log.write(msg)

    def flush(self):
        self.terminal.flush()
        self.log.flush()

    def close(self):
        self.log.close()


def print_summary(run_dir: Path, iter_n: int, elapsed: float):
    """Print end-of-run summary pointing to all outputs."""
    results_csv = run_dir / "results.csv"
    best_pt     = run_dir / "weights" / "best.pt"

    print("\n" + "="*60)
    print(f"  ITERATION {iter_n} COMPLETE")
    print("="*60)
    print(f"  Time elapsed  : {elapsed/60:.1f} min")
    print(f"  Best weights  : {best_pt}")
    print(f"  Results CSV   : {results_csv}")
    print(f"  Config        : {run_dir}/config_iter{iter_n}.yaml")
    print(f"  Log           : {run_dir}/train_log.txt")

    # Parse best mAP from results.csv
    if results_csv.exists():
        import csv
        rows = list(csv.DictReader(open(results_csv)))
        if rows:
            # Find the column containing mAP50 for seg
            map_col = next((c for c in rows[0] if "metrics/mAP50(M)" in c
                            or "metrics/mAP50(B)" in c
                            or "mAP50" in c), None)
            if map_col:
                vals = [float(r[map_col]) for r in rows if r[map_col].strip()]
                best_map = max(vals)
                best_ep  = vals.index(best_map) + 1
                print(f"  Best mAP50    : {best_map:.4f}  (epoch {best_ep})")

    print("="*60)
    print(f"\nNext step: run validation script on {best_pt}")
    print(f"  python validate_iter.py --iter {iter_n} --weights {best_pt}")


def main():
    args    = parse_args()
    run_dir = RUNS_ROOT / f"iter{args.iter}"
    run_dir.mkdir(parents=True, exist_ok=True)

    # Start logging
    log_path = run_dir / "train_log.txt"
    logger   = TeeLogger(log_path)
    sys.stdout = logger

    print(f"\n{'='*60}")
    print(f"  YOLOv8 TRAINING — ITERATION {args.iter}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")
    print(f"  Weights  : {args.weights}")
    print(f"  Data     : {args.data}")
    print(f"  Epochs   : {args.epochs}")
    print(f"  Device   : {args.device}")

    # Save config and copy plan
    save_config(args, run_dir)
    copy_plan(args.iter, run_dir)

    # Import after config save so import errors are logged
    from ultralytics import YOLO

    model = YOLO(args.weights)

    t0 = time.time()
    try:
        results = model.train(
            data          = args.data,
            epochs        = args.epochs,
            imgsz         = args.imgsz,
            batch         = args.batch,
            device        = args.device,
            lr0           = args.lr0,
            lrf           = args.lrf,
            warmup_epochs = args.warmup_epochs,
            mosaic        = args.mosaic,
            copy_paste    = args.copy_paste,
            degrees       = args.degrees,
            fliplr        = args.fliplr,
            flipud        = args.flipud,
            hsv_v         = args.hsv_v,
            hsv_s         = args.hsv_s,
            mixup         = 0.0,          # always off for defect detection
            freeze        = args.freeze,
            dropout       = args.dropout,
            project       = str(RUNS_ROOT),
            name          = f"iter{args.iter}",
            exist_ok      = True,
            save          = True,
            plots         = True,
            verbose       = True,
        )
    except Exception as e:
        print(f"\n❌ Training failed: {e}")
        raise
    finally:
        elapsed = time.time() - t0
        print_summary(run_dir, args.iter, elapsed)
        sys.stdout = logger.terminal
        logger.close()


if __name__ == "__main__":
    main()
```

---

## Usage Examples

```bash
# Iteration 1 — baseline from pretrained
python train_iter.py --iter 1 --data data.yaml --epochs 150

# Iteration 2 — continue from best.pt, more copy_paste
python train_iter.py --iter 2 \
    --weights runs/iter1/weights/best.pt \
    --data data_v2.yaml \
    --epochs 200 \
    --copy_paste 0.5

# Iteration 3 — freeze backbone, lower LR
python train_iter.py --iter 3 \
    --weights runs/iter2/weights/best.pt \
    --epochs 100 \
    --lr0 0.001 --lrf 0.0001 \
    --freeze 10

# Grayscale model
python train_iter.py --iter 1 \
    --weights yolov8n_seg_gray.pt \
    --data data.yaml \
    --degrees 180 \
    --hsv_s 0.05 --hsv_v 0.15
```

---

## Run Directory Layout After Training

```
runs/
├── plan_iter1.md               ← plan written before this run
├── iter1/
│   ├── weights/
│   │   ├── best.pt             ← use this for validation
│   │   └── last.pt
│   ├── results.csv             ← per-epoch: loss, mAP, P, R
│   ├── train_log.txt           ← full stdout captured
│   ├── config_iter1.yaml       ← exact hyperparameters used
│   ├── plan_iter1.md           ← plan copy archived with run
│   ├── confusion_matrix.png
│   ├── PR_curve.png
│   ├── F1_curve.png
│   └── val_batch*.jpg          ← sample validation predictions
├── plan_iter2.md
├── iter2/
│   └── ...
```
