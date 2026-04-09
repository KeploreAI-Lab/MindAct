# FastAPI Server Templates

Ready-to-run Python FastAPI servers that expose model inference to HALCON via HTTP.
All servers use port 12002 and return the same JSON schema.

---

## Table of Contents
1. [YOLOv8 Detection](#1-yolov8-detection)
2. [YOLOv8 Instance Segmentation](#2-yolov8-instance-segmentation)
3. [Anomaly Detection (Anomalib PatchCore/PaDiM)](#3-anomaly-detection-anomalib)
4. [Generic PyTorch Model](#4-generic-pytorch-model)

---

## 1. YOLOv8 Detection

```python
"""
FastAPI server — YOLOv8 Object Detection
Endpoint: POST /infer_file   (multipart file upload)
Endpoint: POST /infer_base64 (base64 JSON body)
Endpoint: GET  /health
Port: 12002
"""

import time, io, base64
import numpy as np
from pathlib import Path
from PIL import Image
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH   = "yolov8n.pt"        # path to your .pt weights
CONF_THRESH  = 0.25                # confidence threshold
IOU_THRESH   = 0.45                # NMS IoU threshold
CLASS_NAMES  = None                # None = use names from model; or ["cls0","cls1",...]
PORT         = 12002
# ─────────────────────────────────────────────────────────────

from ultralytics import YOLO
model = YOLO(MODEL_PATH)
if CLASS_NAMES:
    model.names = {i: n for i, n in enumerate(CLASS_NAMES)}

app = FastAPI(title="YOLOv8 Detection API", version="1.0")


def run_inference(image: np.ndarray, filename: str = "image") -> dict:
    t0 = time.time()
    results = model(image, conf=CONF_THRESH, iou=IOU_THRESH, verbose=False)[0]
    elapsed_ms = (time.time() - t0) * 1000

    H, W = image.shape[:2]
    defects = []
    for i, box in enumerate(results.boxes):
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        cls_id   = int(box.cls[0])
        conf     = float(box.conf[0])
        cls_name = model.names.get(cls_id, str(cls_id))
        defects.append({
            "instance_id":   i,
            "class_id":      cls_id,
            "class_name":    cls_name,
            "confidence":    round(conf, 4),
            "bbox": {
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "width":  x2 - x1,
                "height": y2 - y1,
            },
            "mask_rle":      None,
            "anomaly_score": None,
        })

    return {
        "status":            "ok",
        "image_id":          filename,
        "inference_time_ms": round(elapsed_ms, 2),
        "roi":               {"x1": 0, "y1": 0, "x2": W, "y2": H},
        "defects":           defects,
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_PATH, "port": PORT}


@app.post("/infer_file")
async def infer_file(file: UploadFile = File(...)):
    """Accept multipart image upload — used by HALCON curl script."""
    data = await file.read()
    arr  = np.frombuffer(data, np.uint8)
    img  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, file.filename))


class Base64Request(BaseModel):
    image_base64: str
    filename: str = "image.png"

@app.post("/infer_base64")
async def infer_base64(req: Base64Request):
    """Accept base64-encoded image."""
    data = base64.b64decode(req.image_base64)
    arr  = np.frombuffer(data, np.uint8)
    img  = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, req.filename))


if __name__ == "__main__":
    print(f"Starting YOLOv8 Detection API on port {PORT}")
    print(f"Model: {MODEL_PATH}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
```

---

## 2. YOLOv8 Instance Segmentation

```python
"""
FastAPI server — YOLOv8 Instance Segmentation
Returns bboxes + RLE-encoded masks + polygon contours per instance.
Port: 12002
"""

import time, base64, json
import numpy as np
import cv2
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH  = "yolov8n-seg.pt"
CONF_THRESH = 0.25
IOU_THRESH  = 0.45
CLASS_NAMES = None
PORT        = 12002
# ─────────────────────────────────────────────────────────────

from ultralytics import YOLO
model = YOLO(MODEL_PATH)
if CLASS_NAMES:
    model.names = {i: n for i, n in enumerate(CLASS_NAMES)}

app = FastAPI(title="YOLOv8-seg API", version="1.0")


def mask_to_polygon(binary_mask: np.ndarray):
    """Convert binary mask to list of [x,y] polygon points."""
    contours, _ = cv2.findContours(
        binary_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    polys = []
    for cnt in contours:
        if cv2.contourArea(cnt) < 1:
            continue
        approx = cv2.approxPolyDP(cnt, 0.5, True)
        polys.append(approx.reshape(-1, 2).tolist())
    return polys


def run_inference(image: np.ndarray, filename: str = "image") -> dict:
    t0 = time.time()
    results  = model(image, conf=CONF_THRESH, iou=IOU_THRESH, verbose=False)[0]
    elapsed  = (time.time() - t0) * 1000
    H, W     = image.shape[:2]
    defects  = []

    masks_data = results.masks  # None if no detections

    for i, box in enumerate(results.boxes):
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        cls_id   = int(box.cls[0])
        conf     = float(box.conf[0])
        cls_name = model.names.get(cls_id, str(cls_id))

        # Extract polygon from mask
        polygon = []
        if masks_data is not None and i < len(masks_data.data):
            mask_np = masks_data.data[i].cpu().numpy()
            # Resize mask back to original image size
            mask_resized = cv2.resize(mask_np, (W, H), interpolation=cv2.INTER_NEAREST)
            binary = (mask_resized > 0.5).astype(np.uint8)
            polygon = mask_to_polygon(binary)

        defects.append({
            "instance_id":   i,
            "class_id":      cls_id,
            "class_name":    cls_name,
            "confidence":    round(conf, 4),
            "bbox": {
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "width":  x2 - x1,
                "height": y2 - y1,
            },
            "polygon":       polygon,   # list of [[x,y], ...] per contour
            "mask_rle":      None,
            "anomaly_score": None,
        })

    return {
        "status":            "ok",
        "image_id":          filename,
        "inference_time_ms": round(elapsed, 2),
        "roi":               {"x1": 0, "y1": 0, "x2": W, "y2": H},
        "defects":           defects,
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_PATH}


@app.post("/infer_file")
async def infer_file(file: UploadFile = File(...)):
    data = await file.read()
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, file.filename))


class Base64Request(BaseModel):
    image_base64: str
    filename: str = "image.png"

@app.post("/infer_base64")
async def infer_base64(req: Base64Request):
    data = base64.b64decode(req.image_base64)
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, req.filename))


if __name__ == "__main__":
    print(f"Starting YOLOv8-seg API on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
```

---

## 3. Anomaly Detection (Anomalib)

```python
"""
FastAPI server — Anomaly Detection via Anomalib (PatchCore, PaDiM, EfficientAD)
Returns anomaly score + pixel-level anomaly map regions.
Port: 12002
"""

import time, base64
import numpy as np
import cv2
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_CKPT   = "path/to/model.ckpt"    # Anomalib checkpoint
ANOMALY_THRESH = 0.5                   # score above this = defect
PORT         = 12002
# ─────────────────────────────────────────────────────────────

from anomalib.models import Patchcore   # swap for Padim, EfficientAd, etc.
from anomalib.deploy import TorchInferencer

inferencer = TorchInferencer(path=MODEL_CKPT)

app = FastAPI(title="Anomaly Detection API", version="1.0")


def run_inference(image: np.ndarray, filename: str = "image") -> dict:
    t0 = time.time()
    predictions = inferencer.predict(image=image)
    elapsed     = (time.time() - t0) * 1000

    score    = float(predictions.pred_score)
    amap     = predictions.anomaly_map   # H×W float32 heatmap
    H, W     = image.shape[:2]
    is_defect = score >= ANOMALY_THRESH

    # Convert anomaly map to a threshold region for HALCON
    amap_norm  = cv2.normalize(amap, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    _, binary  = cv2.threshold(amap_norm, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    defects = []
    if is_defect:
        for i, cnt in enumerate(contours):
            if cv2.contourArea(cnt) < 10:
                continue
            x, y, w, h = cv2.boundingRect(cnt)
            defects.append({
                "instance_id":   i,
                "class_id":      1,
                "class_name":    "anomaly",
                "confidence":    round(score, 4),
                "bbox": {"x1": x, "y1": y, "x2": x+w, "y2": y+h, "width": w, "height": h},
                "mask_rle":      None,
                "anomaly_score": round(score, 4),
            })

    return {
        "status":            "ok",
        "image_id":          filename,
        "inference_time_ms": round(elapsed, 2),
        "anomaly_score":     round(score, 4),
        "is_defect":         is_defect,
        "roi":               {"x1": 0, "y1": 0, "x2": W, "y2": H},
        "defects":           defects,
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_CKPT}

@app.post("/infer_file")
async def infer_file(file: UploadFile = File(...)):
    data = await file.read()
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, file.filename))

class Base64Request(BaseModel):
    image_base64: str
    filename: str = "image.png"

@app.post("/infer_base64")
async def infer_base64(req: Base64Request):
    data = base64.b64decode(req.image_base64)
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, req.filename))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
```

---

## 4. Generic PyTorch Model

```python
"""
FastAPI server — Generic PyTorch model skeleton.
Fill in the load_model() and run_model() functions with your own logic.
Port: 12002
"""

import time, base64
import numpy as np
import cv2
import torch
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH   = "model.pth"
CLASS_NAMES  = ["background", "defect"]
PORT         = 12002
DEVICE       = "cuda" if torch.cuda.is_available() else "cpu"
# ─────────────────────────────────────────────────────────────


def load_model():
    """TODO: Replace with your model loading code."""
    # Example:
    # from my_model import MyNet
    # model = MyNet()
    # model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
    # model.eval()
    # return model
    raise NotImplementedError("Fill in load_model() with your model")

model = load_model()
app = FastAPI(title="Custom Model API", version="1.0")


def run_model(image: np.ndarray) -> list:
    """
    TODO: Replace with your inference logic.
    Return a list of dicts with keys:
        class_id, class_name, confidence, x1, y1, x2, y2
    """
    raise NotImplementedError("Fill in run_model() with your inference code")


def run_inference(image: np.ndarray, filename: str = "image") -> dict:
    H, W = image.shape[:2]
    t0   = time.time()
    raw  = run_model(image)
    elapsed = (time.time() - t0) * 1000

    defects = []
    for i, det in enumerate(raw):
        x1,y1,x2,y2 = det["x1"],det["y1"],det["x2"],det["y2"]
        defects.append({
            "instance_id":   i,
            "class_id":      det.get("class_id", 0),
            "class_name":    det.get("class_name", CLASS_NAMES[det.get("class_id",0)]),
            "confidence":    round(det.get("confidence", 0.0), 4),
            "bbox":          {"x1":x1,"y1":y1,"x2":x2,"y2":y2,"width":x2-x1,"height":y2-y1},
            "mask_rle":      None,
            "anomaly_score": None,
        })

    return {
        "status":            "ok",
        "image_id":          filename,
        "inference_time_ms": round(elapsed, 2),
        "roi":               {"x1": 0, "y1": 0, "x2": W, "y2": H},
        "defects":           defects,
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_PATH, "device": DEVICE}

@app.post("/infer_file")
async def infer_file(file: UploadFile = File(...)):
    data = await file.read()
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, file.filename))

class Base64Request(BaseModel):
    image_base64: str
    filename: str = "image.png"

@app.post("/infer_base64")
async def infer_base64(req: Base64Request):
    data = base64.b64decode(req.image_base64)
    img  = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")
    return JSONResponse(run_inference(img, req.filename))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
```

---

## requirements.txt

```
fastapi>=0.110.0
uvicorn[standard]>=0.29.0
ultralytics>=8.0.0
opencv-python>=4.8.0
pillow>=10.0.0
numpy>=1.24.0
python-multipart>=0.0.9
```
