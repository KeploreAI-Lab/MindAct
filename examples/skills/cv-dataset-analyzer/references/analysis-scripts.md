# Dataset Analysis Scripts

Ready-to-run Python scripts for analyzing CV datasets. Copy and adapt based on detected format.
All scripts save charts to `/home/claude/analysis_output/` and print a summary table.

---

## Table of Contents
1. [COCO JSON](#1-coco-json)
2. [YOLO (Ultralytics)](#2-yolo-ultralytics)
3. [Pascal VOC XML](#3-pascal-voc-xml)
4. [Anomalib MVTec](#4-anomalib-mvtec)
5. [ImageFolder (Classification)](#5-imagefolder-classification)
6. [LabelMe JSON](#6-labelme-json)
7. [Generic / Unknown — Image Stats Only](#7-generic--unknown)

---

## 1. COCO JSON

```python
import json, os, random
from pathlib import Path
from collections import Counter, defaultdict
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import seaborn as sns
import numpy as np
from PIL import Image

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

# --- Find annotation files ---
ann_files = list(DATASET_ROOT.rglob("*.json"))
ann_files = [f for f in ann_files if "annotation" in f.name.lower() or "instance" in f.name.lower() or "coco" in f.name.lower()]
if not ann_files:
    ann_files = list(DATASET_ROOT.rglob("*.json"))
print(f"Found annotation files: {ann_files}")

# Load first/main annotation file (or loop over train/val/test)
splits = {}
for ann_file in ann_files:
    with open(ann_file) as f:
        data = json.load(f)
    split_name = ann_file.stem.replace("instances_", "").replace("_annotations", "")
    splits[split_name] = data

# --- Summary ---
for split, data in splits.items():
    cats = {c["id"]: c["name"] for c in data.get("categories", [])}
    anns = data.get("annotations", [])
    imgs = data.get("images", [])
    class_counts = Counter(cats[a["category_id"]] for a in anns if a["category_id"] in cats)
    ann_per_img = Counter(a["image_id"] for a in anns)
    img_sizes = [(img["width"], img["height"]) for img in imgs if "width" in img]

    print(f"\n=== Split: {split} ===")
    print(f"  Images: {len(imgs)}")
    print(f"  Annotations: {len(anns)}")
    print(f"  Classes ({len(cats)}): {list(cats.values())}")
    print(f"  Class counts: {dict(class_counts.most_common())}")
    if ann_per_img:
        vals = list(ann_per_img.values())
        print(f"  Ann/image: mean={np.mean(vals):.1f}, max={max(vals)}, images_with_0={len(imgs)-len(ann_per_img)}")
    if img_sizes:
        ws, hs = zip(*img_sizes)
        print(f"  Image W: min={min(ws)}, max={max(ws)}, median={int(np.median(ws))}")
        print(f"  Image H: min={min(hs)}, max={max(hs)}, median={int(np.median(hs))}")

    # Quality flags
    imgs_no_ann = len(imgs) - len(ann_per_img)
    small_classes = [cls for cls, cnt in class_counts.items() if cnt < 50]
    oob = sum(1 for a in anns if "bbox" in a and (
        a["bbox"][0] < 0 or a["bbox"][1] < 0 or
        a["bbox"][0] + a["bbox"][2] > next((i["width"] for i in imgs if i["id"] == a["image_id"]), 1e9) or
        a["bbox"][1] + a["bbox"][3] > next((i["height"] for i in imgs if i["id"] == a["image_id"]), 1e9)
    ))
    print(f"\n  ⚠ Quality Flags:")
    print(f"    Images with no annotations: {imgs_no_ann}")
    print(f"    Classes with < 50 samples: {small_classes}")
    print(f"    Out-of-bounds boxes (approx): {oob}")

# --- Charts (use first/largest split) ---
main_data = max(splits.values(), key=lambda d: len(d.get("annotations", [])))
cats = {c["id"]: c["name"] for c in main_data.get("categories", [])}
anns = main_data.get("annotations", [])
imgs = main_data.get("images", [])
id2img = {i["id"]: i for i in imgs}

class_counts = Counter(cats[a["category_id"]] for a in anns if a["category_id"] in cats)

# 1. Class distribution
fig, ax = plt.subplots(figsize=(max(8, len(class_counts)), 5))
classes, counts = zip(*class_counts.most_common()) if class_counts else ([], [])
colors = ["#e74c3c" if c < 50 else "#3498db" for c in counts]
ax.bar(classes, counts, color=colors)
ax.set_title("Class Distribution (red = < 50 samples)")
ax.set_xlabel("Class"); ax.set_ylabel("Instance Count")
plt.xticks(rotation=45, ha="right"); plt.tight_layout()
plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

# 2. BBox size distribution
bboxes = [a["bbox"] for a in anns if "bbox" in a]
if bboxes:
    ws = [b[2] for b in bboxes]; hs = [b[3] for b in bboxes]
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(ws, hs, alpha=0.3, s=5, color="#2ecc71")
    ax.set_title("Bounding Box Width vs Height"); ax.set_xlabel("Width (px)"); ax.set_ylabel("Height (px)")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "bbox_size_distribution.png", dpi=150); plt.close()

# 3. Annotations per image
ann_per_img = Counter(a["image_id"] for a in anns)
vals = list(ann_per_img.values())
fig, ax = plt.subplots(figsize=(8, 4))
ax.hist(vals, bins=30, color="#9b59b6", edgecolor="white")
ax.set_title("Annotations per Image"); ax.set_xlabel("Count"); ax.set_ylabel("Images")
plt.tight_layout(); plt.savefig(OUTPUT_DIR / "annotations_per_image.png", dpi=150); plt.close()

# 4. Image size scatter
img_sizes = [(i["width"], i["height"]) for i in imgs if "width" in i]
if img_sizes:
    ws, hs = zip(*img_sizes)
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.scatter(ws, hs, alpha=0.4, s=10, color="#e67e22")
    ax.set_title("Image Size Distribution"); ax.set_xlabel("Width"); ax.set_ylabel("Height")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "image_size_distribution.png", dpi=150); plt.close()

# 5. Sample grid with boxes
sample_imgs = random.sample(imgs, min(9, len(imgs)))
fig, axes = plt.subplots(3, 3, figsize=(15, 15))
img_id2anns = defaultdict(list)
for a in anns:
    img_id2anns[a["image_id"]].append(a)

img_dir = next((DATASET_ROOT / d for d in ["images", "train", "val", "."] if (DATASET_ROOT / d).exists()), DATASET_ROOT)
for ax_i, (ax, img_meta) in enumerate(zip(axes.flat, sample_imgs)):
    # Try to find image file
    img_path = None
    for root, _, files in os.walk(DATASET_ROOT):
        for f in files:
            if f == img_meta["file_name"] or f == Path(img_meta["file_name"]).name:
                img_path = Path(root) / f; break
        if img_path: break
    if img_path and img_path.exists():
        img = Image.open(img_path).convert("RGB")
        ax.imshow(img)
        for ann in img_id2anns[img_meta["id"]]:
            if "bbox" in ann:
                x, y, w, h = ann["bbox"]
                rect = patches.Rectangle((x, y), w, h, linewidth=1.5, edgecolor="#e74c3c", facecolor="none")
                ax.add_patch(rect)
                ax.text(x, y - 3, cats.get(ann["category_id"], "?"), fontsize=7, color="#e74c3c")
    ax.axis("off")
plt.suptitle("Sample Images with Annotations", fontsize=14)
plt.tight_layout(); plt.savefig(OUTPUT_DIR / "sample_grid.png", dpi=120); plt.close()

print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 2. YOLO (Ultralytics)

```python
import os, random
from pathlib import Path
from collections import Counter, defaultdict
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from PIL import Image
import yaml

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

# Load class names from yaml
yaml_file = next(DATASET_ROOT.rglob("*.yaml"), None) or next(DATASET_ROOT.rglob("*.yml"), None)
class_names = []
split_dirs = {}
if yaml_file:
    with open(yaml_file) as f:
        cfg = yaml.safe_load(f)
    class_names = cfg.get("names", [])
    if isinstance(class_names, dict):
        class_names = [class_names[i] for i in sorted(class_names)]
    for split in ["train", "val", "test"]:
        if split in cfg:
            p = Path(cfg[split]) if Path(cfg[split]).is_absolute() else DATASET_ROOT / cfg[split]
            split_dirs[split] = p
print(f"Classes: {class_names}")

# Collect all label files
all_labels = list(DATASET_ROOT.rglob("labels/**/*.txt"))
all_images = [f for f in DATASET_ROOT.rglob("images/**/*") if f.suffix.lower() in [".jpg",".jpeg",".png",".bmp"]]

# Parse annotations
class_counts = Counter()
ann_per_img = Counter()
bboxes_wh = []
img_sizes = []
imgs_no_ann = 0

for lbl_file in all_labels:
    lines = lbl_file.read_text().strip().splitlines()
    if not lines:
        imgs_no_ann += 1
        continue
    ann_per_img[lbl_file.stem] = len(lines)
    for line in lines:
        parts = line.strip().split()
        if len(parts) >= 5:
            cls_id = int(parts[0])
            cls_name = class_names[cls_id] if cls_id < len(class_names) else str(cls_id)
            class_counts[cls_name] += 1
            bboxes_wh.append((float(parts[3]), float(parts[4])))  # normalized w, h

for img_file in all_images:
    try:
        with Image.open(img_file) as im:
            img_sizes.append(im.size)
    except:
        pass

print(f"\n=== YOLO Dataset Summary ===")
print(f"  Images found: {len(all_images)}")
print(f"  Label files: {len(all_labels)}")
print(f"  Images with no annotations: {imgs_no_ann}")
print(f"  Classes: {dict(class_counts.most_common())}")
small = [c for c, n in class_counts.items() if n < 50]
print(f"  ⚠ Classes with < 50 samples: {small}")
if ann_per_img:
    vals = list(ann_per_img.values())
    print(f"  Ann/image: mean={np.mean(vals):.1f}, max={max(vals)}")

# Charts
# 1. Class distribution
if class_counts:
    fig, ax = plt.subplots(figsize=(max(8, len(class_counts)), 5))
    classes, counts = zip(*class_counts.most_common())
    colors = ["#e74c3c" if c < 50 else "#3498db" for c in counts]
    ax.bar(classes, counts, color=colors)
    ax.set_title("Class Distribution (red = < 50)"); plt.xticks(rotation=45, ha="right")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

# 2. BBox size heatmap (normalized)
if bboxes_wh:
    ws, hs = zip(*bboxes_wh)
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(ws, hs, alpha=0.2, s=5, color="#2ecc71")
    ax.set_title("BBox Size (normalized W vs H)"); ax.set_xlabel("Width (norm)"); ax.set_ylabel("Height (norm)")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "bbox_size_distribution.png", dpi=150); plt.close()

# 3. Annotations per image
if ann_per_img:
    vals = list(ann_per_img.values())
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.hist(vals, bins=30, color="#9b59b6", edgecolor="white")
    ax.set_title("Annotations per Image"); ax.set_xlabel("Count"); ax.set_ylabel("Images")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "annotations_per_image.png", dpi=150); plt.close()

# 4. Sample grid
sample_imgs = random.sample(all_images, min(9, len(all_images)))
fig, axes = plt.subplots(3, 3, figsize=(15, 15))
for ax, img_path in zip(axes.flat, sample_imgs):
    img = Image.open(img_path).convert("RGB")
    W, H = img.size
    ax.imshow(img)
    lbl_path = img_path.parent.parent / "labels" / img_path.with_suffix(".txt").name
    if not lbl_path.exists():
        # Try sibling labels dir
        lbl_path = Path(str(img_path).replace("/images/", "/labels/")).with_suffix(".txt")
    if lbl_path.exists():
        for line in lbl_path.read_text().strip().splitlines():
            parts = line.split()
            if len(parts) >= 5:
                cls_id = int(parts[0]); cx, cy, w, h = map(float, parts[1:5])
                x1 = (cx - w/2) * W; y1 = (cy - h/2) * H
                rect = patches.Rectangle((x1, y1), w*W, h*H, linewidth=1.5, edgecolor="#e74c3c", facecolor="none")
                ax.add_patch(rect)
                name = class_names[cls_id] if cls_id < len(class_names) else str(cls_id)
                ax.text(x1, y1 - 3, name, fontsize=7, color="#e74c3c")
    ax.axis("off")
plt.suptitle("Sample Images with Annotations", fontsize=14)
plt.tight_layout(); plt.savefig(OUTPUT_DIR / "sample_grid.png", dpi=120); plt.close()
print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 3. Pascal VOC XML

```python
import os, random, xml.etree.ElementTree as ET
from pathlib import Path
from collections import Counter
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from PIL import Image

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

xml_files = list(DATASET_ROOT.rglob("*.xml"))
print(f"Found {len(xml_files)} XML annotation files")

class_counts = Counter()
ann_per_img = {}
img_sizes = []
bboxes = []
corrupt = 0

for xml_file in xml_files:
    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        size = root.find("size")
        if size is not None:
            w = int(size.find("width").text); h = int(size.find("height").text)
            img_sizes.append((w, h))
        objects = root.findall("object")
        ann_per_img[xml_file.stem] = len(objects)
        for obj in objects:
            cls = obj.find("name").text.strip()
            class_counts[cls] += 1
            bndbox = obj.find("bndbox")
            if bndbox is not None:
                x1 = float(bndbox.find("xmin").text); y1 = float(bndbox.find("ymin").text)
                x2 = float(bndbox.find("xmax").text); y2 = float(bndbox.find("ymax").text)
                bboxes.append((x2-x1, y2-y1))
    except Exception as e:
        corrupt += 1

print(f"\n=== Pascal VOC Summary ===")
print(f"  XML files: {len(xml_files)} | Corrupt: {corrupt}")
print(f"  Classes: {dict(class_counts.most_common())}")
print(f"  ⚠ Classes < 50: {[c for c,n in class_counts.items() if n < 50]}")
if ann_per_img:
    vals = list(ann_per_img.values())
    print(f"  Ann/image: mean={np.mean(vals):.1f}, max={max(vals)}")

# Charts (same pattern as COCO — class dist, bbox scatter, ann/img hist, sample grid)
if class_counts:
    fig, ax = plt.subplots(figsize=(max(8, len(class_counts)), 5))
    classes, counts = zip(*class_counts.most_common())
    colors = ["#e74c3c" if c < 50 else "#3498db" for c in counts]
    ax.bar(classes, counts, color=colors)
    ax.set_title("Class Distribution"); plt.xticks(rotation=45, ha="right")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

if bboxes:
    ws, hs = zip(*bboxes)
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(ws, hs, alpha=0.3, s=5, color="#2ecc71")
    ax.set_title("BBox Size Distribution"); ax.set_xlabel("Width"); ax.set_ylabel("Height")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "bbox_size_distribution.png", dpi=150); plt.close()

print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 4. Anomalib MVTec

```python
from pathlib import Path
from collections import defaultdict, Counter
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
import random

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

# MVTec structure: category/train/good, category/test/good, category/test/<defect_type>
categories = [d for d in DATASET_ROOT.iterdir() if d.is_dir()]
if not categories:
    categories = [DATASET_ROOT]

summary = {}
for cat in categories:
    train_good = list((cat / "train" / "good").rglob("*") if (cat / "train" / "good").exists() else [])
    train_good = [f for f in train_good if f.suffix.lower() in [".png",".jpg",".jpeg",".bmp"]]
    test_dirs = cat / "test" if (cat / "test").exists() else None
    defect_counts = {}
    if test_dirs:
        for defect_dir in test_dirs.iterdir():
            if defect_dir.is_dir():
                imgs = [f for f in defect_dir.rglob("*") if f.suffix.lower() in [".png",".jpg",".jpeg"]]
                defect_counts[defect_dir.name] = len(imgs)
    summary[cat.name] = {"train_normal": len(train_good), "test": defect_counts}

print("\n=== Anomalib MVTec Summary ===")
for cat, info in summary.items():
    print(f"\n  Category: {cat}")
    print(f"    Train (normal): {info['train_normal']}")
    for defect, count in info["test"].items():
        flag = " ✅" if defect == "good" else " ⚠" if count < 20 else ""
        print(f"    Test/{defect}: {count}{flag}")

# Defect distribution chart
all_defects = Counter()
for cat, info in summary.items():
    for d, c in info["test"].items():
        if d != "good":
            all_defects[d] += c

if all_defects:
    fig, ax = plt.subplots(figsize=(max(6, len(all_defects)), 4))
    ax.bar(all_defects.keys(), all_defects.values(), color="#e74c3c")
    ax.set_title("Defect Type Distribution"); ax.set_xlabel("Defect Type"); ax.set_ylabel("Count")
    plt.xticks(rotation=45, ha="right"); plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

# Sample grid: show normal + each defect type
print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 5. ImageFolder (Classification)

```python
from pathlib import Path
from collections import Counter
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
import random

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# Detect splits
splits = {}
for d in DATASET_ROOT.iterdir():
    if d.is_dir() and d.name in ["train", "val", "test", "valid"]:
        splits[d.name] = d
if not splits:
    splits["all"] = DATASET_ROOT

class_counts_per_split = {}
for split, split_dir in splits.items():
    counts = Counter()
    for cls_dir in split_dir.iterdir():
        if cls_dir.is_dir():
            imgs = [f for f in cls_dir.rglob("*") if f.suffix.lower() in IMG_EXTS]
            counts[cls_dir.name] = len(imgs)
    class_counts_per_split[split] = counts
    total = sum(counts.values())
    print(f"\n=== Split: {split} | Total: {total} images ===")
    for cls, cnt in counts.most_common():
        bar = "█" * (cnt // max(1, total // 40))
        flag = " ⚠ (< 50)" if cnt < 50 else ""
        print(f"  {cls:30s}: {cnt:5d} {bar}{flag}")

# Chart
fig, axes = plt.subplots(1, len(class_counts_per_split), figsize=(8*len(class_counts_per_split), 5))
if len(class_counts_per_split) == 1:
    axes = [axes]
for ax, (split, counts) in zip(axes, class_counts_per_split.items()):
    classes, cnts = zip(*counts.most_common()) if counts else ([], [])
    colors = ["#e74c3c" if c < 50 else "#3498db" for c in cnts]
    ax.bar(classes, cnts, color=colors)
    ax.set_title(f"Class Distribution — {split}"); plt.setp(ax.xaxis.get_majorticklabels(), rotation=45, ha="right")
plt.tight_layout(); plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 6. LabelMe JSON

```python
import json, random
from pathlib import Path
from collections import Counter
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
from PIL import Image, ImageDraw

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

json_files = [f for f in DATASET_ROOT.rglob("*.json") if "shapes" in f.read_text()[:200]]
print(f"Found {len(json_files)} LabelMe JSON files")

class_counts = Counter()
shape_types = Counter()
ann_per_img = {}

for jf in json_files:
    with open(jf) as f:
        data = json.load(f)
    shapes = data.get("shapes", [])
    ann_per_img[jf.stem] = len(shapes)
    for s in shapes:
        class_counts[s.get("label", "?")] += 1
        shape_types[s.get("shape_type", "?")] += 1

print(f"\n=== LabelMe Summary ===")
print(f"  Files: {len(json_files)}")
print(f"  Classes: {dict(class_counts.most_common())}")
print(f"  Shape types: {dict(shape_types)}")
print(f"  ⚠ Classes < 50: {[c for c,n in class_counts.items() if n < 50]}")

if class_counts:
    fig, ax = plt.subplots(figsize=(max(8, len(class_counts)), 5))
    classes, counts = zip(*class_counts.most_common())
    colors = ["#e74c3c" if c < 50 else "#3498db" for c in counts]
    ax.bar(classes, counts, color=colors)
    ax.set_title("Class Distribution"); plt.xticks(rotation=45, ha="right")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "class_distribution.png", dpi=150); plt.close()

print(f"\n✅ Charts saved to {OUTPUT_DIR}")
```

---

## 7. Generic / Unknown

```python
from pathlib import Path
from collections import Counter
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
import random

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR = Path("/home/claude/analysis_output")
OUTPUT_DIR.mkdir(exist_ok=True)

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff"}
all_imgs = [f for f in DATASET_ROOT.rglob("*") if f.suffix.lower() in IMG_EXTS]
print(f"Total images found: {len(all_imgs)}")

sizes = []; corrupt = 0
for img_path in all_imgs:
    try:
        with Image.open(img_path) as im:
            sizes.append(im.size)
    except:
        corrupt += 1

print(f"Corrupt/unreadable: {corrupt}")
if sizes:
    ws, hs = zip(*sizes)
    print(f"Width  — min:{min(ws)}, max:{max(ws)}, median:{int(np.median(ws))}")
    print(f"Height — min:{min(hs)}, max:{max(hs)}, median:{int(np.median(hs))}")
    print(f"Unique sizes: {len(set(sizes))}")

    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(ws, hs, alpha=0.4, s=10, color="#e67e22")
    ax.set_title("Image Size Distribution"); ax.set_xlabel("Width"); ax.set_ylabel("Height")
    plt.tight_layout(); plt.savefig(OUTPUT_DIR / "image_size_distribution.png", dpi=150); plt.close()

# Sample grid — no annotations
sample = random.sample(all_imgs, min(9, len(all_imgs)))
fig, axes = plt.subplots(3, 3, figsize=(12, 12))
for ax, img_path in zip(axes.flat, sample):
    img = Image.open(img_path).convert("RGB")
    ax.imshow(img); ax.set_title(img_path.parent.name, fontsize=8); ax.axis("off")
plt.suptitle("Sample Images (No Annotations Detected)", fontsize=13)
plt.tight_layout(); plt.savefig(OUTPUT_DIR / "sample_grid.png", dpi=120); plt.close()

print(f"\n✅ Charts saved to {OUTPUT_DIR}")
print("⚠ No annotation files detected. Please confirm format or re-share the dataset.")
```
