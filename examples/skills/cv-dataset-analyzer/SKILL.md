---
name: cv-dataset-analyzer
description: >
  Use this skill whenever a user wants to work with a computer vision dataset — even if they only mention uploading a zip file, sharing a folder link, or saying "I have a dataset". This skill handles the full pipeline: (1) ingesting data from a zip upload or download URL, (2) auto-detecting the dataset format and running visual analysis with charts and statistics, and (3) converting the dataset into the correct training format for the target model (COCO JSON, YOLO txt, Pascal VOC XML, Anomalib MVTec, etc.). Trigger this skill when the user says things like: "analyze my dataset", "I have labeled images", "here's my zip file", "check my annotations", "convert to COCO format", "prepare data for YOLOv8/Detectron2/MMDetection", "I want to train on my images", or uploads any archive file (.zip, .tar, .gz) containing images. Do NOT wait for the user to say "dataset analysis" explicitly — trigger on any sign they are preparing image/video data for model training.
---

# CV Dataset Analyzer

A three-phase skill: **Ingest → Analyze → Convert** for computer vision datasets.

---

## Phase 1: Data Ingestion

### 1A — Determine Input Source

Ask the user (if not already clear):
- Did you upload a zip/archive, or do you have a download URL?
- What CV task is this dataset for? (detection, segmentation, classification, anomaly detection, OCR, pose, tracking)

> If the user already used the `cv-task-advisor` skill, the task type is already known — skip asking.

### 1B — Handle Zip Upload

If the user uploaded a file, it will be at `/mnt/user-data/uploads/`. Run:

```bash
# List uploaded files
ls /mnt/user-data/uploads/

# Unzip to working directory
unzip /mnt/user-data/uploads/<filename>.zip -d /home/claude/dataset/
# or for tar.gz
tar -xzf /mnt/user-data/uploads/<filename>.tar.gz -C /home/claude/dataset/
```

### 1C — Handle URL Download

If the user provides a URL:

```bash
# Download
wget -O /home/claude/dataset_raw.zip "<URL>"
# or
curl -L -o /home/claude/dataset_raw.zip "<URL>"

# Then unzip
unzip /home/claude/dataset_raw.zip -d /home/claude/dataset/
```

### 1D — Auto-Detect Dataset Format

After extraction, run a tree inspection and infer the format:

```bash
find /home/claude/dataset/ -maxdepth 4 | head -60
find /home/claude/dataset/ -name "*.json" | head -5
find /home/claude/dataset/ -name "*.xml" | head -5
find /home/claude/dataset/ -name "*.txt" | head -5
find /home/claude/dataset/ -name "*.yaml" -o -name "*.yml" | head -5
```

**Format detection rules:**

| Signal | Inferred Format |
|--------|----------------|
| `annotations/instances_*.json` | COCO JSON |
| `_annotations.coco.json` | COCO JSON (Roboflow export) |
| `images/` + `labels/*.txt` with same stem | YOLO |
| `data.yaml` or `dataset.yaml` | YOLO (Ultralytics) |
| `Annotations/*.xml` + `JPEGImages/` | Pascal VOC |
| `train/good/`, `test/broken/` folder structure | Anomalib MVTec |
| Flat folders per class (class_name/image.jpg) | Classification (ImageFolder) |
| `*.json` with `"shapes"` key | LabelMe JSON |
| CSV with columns (filename, label, x, y, w, h) | Custom CSV |
| No annotations at all | Unannotated — flag to user |

Report the detected format to the user before proceeding. If ambiguous, show a sample file and ask.

---

## Phase 2: Dataset Analysis & Visualization

**Read `references/analysis-scripts.md` for the full ready-to-run Python scripts for each format.**

### 2A — Install Dependencies

```bash
pip install matplotlib seaborn pandas pillow numpy tqdm --break-system-packages -q
# For COCO format:
pip install pycocotools --break-system-packages -q
```

### 2B — Run the Analysis Script

Select the appropriate analysis script from `references/analysis-scripts.md` based on detected format. Each script produces:

1. **Dataset Summary** (printed to console):
   - Total images, total annotations
   - Train / val / test split counts
   - Class list and per-class instance counts
   - Image size distribution (min, max, median, mode)
   - Annotation count per image (mean, std, max)
   - Missing/corrupt image count

2. **Visualizations** (saved as PNGs, then shown to user):
   - `class_distribution.png` — bar chart of instances per class
   - `bbox_size_distribution.png` — scatter or heatmap of bbox width vs height (detection/segmentation)
   - `image_size_distribution.png` — scatter of image W×H
   - `annotations_per_image.png` — histogram
   - `class_imbalance.png` — highlight classes with < 50 samples
   - `sample_grid.png` — 3×3 grid of random images with annotations drawn on them

3. **Data Quality Flags**:
   - Classes with very few samples (< 50)
   - Images with no annotations
   - Duplicate filenames
   - Corrupt/unreadable images
   - Bounding boxes outside image bounds
   - Extreme aspect ratio images

### 2C — Present Results

After running:
1. Print the summary table in the conversation
2. Use `present_files` to share all generated PNG charts
3. Call out any data quality issues with specific recommendations (e.g., "Class 'scratch' has only 12 samples — consider data augmentation or collecting more")

---

## Phase 3: Format Conversion

**Read `references/conversion-scripts.md` for the full ready-to-run conversion scripts.**

### 3A — Determine Target Format

Ask (if not already known from cv-task-advisor):
- What model / framework will you train with?
- Do you need train/val/test splits, or does the dataset already have them?
- What split ratio? (default: 70/20/10)

**Target format lookup by model:**

| Model / Framework | Target Format |
|------------------|---------------|
| YOLOv8 / YOLOv9 / YOLOv10 / YOLO-NAS | YOLO (Ultralytics) |
| Detectron2 | COCO JSON |
| MMDetection / MMSegmentation | COCO JSON |
| RT-DETR | COCO JSON |
| Mask R-CNN | COCO JSON |
| Faster R-CNN (torchvision) | COCO JSON or custom |
| SegFormer / Mask2Former | COCO Panoptic or semantic masks (PNG) |
| Anomalib (PatchCore, PaDiM, etc.) | MVTec folder structure |
| PaddleOCR | PaddleOCR txt format |
| TrOCR / HuggingFace | CSV or HuggingFace Dataset |
| timm / torchvision classification | ImageFolder (class/image.jpg) |
| MediaPipe / OpenPose | COCO Keypoints JSON |
| nnU-Net | nnU-Net dataset.json format |

### 3B — Run Conversion Script

Select the appropriate conversion script from `references/conversion-scripts.md`.

Every conversion script:
1. Reads the source format
2. Generates train/val/test splits (stratified by class if classification)
3. Writes the output in the target format
4. Prints a verification summary (file counts, class counts, sample paths)
5. Saves everything to `/home/claude/dataset_converted/`

### 3C — Verify Output

After conversion:

```bash
# Verify output structure
find /home/claude/dataset_converted/ -maxdepth 4 | head -40

# For YOLO: verify a label file
head -5 /home/claude/dataset_converted/labels/train/<first_label>.txt

# For COCO: validate JSON structure
python -c "
import json
with open('/home/claude/dataset_converted/annotations/instances_train.json') as f:
    d = json.load(f)
print('Images:', len(d['images']))
print('Annotations:', len(d['annotations']))
print('Categories:', [c['name'] for c in d['categories']])
"
```

Report verification results to the user.

### 3D — Package and Deliver

```bash
# Zip the converted dataset
cd /home/claude && zip -r dataset_converted.zip dataset_converted/
cp dataset_converted.zip /mnt/user-data/outputs/
```

Use `present_files` to share the converted zip file.

Also generate a `README.md` inside the zip explaining:
- Source format → target format
- Class names and IDs
- Split counts (train/val/test)
- How to load the dataset with the target framework (a 5-line code snippet)

---

## Interaction Guidelines

- **Always confirm the detected format** before analyzing or converting — don't silently assume.
- **Show the sample grid** (`sample_grid.png`) early — it builds trust and catches errors fast.
- **Surface quality issues proactively**: don't just report them at the end.
- If the dataset is large (>10k images), warn about processing time and offer to run on a sample first.
- If the user hasn't used `cv-task-advisor` yet and the task/target model is unknown, ask before starting Phase 3.
- If source format == target format, skip conversion but still run analysis.

---

## Reference Files

- `references/analysis-scripts.md` — Ready-to-run Python analysis scripts per format (COCO, YOLO, VOC, MVTec, ImageFolder, LabelMe, CSV). **Read before writing any analysis code.**
- `references/conversion-scripts.md` — Ready-to-run Python conversion scripts for all format pairs. **Read before writing any conversion code.**
