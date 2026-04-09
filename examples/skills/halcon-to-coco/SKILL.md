---
name: halcon-to-coco
description: >
  Use this skill whenever a user has a dataset labeled with HALCON Deep Learning Tool (.hdict format) and wants to convert it to an open-source training format. This skill covers the full pipeline: (1) understanding the user's HALCON .hdict dataset structure, (2) choosing the right approach — either running the provided HALCON export script (.hdev) directly in HDevelop, or using the Python fallback that reads the .hdict file and converts it without HALCON installed, (3) converting to COCO JSON (instance segmentation / detection), YOLO, or other open-source formats. Trigger this skill when the user mentions: "HALCON dataset", "hdict file", "HDevelop", "HALCON Deep Learning Tool", "export from HALCON", "convert .hdict", "HALCON annotations", or any reference to MVTec HALCON in the context of training data. Also trigger when the user uploads a .hdev or .hdict file.
---

# HALCON Dataset → Open-Source Format Converter

Converts datasets labeled with **HALCON Deep Learning Tool** (stored as `.hdict`) into COCO JSON, YOLO, or other open-source formats suitable for training with PyTorch-based frameworks.

---

## Understanding HALCON Dataset Structure

A HALCON Deep Learning dataset `.hdict` file contains:

```
Dict
├── image_dir          (string)  — base path to image files
├── class_ids          (tuple)   — integer class IDs
├── class_names        (tuple)   — string class names
└── samples            (tuple of dicts), each sample:
    ├── image_id       (int)     — unique image ID
    ├── image_file_name (string) — relative or absolute path to image
    ├── split          (string)  — 'train' or 'validation'
    ├── bbox_label_id  (tuple)   — label IDs for each instance
    └── mask           (region object) — HALCON region per instance (for segmentation)
        OR bbox_row1/col1/row2/col2     — bounding box coordinates (for detection)
```

The `.hdev` script (HDevelop procedure) reads this dict, iterates samples, exports images as PNG, and writes per-instance binary mask PNGs + a CSV metadata file.

---

## Phase 1: Identify Input & Requirements

Ask the user:
1. Do you have HALCON (HDevelop) installed on your machine?
2. What is the task type? (instance segmentation, object detection, classification, anomaly detection)
3. What is the target training framework? (YOLOv8, Detectron2/MMDetection, other)
4. Do you have the `.hdict` file accessible? What OS / path?

Based on answers, choose approach:

| Has HALCON installed? | Approach |
|----------------------|----------|
| Yes | **Path A** — Run HALCON `.hdev` script in HDevelop to export images + masks, then run Python to assemble COCO JSON |
| No | **Path B** — Pure Python: parse `.hdict` using `halcon` Python binding or the intermediate CSV/PNG export |

> If they already ran the HALCON script and have the `images/`, `masks/` folders + `meta_train.csv` / `meta_val.csv` — jump straight to **Step 3: Python Assembly**.

---

## Phase 2A: HALCON Script (Path A — HDevelop)

Read `references/halcon-export-script.hdev` — this is the ready-to-use HDevelop script.

**Instruct the user to:**
1. Open HDevelop
2. Open the `.hdev` script from `references/halcon-export-script.hdev`
3. Edit the CONFIG block at the top (lines marked `* ── USER CONFIG ──`):
   - `HdictPath` — full path to their `.hdict` file
   - `ImageDir` — path to the folder containing the original images (if not embedded in hdict)
   - `OutRoot` — where to write the export (e.g. `C:/export/my_dataset`)
4. Press **Run** (F5)
5. When done, share the `OutRoot` folder or zip it up

The script exports:
- `images/train/*.png` and `images/val/*.png`
- `masks/train/<basename>_id_<N>_inst0<j>_label_<lid>.png` — one binary mask PNG per instance
- `meta_train.csv` and `meta_val.csv` — CSV with columns: `image_file, mask_file, class_id`

Once export is complete → proceed to Step 3.

---

## Phase 2B: Python-Only Path (No HALCON)

If the user cannot run HDevelop, use the `halconpy` binding (requires HALCON runtime):

```bash
pip install halconpy --break-system-packages -q  # needs HALCON runtime installed
```

If that's also unavailable, ask the user to export the `.hdict` as a `.mat` or intermediary format from within HALCON, or provide the raw image folder + a CSV/JSON they can hand-export from the HALCON DL Tool UI.

> For most users, Path A is simpler. Recommend it first.

---

## Phase 3: Python Assembly → Target Format

**Read `references/python-converter.md`** for the full ready-to-run Python scripts.

### 3A. Masks + CSV → COCO JSON (Instance Segmentation)

This is the primary conversion path after running the HALCON export script.

Input:
- `images/train/` and `images/val/`
- `masks/train/` and `masks/val/` (binary PNG per instance)
- `meta_train.csv` and `meta_val.csv`

Output:
- `coco_output/images/train/` (copied images)
- `coco_output/images/val/`
- `coco_output/annotations/instances_train.json`
- `coco_output/annotations/instances_val.json`

The Python script:
1. Reads each CSV row → gets `(image_file, mask_file, class_id)`
2. Groups mask files by image
3. For each mask PNG: thresholds to binary, extracts contours using OpenCV → polygon points
4. Computes bounding box from the mask
5. Computes area from pixel count
6. Assembles standard COCO JSON structure

### 3B. Masks + CSV → YOLO (Object Detection / Segmentation)

For YOLO detection: derives bounding boxes from mask extents.
For YOLO segmentation: converts mask contours to normalized polygon points.

### 3C. Output Verification

After conversion, always verify:
```bash
python -c "
import json
for split in ['train', 'val']:
    with open(f'coco_output/annotations/instances_{split}.json') as f:
        d = json.load(f)
    print(f'{split}: {len(d[\"images\"])} images, {len(d[\"annotations\"])} anns, classes={[c[\"name\"] for c in d[\"categories\"]]}')
"
```

---

## Phase 4: Package & Deliver

```bash
cd /home/claude
zip -r halcon_converted.zip coco_output/
cp halcon_converted.zip /mnt/user-data/outputs/
```

Use `present_files` to share the zip. Also generate a `README.md` inside the zip with:
- Source: HALCON .hdict → COCO JSON
- Class names and IDs
- Split counts
- How to load with Detectron2 / MMDetection / Ultralytics

---

## Reference Files

- `references/halcon-export-script.hdev` — Clean, parameterized HDevelop script the user runs in HDevelop. Based on the original script with a clear CONFIG block. **Share this file with the user for Path A.**
- `references/python-converter.md` — Full Python scripts: masks+CSV→COCO JSON, masks+CSV→YOLO, plus verification code. **Read before writing any Python conversion code.**
