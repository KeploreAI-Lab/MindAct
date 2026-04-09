---
name: halcon-python-api-bridge
description: >
  Use this skill whenever a user wants to run a modern deep learning model (YOLOv8, YOLOv9, Detectron2, SegFormer, PatchCore, or any model HALCON does not natively support) from within a HALCON HDevelop script. This skill packages the model as a FastAPI server and provides a HALCON .hdev test script that calls the API via curl, parses the JSON response, and displays results (bounding boxes, masks, keypoints) in the HALCON window. Trigger this skill when the user says: "use YOLOv8 from HALCON", "call a Python model from HALCON", "HALCON doesn't support this model", "bridge HALCON and PyTorch", "wrap model as API for HALCON", "infer from HDevelop", or whenever the user wants to integrate a non-HALCON model into a HALCON inspection pipeline. Always use port 12002 for the first service (per port-conventions skill).
---

# HALCON ↔ Python Model API Bridge

Packages any Python/PyTorch model as a FastAPI server so HALCON can call it via `curl` + `system_call`, parse the JSON response, and display results natively in HDevelop.

---

## Architecture Overview

```
HDevelop Script
  │
  │  system_call("curl -X POST http://127.0.0.1:12002/infer_file ...")
  │
  ▼
FastAPI Server (Python)          ← THIS SKILL BUILDS THIS
  ├── POST /infer_file           ← accepts multipart image upload
  ├── POST /infer_base64         ← accepts base64-encoded image
  ├── GET  /health               ← liveness check
  └── Model (YOLOv8 / any)
        └── returns JSON: { "defects": [...], "roi": {...} }
  │
  ▼
HDevelop parses JSON with read_dict()
draws rectangles / regions / text on image
```

---

## Phase 1: Identify the Model & Task

Ask the user (if not already clear from context):
1. What model do you want to serve? (YOLOv8n-seg, YOLOv8n, PatchCore, custom PyTorch, etc.)
2. What task? (detection / instance segmentation / anomaly / classification)
3. What is the path to the model weights? (`.pt`, `.pth`, `.onnx`)
4. What should the API response contain? (bboxes, masks, confidence, class names, anomaly score)
5. Windows or Linux for the HALCON machine? (affects curl path in .hdev)

Based on task → select the right API template from `references/api-servers.md`.

---

## Phase 2: Build the FastAPI Server

**Read `references/api-servers.md`** for ready-to-run server templates.

Available templates:
| Template | Use for |
|----------|---------|
| `yolov8-detection` | YOLOv8 / YOLOv9 / YOLOv10 detection `.pt` |
| `yolov8-segmentation` | YOLOv8-seg instance segmentation `.pt` |
| `anomaly-patchcore` | Anomalib PatchCore / PaDiM anomaly detection |
| `generic-pytorch` | Any custom `torch.nn.Module` — user fills inference logic |

### Response JSON Contract

All templates return the **same JSON schema** so the HALCON script stays consistent:

```json
{
  "status": "ok",
  "image_id": "filename.png",
  "inference_time_ms": 23.4,
  "roi": { "x1": 0, "y1": 0, "x2": 1920, "y2": 1080 },
  "defects": [
    {
      "instance_id": 0,
      "class_id": 1,
      "class_name": "scratch",
      "confidence": 0.91,
      "bbox": { "x1": 120, "y1": 80, "x2": 240, "y2": 160,
                "width": 120, "height": 80 },
      "mask_rle": null,
      "anomaly_score": null
    }
  ]
}
```

> Keep this schema stable — HALCON parses it with `get_dict_tuple` and changes break the .hdev script.

### Running the Server

```bash
# Install deps
pip install fastapi uvicorn ultralytics opencv-python pillow numpy --break-system-packages

# Run
python api_server.py
# Server starts on http://0.0.0.0:12002
```

Always use **port 12002** as default (12003, 12004 for additional services).

---

## Phase 3: Generate the HALCON Test Script

**Read `references/halcon-test-scripts.md`** for ready-to-use `.hdev` templates.

Available HALCON scripts:
| Script | Visualizes |
|--------|-----------|
| `test-detection.hdev` | Bounding boxes + class label + confidence |
| `test-segmentation.hdev` | Bounding boxes + filled mask region overlay |
| `test-anomaly.hdev` | Anomaly score text + heatmap region |
| `test-batch.hdev` | Loops over a folder of images |

### How the HALCON Script Works (Pattern)
1. Read image with `read_image`
2. Build curl command string with image path
3. `system_call(CurlCmd)` → writes JSON to a temp file
4. `read_dict(JsonPath, ...)` → parses JSON into HALCON dict
5. Loop over `defects` tuple → extract bbox / confidence / class
6. `gen_rectangle1(Rect, Y1, X1, Y2, X2)` → draw on window
7. `disp_message` → show class name + confidence

---

## Phase 4: Deliver Both Files

1. Save `api_server.py` to `/mnt/user-data/outputs/`
2. Save `test_api_client.hdev` to `/mnt/user-data/outputs/`
3. Save `requirements.txt` to `/mnt/user-data/outputs/`
4. Use `present_files` to share all three

Also print setup instructions:
```
1. pip install -r requirements.txt
2. python api_server.py          ← keep this terminal open
3. Open test_api_client.hdev in HDevelop
4. Edit ImagePath at the top
5. Press F5
```

---

## Reference Files

- `references/api-servers.md` — FastAPI server templates for YOLOv8 detection, YOLOv8-seg, anomaly detection, and generic PyTorch. **Read before writing any server code.**
- `references/halcon-test-scripts.md` — HDevelop test script templates for detection, segmentation, anomaly, and batch modes. **Read before writing any .hdev code.**
