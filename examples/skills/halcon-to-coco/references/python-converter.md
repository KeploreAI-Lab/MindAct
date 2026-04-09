# Python Converter Scripts

These scripts take the output of the HALCON `.hdev` export script and assemble
standard open-source dataset formats. Run them after the HALCON export step.

---

## Table of Contents
1. [Masks + CSV → COCO JSON (Instance Segmentation)](#1-masks--csv--coco-json)
2. [Masks + CSV → COCO JSON (Detection — bbox only)](#2-masks--csv--coco-detection)
3. [Masks + CSV → YOLO Segmentation](#3-masks--csv--yolo-segmentation)
4. [Masks + CSV → YOLO Detection](#4-masks--csv--yolo-detection)
5. [Verification & Quick-Load Snippets](#5-verification--quick-load)

---

## 1. Masks + CSV → COCO JSON (Instance Segmentation)

Full COCO format with polygon segmentation masks. Use for Detectron2, MMDetection, RT-DETR, Mask R-CNN.

```python
"""
HALCON export → COCO Instance Segmentation JSON
Input layout (produced by halcon-export-script.hdev):
    <export_root>/
        images/train/*.png
        images/val/*.png
        masks/train/<name>_id_<ID>_inst0<j>_label_<lid>.png
        masks/val/...
        meta_train.csv   (columns: image_file, mask_file, class_id)
        meta_val.csv
"""

import csv, json, shutil, cv2
import numpy as np
from pathlib import Path
from collections import defaultdict

# ── USER CONFIG ──────────────────────────────────────────────
EXPORT_ROOT = Path("/home/claude/halcon_export")   # root of HALCON export
OUTPUT_DIR  = Path("/home/claude/coco_output")     # where to write COCO dataset

# Class names keyed by integer class_id from HALCON
# Edit to match your actual class IDs and names
CLASS_NAMES = {
    0: "background",
    1: "defect",
    2: "scratch",
    # add more as needed ...
}
# ────────────────────────────────────────────────────────────

def mask_to_polygons(mask_path: Path):
    """Read a binary mask PNG and return list of COCO polygon lists + bbox + area."""
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        return [], [0, 0, 0, 0], 0
    binary = (mask > 127).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons = []
    for cnt in contours:
        if cv2.contourArea(cnt) < 1:
            continue
        # Simplify slightly to reduce point count
        epsilon = 0.5
        approx = cv2.approxPolyDP(cnt, epsilon, True)
        if len(approx) < 3:
            continue
        poly = approx.flatten().tolist()
        polygons.append(poly)

    area = int(np.sum(binary))
    ys, xs = np.where(binary > 0)
    if len(xs) == 0:
        return polygons, [0, 0, 0, 0], area
    x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    bbox = [x1, y1, x2 - x1, y2 - y1]  # COCO format: [x, y, w, h]
    return polygons, bbox, area


def parse_mask_filename(mask_file: Path):
    """Extract image_id and instance_index from mask filename convention:
       <basename>_id_<ImageID>_inst0<j>_label_<label_id>.png
    """
    stem = mask_file.stem  # strip .png
    # Extract image_id
    id_marker = "_id_"
    inst_marker = "_inst0"
    label_marker = "_label_"
    try:
        id_start = stem.index(id_marker) + len(id_marker)
        inst_start = stem.index(inst_marker)
        image_id_str = stem[id_start:inst_start]

        inst_end = stem.index(label_marker)
        inst_str = stem[inst_start + len(inst_marker):inst_end]

        label_start = stem.index(label_marker) + len(label_marker)
        label_str = stem[label_start:]

        return int(image_id_str), int(inst_str), int(label_str)
    except (ValueError, IndexError):
        return None, None, None


def build_coco(meta_csv: Path, split: str, categories, img_id_offset=0, ann_id_offset=0):
    """Build COCO dict from a meta CSV file."""
    images = []
    annotations = []
    img_id_counter = img_id_offset
    ann_id_counter = ann_id_offset

    # Group mask files by image_file
    img_to_masks = defaultdict(list)
    with open(meta_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            img_to_masks[row["image_file"]].append({
                "mask_file": row["mask_file"],
                "class_id": int(row["class_id"])
            })

    out_img_dir = OUTPUT_DIR / "images" / split
    out_img_dir.mkdir(parents=True, exist_ok=True)

    seen_imgs = {}  # img_path → assigned img_id

    for img_path_str, mask_entries in img_to_masks.items():
        img_path = Path(img_path_str)
        if not img_path.exists():
            print(f"  ⚠ Image not found: {img_path}")
            continue

        # Assign image ID (stable across entries for same image)
        if img_path_str not in seen_imgs:
            img_id_counter += 1
            seen_imgs[img_path_str] = img_id_counter

            img = cv2.imread(str(img_path))
            if img is None:
                print(f"  ⚠ Cannot read image: {img_path}")
                continue
            H, W = img.shape[:2]

            images.append({
                "id": img_id_counter,
                "file_name": img_path.name,
                "width": W,
                "height": H
            })
            shutil.copy2(img_path, out_img_dir / img_path.name)

        img_id = seen_imgs[img_path_str]

        for entry in mask_entries:
            mask_path = Path(entry["mask_file"])
            class_id = entry["class_id"]

            if not mask_path.exists():
                print(f"  ⚠ Mask not found: {mask_path}")
                continue

            polygons, bbox, area = mask_to_polygons(mask_path)
            if not polygons or area == 0:
                continue

            ann_id_counter += 1
            annotations.append({
                "id": ann_id_counter,
                "image_id": img_id,
                "category_id": class_id,
                "segmentation": polygons,
                "bbox": bbox,
                "area": area,
                "iscrowd": 0
            })

    return {
        "info": {"description": f"Converted from HALCON .hdict — {split}", "version": "1.0"},
        "licenses": [],
        "categories": categories,
        "images": images,
        "annotations": annotations
    }, img_id_counter, ann_id_counter


# ── Main ─────────────────────────────────────────────────────
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "annotations").mkdir(exist_ok=True)

pip_check = __import__("subprocess").run(
    ["pip", "install", "opencv-python", "numpy", "--break-system-packages", "-q"],
    capture_output=True
)

# Build categories list
categories = [
    {"id": cid, "name": name, "supercategory": "object"}
    for cid, name in sorted(CLASS_NAMES.items())
    if cid != 0  # skip background
]

img_id = 0; ann_id = 0

for split, csv_name in [("train", "meta_train.csv"), ("val", "meta_val.csv")]:
    meta_csv = EXPORT_ROOT / csv_name
    if not meta_csv.exists():
        print(f"⚠ {csv_name} not found, skipping {split}")
        continue

    print(f"\nProcessing {split}...")
    coco_dict, img_id, ann_id = build_coco(meta_csv, split, categories, img_id, ann_id)

    out_path = OUTPUT_DIR / "annotations" / f"instances_{split}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(coco_dict, f, indent=2, ensure_ascii=False)

    print(f"  ✅ {split}: {len(coco_dict['images'])} images, "
          f"{len(coco_dict['annotations'])} annotations → {out_path}")

print(f"\n✅ COCO dataset written to {OUTPUT_DIR}")
print(f"   Categories: {[c['name'] for c in categories]}")
```

---

## 2. Masks + CSV → COCO Detection

Bounding-box only COCO — use when you don't need pixel masks (faster R-CNN, RT-DETR, YOLOv8 detection mode).

```python
"""
Same as script 1 but omits segmentation polygons.
Produces a clean COCO detection JSON (segmentation field is empty list).
"""

import csv, json, shutil, cv2
import numpy as np
from pathlib import Path
from collections import defaultdict

EXPORT_ROOT = Path("/home/claude/halcon_export")
OUTPUT_DIR  = Path("/home/claude/coco_detection_output")
CLASS_NAMES = {1: "defect", 2: "scratch"}   # ← edit

def mask_to_bbox_area(mask_path):
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None: return [0,0,0,0], 0
    binary = (mask > 127).astype(np.uint8)
    ys, xs = np.where(binary > 0)
    if len(xs) == 0: return [0,0,0,0], 0
    x1,y1,x2,y2 = int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())
    return [x1, y1, x2-x1, y2-y1], int(np.sum(binary))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "annotations").mkdir(exist_ok=True)
categories = [{"id":cid,"name":n,"supercategory":"object"} for cid,n in sorted(CLASS_NAMES.items())]
img_id=0; ann_id=0

for split, csv_name in [("train","meta_train.csv"),("val","meta_val.csv")]:
    meta_csv = EXPORT_ROOT / csv_name
    if not meta_csv.exists(): continue
    out_img_dir = OUTPUT_DIR/"images"/split; out_img_dir.mkdir(parents=True, exist_ok=True)
    images=[]; annotations=[]; seen={}
    with open(meta_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            img_path = Path(row["image_file"])
            if str(img_path) not in seen:
                img_id+=1; seen[str(img_path)]=img_id
                img=cv2.imread(str(img_path))
                if img is None: continue
                H,W=img.shape[:2]
                images.append({"id":img_id,"file_name":img_path.name,"width":W,"height":H})
                shutil.copy2(img_path, out_img_dir/img_path.name)
            bbox, area = mask_to_bbox_area(Path(row["mask_file"]))
            if area==0: continue
            ann_id+=1
            annotations.append({"id":ann_id,"image_id":seen[str(img_path)],
                "category_id":int(row["class_id"]),"segmentation":[],
                "bbox":bbox,"area":area,"iscrowd":0})
    coco={"categories":categories,"images":images,"annotations":annotations}
    out=OUTPUT_DIR/"annotations"/f"instances_{split}.json"
    with open(out,"w") as f: json.dump(coco,f,indent=2)
    print(f"✅ {split}: {len(images)} imgs, {len(annotations)} anns → {out}")
```

---

## 3. Masks + CSV → YOLO Segmentation

Produces YOLO `.txt` files with normalized polygon contours + `data.yaml`. Use for YOLOv8-seg / YOLOv9-seg.

```python
import csv, cv2
import numpy as np
from pathlib import Path
import shutil, yaml
from collections import defaultdict

EXPORT_ROOT = Path("/home/claude/halcon_export")
OUTPUT_DIR  = Path("/home/claude/yolo_seg_output")
CLASS_NAMES = {1: "defect", 2: "scratch"}   # ← edit (0-indexed for YOLO)
# Remap HALCON class IDs to 0-based YOLO IDs
HALCON_TO_YOLO = {hid: i for i, hid in enumerate(sorted(CLASS_NAMES.keys()))}

def mask_to_yolo_polygon(mask_path, W, H):
    """Returns list of normalized [x y x y ...] polygon strings."""
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None: return []
    binary = (mask > 127).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    results = []
    for cnt in contours:
        if cv2.contourArea(cnt) < 1: continue
        approx = cv2.approxPolyDP(cnt, 0.5, True)
        if len(approx) < 3: continue
        pts = approx.reshape(-1, 2)
        normed = " ".join(f"{x/W:.6f} {y/H:.6f}" for x,y in pts)
        results.append(normed)
    return results

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
for split in ["train","val"]:
    (OUTPUT_DIR/"images"/split).mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR/"labels"/split).mkdir(parents=True, exist_ok=True)

for split, csv_name in [("train","meta_train.csv"),("val","meta_val.csv")]:
    meta_csv = EXPORT_ROOT / csv_name
    if not meta_csv.exists(): continue
    img_to_rows = defaultdict(list)
    with open(meta_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            img_to_rows[row["image_file"]].append(row)

    for img_path_str, rows in img_to_rows.items():
        img_path = Path(img_path_str)
        img = cv2.imread(str(img_path))
        if img is None: continue
        H, W = img.shape[:2]
        shutil.copy2(img_path, OUTPUT_DIR/"images"/split/img_path.name)
        label_lines = []
        for row in rows:
            cls_id = int(row["class_id"])
            yolo_id = HALCON_TO_YOLO.get(cls_id, 0)
            for poly_str in mask_to_yolo_polygon(Path(row["mask_file"]), W, H):
                label_lines.append(f"{yolo_id} {poly_str}")
        lbl_path = OUTPUT_DIR/"labels"/split/(img_path.stem+".txt")
        lbl_path.write_text("\n".join(label_lines))
    print(f"✅ {split}: {len(img_to_rows)} images processed")

# Write data.yaml
yolo_class_names = [CLASS_NAMES[k] for k in sorted(CLASS_NAMES.keys())]
with open(OUTPUT_DIR/"data.yaml","w") as f:
    yaml.dump({
        "path": str(OUTPUT_DIR),
        "train": "images/train",
        "val": "images/val",
        "nc": len(yolo_class_names),
        "names": yolo_class_names
    }, f, default_flow_style=False)
print(f"✅ data.yaml written. Classes: {yolo_class_names}")
print(f"   Train with: yolo segment train data={OUTPUT_DIR}/data.yaml model=yolov8m-seg.pt")
```

---

## 4. Masks + CSV → YOLO Detection

Produces YOLO `.txt` files with bounding boxes only. Use for YOLOv8 / YOLOv9 / YOLOv10 detection.

```python
import csv, cv2
import numpy as np
from pathlib import Path
import shutil, yaml
from collections import defaultdict

EXPORT_ROOT = Path("/home/claude/halcon_export")
OUTPUT_DIR  = Path("/home/claude/yolo_det_output")
CLASS_NAMES = {1: "defect", 2: "scratch"}   # ← edit
HALCON_TO_YOLO = {hid: i for i, hid in enumerate(sorted(CLASS_NAMES.keys()))}

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
for split in ["train","val"]:
    (OUTPUT_DIR/"images"/split).mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR/"labels"/split).mkdir(parents=True, exist_ok=True)

for split, csv_name in [("train","meta_train.csv"),("val","meta_val.csv")]:
    meta_csv = EXPORT_ROOT / csv_name
    if not meta_csv.exists(): continue
    img_to_rows = defaultdict(list)
    with open(meta_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            img_to_rows[row["image_file"]].append(row)

    for img_path_str, rows in img_to_rows.items():
        img_path = Path(img_path_str)
        img = cv2.imread(str(img_path))
        if img is None: continue
        H, W = img.shape[:2]
        shutil.copy2(img_path, OUTPUT_DIR/"images"/split/img_path.name)
        label_lines = []
        for row in rows:
            mask = cv2.imread(str(row["mask_file"]), cv2.IMREAD_GRAYSCALE)
            if mask is None: continue
            binary = (mask > 127).astype(np.uint8)
            ys, xs = np.where(binary > 0)
            if len(xs) == 0: continue
            x1,y1,x2,y2 = xs.min(),ys.min(),xs.max(),ys.max()
            cx=(x1+x2)/2/W; cy=(y1+y2)/2/H; w=(x2-x1)/W; h=(y2-y1)/H
            yolo_id = HALCON_TO_YOLO.get(int(row["class_id"]), 0)
            label_lines.append(f"{yolo_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
        (OUTPUT_DIR/"labels"/split/(img_path.stem+".txt")).write_text("\n".join(label_lines))
    print(f"✅ {split}: {len(img_to_rows)} images processed")

yolo_class_names = [CLASS_NAMES[k] for k in sorted(CLASS_NAMES.keys())]
with open(OUTPUT_DIR/"data.yaml","w") as f:
    yaml.dump({
        "path": str(OUTPUT_DIR),
        "train": "images/train",
        "val": "images/val",
        "nc": len(yolo_class_names),
        "names": yolo_class_names
    }, f, default_flow_style=False)
print(f"✅ data.yaml written.")
print(f"   Train with: yolo detect train data={OUTPUT_DIR}/data.yaml model=yolov8m.pt")
```

---

## 5. Verification & Quick-Load Snippets

### Verify COCO JSON

```python
import json
from pathlib import Path

OUTPUT_DIR = Path("/home/claude/coco_output")

for split in ["train", "val"]:
    ann_file = OUTPUT_DIR / "annotations" / f"instances_{split}.json"
    if not ann_file.exists():
        print(f"⚠ Missing: {ann_file}"); continue
    with open(ann_file) as f:
        d = json.load(f)
    print(f"\n=== {split} ===")
    print(f"  Images     : {len(d['images'])}")
    print(f"  Annotations: {len(d['annotations'])}")
    print(f"  Categories : {[c['name'] for c in d['categories']]}")
    # Check for annotations without matching image
    img_ids = {i["id"] for i in d["images"]}
    orphan = [a for a in d["annotations"] if a["image_id"] not in img_ids]
    print(f"  Orphan anns: {len(orphan)}")
    # Check for empty segmentations
    empty_seg = [a for a in d["annotations"] if not a.get("segmentation")]
    print(f"  Empty segs : {len(empty_seg)}")
```

### Load in Detectron2

```python
from detectron2.data.datasets import register_coco_instances
register_coco_instances(
    "my_dataset_train", {},
    "/home/claude/coco_output/annotations/instances_train.json",
    "/home/claude/coco_output/images/train"
)
register_coco_instances(
    "my_dataset_val", {},
    "/home/claude/coco_output/annotations/instances_val.json",
    "/home/claude/coco_output/images/val"
)
```

### Load in MMDetection

```python
# In your config file:
data = dict(
    train=dict(
        type='CocoDataset',
        ann_file='/home/claude/coco_output/annotations/instances_train.json',
        img_prefix='/home/claude/coco_output/images/train/',
    ),
    val=dict(
        type='CocoDataset',
        ann_file='/home/claude/coco_output/annotations/instances_val.json',
        img_prefix='/home/claude/coco_output/images/val/',
    )
)
```

### Load in Ultralytics YOLOv8

```python
from ultralytics import YOLO
model = YOLO("yolov8m-seg.pt")  # or yolov8m.pt for detection
model.train(data="/home/claude/yolo_seg_output/data.yaml", epochs=100, imgsz=640)
```
