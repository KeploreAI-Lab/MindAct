---
name: yolov8-train-loop
description: >
  Use this skill to run a full iterative training improvement loop for YOLOv8 (or YOLOv8-seg) models — from first analysis through repeated train→validate→diagnose→improve cycles until a target metric is reached. This skill is the "improve and iterate" complement to yolov8-industrial-finetune (which covers one-shot setup). Trigger this skill when the user says: "improve my model", "not reaching target accuracy", "mAP is too low", "how do I get better results", "train and keep improving", "full training pipeline", "training loop", "iterate until target", "diagnose why my model is bad", "training plan", "my model is not converging", or any time a user wants a structured repeatable improvement process rather than a single training run.
---

# YOLOv8 Iterative Training Loop

A structured, repeatable improvement cycle. Each iteration produces a written plan, trains with full logging, validates with diagnosis, and feeds findings into the next plan — until the target metric is reached or a stopping condition is met.

```
┌─────────────────────────────────────────────────┐
│           ITERATIVE TRAINING LOOP               │
│                                                 │
│  ① Write Training Plan  (this iteration's why) │
│            ↓                                    │
│  ② Dataset Analysis     (before every run)     │
│            ↓                                    │
│  ③ Train with Logging   (structured output)    │
│            ↓                                    │
│  ④ Validate & Diagnose  (per-class + curves)   │
│            ↓                                    │
│  ⑤ Analyze Results      (root cause, not just  │
│                           "mAP was X")          │
│            ↓                                    │
│  ⑥ Update Plan          (concrete next actions)│
│            ↓                                    │
│     Target reached? → STOP  else → ① again     │
└─────────────────────────────────────────────────┘
```

---

## Before Starting: Establish the Target

Always pin a concrete, measurable target before the first iteration. Never start training without one.

```
Target metric  : mAP50 ≥ 0.88  (or mAP50-95 ≥ 0.65, or per-class mAP50 ≥ 0.80 for all classes)
Max iterations : 5
Dataset        : <path>
Base model     : yolov8n-seg.pt  (or yolov8n_seg_gray.pt for grayscale)
```

If the user has not stated a target, ask: *"What mAP50 do you need for this to be production-ready?"*

---

## ① Write the Training Plan

Before each training run, write a short plan document. Save it as `runs/plan_iter<N>.md`.

**Read `references/plan-template.md`** for the exact format.

A good plan answers:
- What was the diagnosis from the previous iteration? (skip for iter 1)
- What specific change is being made this iteration, and why?
- What is the hypothesis — what do we expect to improve?
- What would falsify this hypothesis?

**Rule: never change more than 2–3 things at once.** If everything changes, you cannot diagnose what helped.

---

## ② Dataset Analysis

Run dataset analysis before every training run. Use `cv-dataset-analyzer` skill if available, otherwise run the inline script from `references/analysis-scripts.md`.

Key things to re-check each iteration:
- Class distribution — is it still balanced after any data additions?
- Annotation quality — new labels may have errors
- Image coverage — are val images representative of the failure cases seen last time?

**A common mistake**: training more epochs on a dataset with bad labels. Always re-audit labels when mAP plateaus.

---

## ③ Train with Full Logging

**Read `references/training-script.md`** for the complete training script.

The training script produces:
- `runs/iter<N>/weights/best.pt` and `last.pt`
- `runs/iter<N>/results.csv` — per-epoch metrics (loss, mAP, precision, recall)
- `runs/iter<N>/train_log.txt` — stdout captured to file for later analysis
- `runs/iter<N>/plan_iter<N>.md` — copy of the plan used for this run
- `runs/iter<N>/config_iter<N>.yaml` — exact hyperparameters used (reproducibility)

**Never lose a run.** Always increment `name=iter<N>` so every run is preserved.

---

## ④ Validate & Diagnose

**Read `references/validation-script.md`** for the full validation + diagnosis script.

The validation script produces:
- Overall metrics: mAP50, mAP50-95, precision, recall, F1
- **Per-class table**: mAP50, precision, recall for every class — this is the most important output
- Confusion matrix analysis: which classes are being confused with each other
- Failure case gallery: images where model failed (FP, FN, low-confidence TP)
- Learning curve plots: train loss, val loss, mAP over epochs

**Key diagnosis questions the script answers:**
- Is val loss still decreasing, or has it diverged from train loss? (overfitting signal)
- Which specific classes are below target?
- Are failures concentrated in specific image conditions (lighting, rotation, scale)?
- Are FPs high (too many false alarms) or FNs high (missing defects)?

---

## ⑤ Analyze Results — Diagnosis Rules

After validation, apply these diagnosis rules to decide what to change next.

**Read `references/diagnosis-rules.md`** for the full decision tree.

Quick reference:

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| All classes low mAP50 (< 0.5) | Labeling errors OR wrong model input | Audit 50 random labels; verify image normalization |
| mAP50 good overall but one class bad | Too few samples OR confusable class | Add data for that class; check if it overlaps visually with another |
| Train loss down but val mAP flat | Overfitting | Reduce epochs; add augmentation; freeze backbone |
| Val loss diverges from train loss | Overfitting | Add dropout; reduce LR; more data |
| mAP improves then plateaus early | LR too high or mosaic hurting | Lower `lrf`; try `mosaic=0.5` |
| High precision, low recall | Conf threshold too high OR model too conservative | Lower `conf`; check label coverage |
| High recall, low precision | Model too sensitive / too many FPs | Raise `conf`; check for mislabeled negatives |
| Good mAP on val, bad on real images | Val set not representative | Add real-world images to val; check domain gap |
| Loss NaN or explodes | LR too high | Lower `lr0` by 10×; check for corrupt images |

---

## ⑥ Update the Plan

Based on diagnosis, write the next iteration's plan with **specific, testable changes**.

Bad plan update: *"Train longer with better augmentation"*
Good plan update: *"Iter 3: class 'contamination' has recall=0.41. Adding 80 more contamination samples from production line batch 3. Increasing copy_paste from 0.3 to 0.5. Hypothesis: recall for contamination will reach ≥ 0.70. No other changes."*

---

## Stopping Conditions

Stop iterating when ANY of these is true:
1. ✅ Target metric reached on val set
2. ✅ Target metric reached on held-out test set (stronger signal)
3. ⛔ 3 consecutive iterations with < 0.02 mAP improvement despite different changes
4. ⛔ Dataset is exhausted (no more data available, augmentation maxed)
5. ⛔ Max iterations reached → escalate to larger model (yolov8s-seg) or re-examine problem definition

---

## Reference Files

- `references/plan-template.md` — Training plan template for each iteration. **Fill this out before every run.**
- `references/training-script.md` — Full training script with structured logging, config saving, and run versioning.
- `references/validation-script.md` — Validation + diagnosis script: per-class metrics, confusion matrix, failure gallery, learning curves.
- `references/diagnosis-rules.md` — Full decision tree for diagnosing training failures and choosing next actions.
