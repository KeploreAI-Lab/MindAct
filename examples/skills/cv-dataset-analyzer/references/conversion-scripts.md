# Dataset Conversion Scripts

Ready-to-run Python scripts for converting between CV dataset formats.
All scripts write output to `/home/claude/dataset_converted/` and include a verification summary.

---

## Table of Contents
1. [Any → YOLO (Ultralytics)](#1-any--yolo-ultralytics)
2. [Any → COCO JSON](#2-any--coco-json)
3. [Any → Pascal VOC XML](#3-any--pascal-voc-xml)
4. [Any → Anomalib MVTec](#4-any--anomalib-mvtec)
5. [Any → ImageFolder (Classification)](#5-any--imagefolder-classification)
6. [Shared Utilities: Split Helper](#6-shared-utilities)

---

## 6. Shared Utilities

Paste this at the top of any conversion script that needs train/val/test splitting.

```python
import os, shutil, random
from pathlib import Path

def split_files(file_list, train_ratio=0.7, val_ratio=0.2, seed=42):
    """Returns (train, val, test) lists."""
    random.seed(seed)
    files = list(file_list)
    random.shuffle(files)
    n = len(files)
    t = int(n * train_ratio)
    v = int(n * val_ratio)
    return files[:t], files[t:t+v], files[t+v:]

def stratified_split(class_to_files, train_ratio=0.7, val_ratio=0.2, seed=42):
    """Stratified split: splits each class separately then merges."""
    train_all, val_all, test_all = [], [], []
    for cls, files in class_to_files.items():
        tr, va, te = split_files(files, train_ratio, val_ratio, seed)
        train_all.extend([(f, cls) for f in tr])
        val_all.extend([(f, cls) for f in va])
        test_all.extend([(f, cls) for f in te])
    return train_all, val_all, test_all
```

---

## 1. Any → YOLO (Ultralytics)

### 1A. COCO JSON → YOLO

```python
import json, shutil
from pathlib import Path

# ── CONFIG ──────────────────────────────────────────────
DATASET_ROOT   = Path("/home/claude/dataset")
OUTPUT_DIR     = Path("/home/claude/dataset_converted")
# Map split name → annotation file path (adjust as needed)
SPLIT_ANN = {
    "train": DATASET_ROOT / "annotations" / "instances_train.json",
    "val":   DATASET_ROOT / "annotations" / "instances_val.json",
    # "test":  DATASET_ROOT / "annotations" / "instances_test.json",  # optional
}
IMG_ROOT = DATASET_ROOT  # root to search for images
# ────────────────────────────────────────────────────────

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
all_cats = None

for split, ann_file in SPLIT_ANN.items():
    if not ann_file.exists():
        print(f"⚠ Skipping {split} — file not found: {ann_file}"); continue

    with open(ann_file) as f:
        data = json.load(f)

    cats = {c["id"]: {"name": c["name"], "yolo_id": i} for i, c in enumerate(data["categories"])}
    if all_cats is None:
        all_cats = cats
    id2img = {img["id"]: img for img in data["images"]}
    img_id2anns = {}
    for ann in data["annotations"]:
        img_id2anns.setdefault(ann["image_id"], []).append(ann)

    (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    for img_id, img_meta in id2img.items():
        fname = Path(img_meta["file_name"]).name
        W, H = img_meta.get("width", 1), img_meta.get("height", 1)

        # Find source image
        src = None
        for root, _, files in __import__("os").walk(IMG_ROOT):
            for f in files:
                if f == fname:
                    src = Path(root) / f; break
            if src: break

        if src and src.exists():
            shutil.copy2(src, OUTPUT_DIR / "images" / split / fname)

        # Write label
        lines = []
        for ann in img_id2anns.get(img_id, []):
            if ann["category_id"] not in cats: continue
            yid = cats[ann["category_id"]]["yolo_id"]
            x, y, w, h = ann["bbox"]
            cx = (x + w / 2) / W; cy = (y + h / 2) / H
            nw = w / W; nh = h / H
            lines.append(f"{yid} {cx:.6f} {cy:.6f} {nw:.6f} {nh:.6f}")
        lbl_path = OUTPUT_DIR / "labels" / split / (Path(fname).stem + ".txt")
        lbl_path.write_text("\n".join(lines))

    print(f"✅ {split}: {len(id2img)} images processed")

# Write data.yaml
if all_cats:
    import yaml
    yaml_content = {
        "path": str(OUTPUT_DIR),
        "train": "images/train",
        "val":   "images/val",
        "nc": len(all_cats),
        "names": [all_cats[k]["name"] for k in sorted(all_cats, key=lambda x: all_cats[x]["yolo_id"])]
    }
    with open(OUTPUT_DIR / "data.yaml", "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False)
    print(f"\n✅ data.yaml written. Classes: {yaml_content['names']}")
```

### 1B. Pascal VOC → YOLO

```python
import xml.etree.ElementTree as ET, shutil
from pathlib import Path
from collections import defaultdict

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR   = Path("/home/claude/dataset_converted")
TRAIN_RATIO, VAL_RATIO = 0.7, 0.2

xml_files = list(DATASET_ROOT.rglob("*.xml"))
class_names = sorted(set(
    ET.parse(f).getroot().findall(".//object/name")[0].text.strip()
    for f in xml_files if ET.parse(f).getroot().findall(".//object/name")
))
cls2id = {n: i for i, n in enumerate(class_names)}
print(f"Classes: {class_names}")

# Split
import random; random.seed(42); random.shuffle(xml_files)
n = len(xml_files); t = int(n*TRAIN_RATIO); v = int(n*VAL_RATIO)
splits = {"train": xml_files[:t], "val": xml_files[t:t+v], "test": xml_files[t+v:]}

for split, files in splits.items():
    (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)
    for xml_file in files:
        tree = ET.parse(xml_file); root = tree.getroot()
        size = root.find("size")
        W = int(size.find("width").text); H = int(size.find("height").text)
        filename = root.find("filename").text if root.find("filename") is not None else xml_file.stem
        lines = []
        for obj in root.findall("object"):
            cls = obj.find("name").text.strip()
            bb = obj.find("bndbox")
            x1,y1,x2,y2 = float(bb.find("xmin").text),float(bb.find("ymin").text),float(bb.find("xmax").text),float(bb.find("ymax").text)
            cx=(x1+x2)/2/W; cy=(y1+y2)/2/H; w=(x2-x1)/W; h=(y2-y1)/H
            lines.append(f"{cls2id[cls]} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
        (OUTPUT_DIR/"labels"/split/(xml_file.stem+".txt")).write_text("\n".join(lines))
        # Copy image
        for ext in [".jpg",".jpeg",".png",".bmp"]:
            src = xml_file.with_suffix(ext)
            if not src.exists():
                src = xml_file.parent.parent / "JPEGImages" / (xml_file.stem + ext)
            if src.exists():
                shutil.copy2(src, OUTPUT_DIR/"images"/split/src.name); break
    print(f"✅ {split}: {len(files)} files")

import yaml
with open(OUTPUT_DIR/"data.yaml","w") as f:
    yaml.dump({"path":str(OUTPUT_DIR),"train":"images/train","val":"images/val","nc":len(class_names),"names":class_names},f)
print(f"✅ data.yaml written. Classes: {class_names}")
```

---

## 2. Any → COCO JSON

### 2A. YOLO → COCO JSON

```python
import json, shutil, yaml
from pathlib import Path
import random

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR   = Path("/home/claude/dataset_converted")

yaml_file = next(DATASET_ROOT.rglob("*.yaml"), None)
with open(yaml_file) as f:
    cfg = yaml.safe_load(f)
class_names = cfg.get("names", [])
if isinstance(class_names, dict):
    class_names = [class_names[i] for i in sorted(class_names)]
categories = [{"id": i, "name": n, "supercategory": "object"} for i, n in enumerate(class_names)]

def yolo_split_to_coco(img_dir, lbl_dir, split_name, start_img_id=1, start_ann_id=1):
    from PIL import Image as PILImage
    images, annotations = [], []
    img_id = start_img_id; ann_id = start_ann_id
    img_files = [f for f in Path(img_dir).rglob("*") if f.suffix.lower() in [".jpg",".jpeg",".png",".bmp"]]
    for img_path in img_files:
        try:
            with PILImage.open(img_path) as im:
                W, H = im.size
        except:
            continue
        images.append({"id": img_id, "file_name": img_path.name, "width": W, "height": H})
        lbl_path = Path(lbl_dir) / (img_path.stem + ".txt")
        if lbl_path.exists():
            for line in lbl_path.read_text().strip().splitlines():
                parts = line.split()
                if len(parts) < 5: continue
                cls_id = int(parts[0]); cx,cy,nw,nh = map(float, parts[1:5])
                x = (cx - nw/2)*W; y = (cy - nh/2)*H
                w = nw*W; h = nh*H
                annotations.append({"id":ann_id,"image_id":img_id,"category_id":cls_id,
                    "bbox":[round(x,2),round(y,2),round(w,2),round(h,2)],
                    "area":round(w*h,2),"iscrowd":0})
                ann_id += 1
        img_id += 1
        # Copy image
        dest = OUTPUT_DIR / "images" / split_name
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(img_path, dest / img_path.name)
    return images, annotations, img_id, ann_id

(OUTPUT_DIR / "annotations").mkdir(parents=True, exist_ok=True)
img_id = 1; ann_id = 1

for split in ["train", "val", "test"]:
    img_dir = DATASET_ROOT / "images" / split
    lbl_dir = DATASET_ROOT / "labels" / split
    if not img_dir.exists(): continue
    imgs, anns, img_id, ann_id = yolo_split_to_coco(img_dir, lbl_dir, split, img_id, ann_id)
    coco = {"info":{"description":f"Converted from YOLO — {split}"},"categories":categories,"images":imgs,"annotations":anns}
    out_path = OUTPUT_DIR / "annotations" / f"instances_{split}.json"
    with open(out_path, "w") as f:
        json.dump(coco, f, indent=2)
    print(f"✅ {split}: {len(imgs)} images, {len(anns)} annotations → {out_path}")
```

### 2B. Pascal VOC → COCO JSON

```python
import json, shutil, xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image as PILImage
import random

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR   = Path("/home/claude/dataset_converted")
TRAIN_RATIO, VAL_RATIO = 0.7, 0.2

xml_files = list(DATASET_ROOT.rglob("*.xml"))
class_names = sorted(set(
    obj.find("name").text.strip()
    for f in xml_files for obj in ET.parse(f).getroot().findall("object")
))
cls2id = {n: i for i, n in enumerate(class_names)}
categories = [{"id": i, "name": n, "supercategory": "object"} for i, n in enumerate(class_names)]

random.seed(42); random.shuffle(xml_files)
n = len(xml_files); t = int(n*TRAIN_RATIO); v = int(n*VAL_RATIO)
splits = {"train": xml_files[:t], "val": xml_files[t:t+v], "test": xml_files[t+v:]}

(OUTPUT_DIR / "annotations").mkdir(parents=True, exist_ok=True)
img_id = 1; ann_id = 1

for split, files in splits.items():
    images, annotations = [], []
    (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
    for xml_file in files:
        root = ET.parse(xml_file).getroot()
        fname = root.find("filename").text if root.find("filename") is not None else xml_file.stem+".jpg"
        size = root.find("size")
        W = int(size.find("width").text); H = int(size.find("height").text)
        images.append({"id":img_id,"file_name":fname,"width":W,"height":H})
        for obj in root.findall("object"):
            cls = obj.find("name").text.strip()
            bb = obj.find("bndbox")
            x1,y1,x2,y2 = float(bb.find("xmin").text),float(bb.find("ymin").text),float(bb.find("xmax").text),float(bb.find("ymax").text)
            w=x2-x1; h=y2-y1
            annotations.append({"id":ann_id,"image_id":img_id,"category_id":cls2id[cls],
                "bbox":[round(x1,2),round(y1,2),round(w,2),round(h,2)],"area":round(w*h,2),"iscrowd":0})
            ann_id += 1
        img_id += 1
    coco = {"categories":categories,"images":images,"annotations":annotations}
    out_path = OUTPUT_DIR/"annotations"/f"instances_{split}.json"
    with open(out_path,"w") as f: json.dump(coco,f,indent=2)
    print(f"✅ {split}: {len(images)} images, {len(annotations)} annotations")
```

---

## 3. Any → Pascal VOC XML

### COCO JSON → Pascal VOC

```python
import json, shutil, os
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR   = Path("/home/claude/dataset_converted")

ann_files = list((DATASET_ROOT/"annotations").glob("instances_*.json"))
if not ann_files:
    ann_files = list(DATASET_ROOT.rglob("*.json"))

for ann_file in ann_files:
    with open(ann_file) as f:
        data = json.load(f)
    split = ann_file.stem.replace("instances_","")
    cats = {c["id"]: c["name"] for c in data["categories"]}
    id2img = {i["id"]: i for i in data["images"]}
    img2anns = {}
    for a in data["annotations"]:
        img2anns.setdefault(a["image_id"],[]).append(a)

    out_ann = OUTPUT_DIR / split / "Annotations"; out_ann.mkdir(parents=True, exist_ok=True)
    out_img = OUTPUT_DIR / split / "JPEGImages"; out_img.mkdir(parents=True, exist_ok=True)

    for img_id, img_meta in id2img.items():
        W,H = img_meta.get("width",0), img_meta.get("height",0)
        fname = Path(img_meta["file_name"]).name

        root = Element("annotation")
        SubElement(root,"folder").text = "JPEGImages"
        SubElement(root,"filename").text = fname
        size = SubElement(root,"size")
        SubElement(size,"width").text = str(W)
        SubElement(size,"height").text = str(H)
        SubElement(size,"depth").text = "3"

        for ann in img2anns.get(img_id,[]):
            x,y,w,h = ann["bbox"]
            obj = SubElement(root,"object")
            SubElement(obj,"name").text = cats.get(ann["category_id"],"unknown")
            SubElement(obj,"difficult").text = "0"
            bb = SubElement(obj,"bndbox")
            SubElement(bb,"xmin").text = str(int(x))
            SubElement(bb,"ymin").text = str(int(y))
            SubElement(bb,"xmax").text = str(int(x+w))
            SubElement(bb,"ymax").text = str(int(y+h))

        ElementTree(root).write(out_ann/(Path(fname).stem+".xml"))

    print(f"✅ {split}: {len(id2img)} XML files written")
```

---

## 4. Any → Anomalib MVTec

```python
import shutil, random
from pathlib import Path

# Source dataset must already have some good/defect image structure
# This script reorganizes into strict MVTec format
SOURCE_GOOD  = Path("/home/claude/dataset/good")        # normal images
SOURCE_DEFECT= Path("/home/claude/dataset/defect")      # defective images (optional)
OUTPUT_DIR   = Path("/home/claude/dataset_converted")
CATEGORY     = "custom_product"
TRAIN_RATIO  = 0.8   # fraction of good images used for training

IMG_EXTS = {".png",".jpg",".jpeg",".bmp"}

good_imgs   = [f for f in SOURCE_GOOD.rglob("*") if f.suffix.lower() in IMG_EXTS] if SOURCE_GOOD.exists() else []
defect_imgs = [f for f in SOURCE_DEFECT.rglob("*") if f.suffix.lower() in IMG_EXTS] if SOURCE_DEFECT.exists() else []

random.seed(42); random.shuffle(good_imgs)
n_train = int(len(good_imgs) * TRAIN_RATIO)
train_good = good_imgs[:n_train]
test_good  = good_imgs[n_train:]

# Paths
train_good_dir  = OUTPUT_DIR / CATEGORY / "train" / "good"
test_good_dir   = OUTPUT_DIR / CATEGORY / "test"  / "good"
test_defect_dir = OUTPUT_DIR / CATEGORY / "test"  / "defect"
for d in [train_good_dir, test_good_dir, test_defect_dir]:
    d.mkdir(parents=True, exist_ok=True)

for img in train_good:  shutil.copy2(img, train_good_dir / img.name)
for img in test_good:   shutil.copy2(img, test_good_dir  / img.name)
for img in defect_imgs: shutil.copy2(img, test_defect_dir / img.name)

print(f"✅ MVTec structure created at {OUTPUT_DIR}/{CATEGORY}/")
print(f"   train/good: {len(train_good)} | test/good: {len(test_good)} | test/defect: {len(defect_imgs)}")
print(f"\nLoad with Anomalib:")
print(f"  from anomalib.data import MVTec")
print(f"  datamodule = MVTec(root='{OUTPUT_DIR}', category='{CATEGORY}')")
```

---

## 5. Any → ImageFolder (Classification)

```python
import shutil, random
from pathlib import Path
from collections import defaultdict

DATASET_ROOT = Path("/home/claude/dataset")
OUTPUT_DIR   = Path("/home/claude/dataset_converted")
TRAIN_RATIO, VAL_RATIO = 0.7, 0.2
IMG_EXTS = {".jpg",".jpeg",".png",".bmp",".webp"}

# Collect: class → [image paths]
# Assumes source is either already ImageFolder or flat with class in filename
class_to_imgs = defaultdict(list)
for cls_dir in DATASET_ROOT.iterdir():
    if cls_dir.is_dir() and cls_dir.name not in ["train","val","test","valid"]:
        imgs = [f for f in cls_dir.rglob("*") if f.suffix.lower() in IMG_EXTS]
        class_to_imgs[cls_dir.name].extend(imgs)
    elif cls_dir.name in ["train","val","test","valid"]:
        for sub_cls in cls_dir.iterdir():
            if sub_cls.is_dir():
                imgs = [f for f in sub_cls.rglob("*") if f.suffix.lower() in IMG_EXTS]
                class_to_imgs[sub_cls.name].extend(imgs)

print(f"Classes found: {list(class_to_imgs.keys())}")

random.seed(42)
for cls, imgs in class_to_imgs.items():
    random.shuffle(imgs)
    n = len(imgs); t = int(n*TRAIN_RATIO); v = int(n*VAL_RATIO)
    split_map = {"train": imgs[:t], "val": imgs[t:t+v], "test": imgs[t+v:]}
    for split, split_imgs in split_map.items():
        out = OUTPUT_DIR / split / cls
        out.mkdir(parents=True, exist_ok=True)
        for img in split_imgs:
            shutil.copy2(img, out / img.name)
    print(f"  {cls}: train={t}, val={v}, test={n-t-v}")

# Write class list
classes = sorted(class_to_imgs.keys())
(OUTPUT_DIR / "classes.txt").write_text("\n".join(classes))
print(f"\n✅ ImageFolder structure written to {OUTPUT_DIR}")
print(f"   Load with: torchvision.datasets.ImageFolder('{OUTPUT_DIR}/train')")
print(f"   Classes: {classes}")
```
