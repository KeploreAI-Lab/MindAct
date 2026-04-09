# Training Plan Template

Fill this out before EVERY training run. Save as `runs/plan_iter<N>.md`.
Takes 5 minutes to write and saves hours of confused debugging later.

---

## Template

```markdown
# Training Plan — Iteration <N>
Date: <YYYY-MM-DD>
Author: <name>

## Target
- Overall mAP50 ≥ <value>
- Per-class minimums: <class>: ≥ <value>, <class>: ≥ <value>

## Previous Iteration Summary (skip for iter 1)
- Run: iter<N-1>
- Best mAP50: <value>  (target: <value>)
- Key findings:
  - <class X> recall was <value> — too low
  - Train/val loss gap was <value> — overfitting suspected
  - FP rate high on <condition> images

## Hypothesis for This Iteration
What specific problem are we trying to fix?
> "We believe <class X> recall is low because there are only 45 training samples.
>  Adding 60 new samples and increasing copy_paste should raise recall above 0.70."

## Changes from Previous Run
| Parameter / Action | Previous | This Run | Reason |
|--------------------|----------|----------|--------|
| copy_paste         | 0.3      | 0.5      | More synthetic defect instances |
| New data added     | 0        | 60 imgs  | Class X underrepresented |
| epochs             | 150      | 150      | No change |

**Rule: max 2–3 changes per iteration. More than that and you cannot isolate cause.**

## What Would Falsify This Hypothesis?
> "If class X recall stays below 0.60 after this run, the problem is not data quantity
>  but possibly label quality or visual ambiguity with class Y."

## Fallback if Hypothesis Fails
> "Audit all class X labels. Consider merging class X and Y if visually indistinguishable."

## Run Configuration
- Model:      yolov8n-seg.pt  (or iter<N-1>/weights/best.pt for continued training)
- Data:       data.yaml
- Epochs:     150
- imgsz:      640
- batch:      16
- Device:     cuda:0
- Run name:   iter<N>
```

---

## Example — Iteration 1 (First Run)

```markdown
# Training Plan — Iteration 1
Date: 2024-03-15

## Target
- mAP50 ≥ 0.88 overall
- Per-class: scratch ≥ 0.85, dent ≥ 0.80, contamination ≥ 0.82

## Previous Iteration Summary
N/A — first run.

## Hypothesis for This Iteration
Baseline run with default settings on the full dataset to establish a performance floor.
No specific improvement hypothesis yet — gathering data to diagnose.

## Changes from Previous Run
N/A — establishing baseline.

## What Would Falsify This Hypothesis?
N/A — this is a baseline.

## Fallback if Hypothesis Fails
N/A

## Run Configuration
- Model:   yolov8n-seg.pt
- Data:    data.yaml
- Epochs:  150
- imgsz:   640
- batch:   16
- Device:  cuda:0
- Run name: iter1
```

---

## Example — Iteration 3 (After Diagnosing Class Imbalance)

```markdown
# Training Plan — Iteration 3
Date: 2024-03-22

## Target
- mAP50 ≥ 0.88 overall
- contamination class ≥ 0.80 (was 0.51 in iter2)

## Previous Iteration Summary
- Run: iter2
- Best mAP50: 0.76 (target: 0.88)
- Key findings:
  - scratch: 0.91 ✅  dent: 0.83 ✅  contamination: 0.51 ❌
  - Confusion matrix: contamination confused with background 38% of the time
  - Dataset: contamination has only 47 training samples vs 312 for scratch
  - Val loss was stable — not overfitting

## Hypothesis for This Iteration
Contamination class has too few samples (47 vs ~300 for other classes).
Adding 80 new contamination images and enabling copy_paste=0.5 should
increase recall from 0.48 to ≥ 0.72.

## Changes from Previous Run
| Parameter         | iter2 | iter3 | Reason |
|-------------------|-------|-------|--------|
| New contamination | 0     | +80   | Fix class imbalance |
| copy_paste        | 0.2   | 0.5   | Synthesize more contamination instances |
| epochs            | 150   | 200   | More data needs more epochs |

## What Would Falsify This Hypothesis?
If contamination mAP50 stays below 0.65 after adding 80 samples,
the problem is label quality (inconsistent annotation) not quantity.
→ Fallback: audit all contamination labels with a second reviewer.

## Run Configuration
- Model:    iter2/weights/best.pt  (continue from best checkpoint)
- Data:     data_v2.yaml           (includes new contamination images)
- Epochs:   200
- copy_paste: 0.5
- Run name: iter3
```
