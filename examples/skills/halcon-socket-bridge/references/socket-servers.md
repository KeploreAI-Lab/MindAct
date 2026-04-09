# Python Socket Server Templates

Raw TCP socket servers that receive image bytes from HALCON and return inference results
as compact space-delimited text. No HTTP, no disk I/O, no JSON — just bytes.

---

## Table of Contents
1. [YOLOv8 Detection — Grayscale 640×640](#1-yolov8-detection--grayscale-640640)
2. [YOLOv8 Instance Segmentation — Grayscale 640×640](#2-yolov8-segmentation--grayscale-640640)
3. [YOLOv8 Detection — RGB Variable Size](#3-yolov8-detection--rgb-variable-size)
4. [Generic PyTorch Skeleton](#4-generic-pytorch-skeleton)

---

## Wire Protocol (all servers)

```
Client → Server:
  [4 bytes big-endian uint32]  image byte length N
  [N bytes]                    raw pixel data (uint8, row-major)

Server → Client:
  [4 bytes big-endian uint32]  response string byte length M
  [M bytes]                    UTF-8 text response

Response text format (detection):
  "0 <num_det> <x1> <y1> <x2> <y2> <score> <cls> <x1> ..."
   ↑ error flag (0=ok, ERR=error)

Response text format (segmentation, extended):
  "0 <num_det> <x1> <y1> <x2> <y2> <score> <cls> <npts> <px0> <py0> <px1> <py1> ... <x1> ..."
```

---

## 1. YOLOv8 Detection — Grayscale 640×640

Matches the protocol in `client_socket.hdev` exactly.

```python
"""
Python TCP Socket Server — YOLOv8 Detection
Receives 640×640 grayscale uint8 bytes from HALCON.
Returns space-delimited: "0 N x1 y1 x2 y2 score cls ..."

Usage:
    python socket_server.py
    Listening on 0.0.0.0:12002
"""

import socket
import struct
import numpy as np
import cv2
import time

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH   = "yolov8n.pt"        # path to your weights
HOST         = "0.0.0.0"
PORT         = 12002
IMG_W        = 640
IMG_H        = 640
CONF_THRESH  = 0.25
IOU_THRESH   = 0.45
CLASS_NAMES  = None                # None = use model's built-in names
# ─────────────────────────────────────────────────────────────

from ultralytics import YOLO
print(f"Loading model: {MODEL_PATH}")
model = YOLO(MODEL_PATH)
print(f"Model loaded. Classes: {model.names}")


def recv_exact(sock: socket.socket, n: int) -> bytes:
    """Receive exactly n bytes, blocking until all arrive."""
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Socket closed before all bytes received")
        buf += chunk
    return buf


def handle_client(conn: socket.socket, addr):
    print(f"  Connection from {addr}")
    try:
        # 1. Receive image length (4 bytes, big-endian uint32)
        raw_len = recv_exact(conn, 4)
        img_bytes = struct.unpack(">I", raw_len)[0]
        print(f"  Expecting {img_bytes} image bytes")

        # 2. Receive raw pixel data
        raw_pixels = recv_exact(conn, img_bytes)

        # 3. Decode: flat uint8 array → H×W grayscale → BGR for YOLO
        arr = np.frombuffer(raw_pixels, dtype=np.uint8).reshape((IMG_H, IMG_W))
        bgr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)

        # 4. Run inference
        t0 = time.time()
        results = model(bgr, conf=CONF_THRESH, iou=IOU_THRESH, verbose=False)[0]
        elapsed_ms = (time.time() - t0) * 1000
        print(f"  Inference: {elapsed_ms:.1f} ms, {len(results.boxes)} detections")

        # 5. Build response string
        #    Format: "0 <num_det> <x1> <y1> <x2> <y2> <score> <cls> ..."
        tokens = ["0"]  # Tokens[0]: error flag ("0" = ok, "ERR" = error)
        tokens.append(str(len(results.boxes)))  # Tokens[1]: num detections
        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            score = float(box.conf[0])
            cls   = int(box.cls[0])
            tokens += [str(x1), str(y1), str(x2), str(y2),
                       f"{score:.4f}", str(cls)]

        response = " ".join(tokens)

    except Exception as e:
        print(f"  ERROR: {e}")
        response = f"ERR {e}"

    # 6. Send response length then response text
    encoded = response.encode("utf-8")
    conn.sendall(struct.pack(">I", len(encoded)))
    conn.sendall(encoded)
    print(f"  Sent response ({len(encoded)} bytes): {response[:80]}...")


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(5)
    print(f"Socket server listening on {HOST}:{PORT}")
    print(f"Model: {MODEL_PATH} | Input: {IMG_W}×{IMG_H} grayscale")
    print("Waiting for HALCON connections...\n")

    while True:
        conn, addr = server.accept()
        try:
            handle_client(conn, addr)
        finally:
            conn.close()


if __name__ == "__main__":
    main()
```

---

## 2. YOLOv8 Segmentation — Grayscale 640×640

Extended response format includes polygon point count + points per instance.
HALCON parses: `"0 N  x1 y1 x2 y2 score cls npts px0 py0 px1 py1 ...  x1 ..."`

```python
"""
Python TCP Socket Server — YOLOv8 Instance Segmentation
Extended response: includes polygon contour points per instance.
Port: 12002
"""

import socket, struct, time
import numpy as np
import cv2

# ── USER CONFIG ──────────────────────────────────────────────
MODEL_PATH  = "yolov8n-seg.pt"
HOST        = "0.0.0.0"
PORT        = 12002
IMG_W       = 640
IMG_H       = 640
CONF_THRESH = 0.25
IOU_THRESH  = 0.45
MAX_POLY_PTS = 32   # max polygon points per instance (simplify to keep response small)
# ─────────────────────────────────────────────────────────────

from ultralytics import YOLO
print(f"Loading model: {MODEL_PATH}")
model = YOLO(MODEL_PATH)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Connection closed")
        buf += chunk
    return buf


def mask_to_polygon(binary_mask: np.ndarray, max_pts: int = 32):
    """Extract largest contour and simplify to max_pts points."""
    contours, _ = cv2.findContours(
        binary_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return []
    cnt = max(contours, key=cv2.contourArea)
    # Simplify adaptively until under max_pts
    epsilon = 1.0
    while True:
        approx = cv2.approxPolyDP(cnt, epsilon, True)
        if len(approx) <= max_pts or epsilon > 50:
            break
        epsilon *= 1.5
    return approx.reshape(-1, 2).tolist()  # [[x,y], ...]


def handle_client(conn, addr):
    print(f"  Connection from {addr}")
    try:
        raw_len    = recv_exact(conn, 4)
        img_bytes  = struct.unpack(">I", raw_len)[0]
        raw_pixels = recv_exact(conn, img_bytes)

        arr = np.frombuffer(raw_pixels, dtype=np.uint8).reshape((IMG_H, IMG_W))
        bgr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)

        t0      = time.time()
        results = model(bgr, conf=CONF_THRESH, iou=IOU_THRESH, verbose=False)[0]
        elapsed = (time.time() - t0) * 1000
        print(f"  Inference: {elapsed:.1f} ms, {len(results.boxes)} instances")

        tokens = ["0", str(len(results.boxes))]

        masks_data = results.masks
        for i, box in enumerate(results.boxes):
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            score = float(box.conf[0])
            cls   = int(box.cls[0])
            tokens += [str(x1), str(y1), str(x2), str(y2),
                       f"{score:.4f}", str(cls)]

            # Polygon points
            poly = []
            if masks_data is not None and i < len(masks_data.data):
                mask_np     = masks_data.data[i].cpu().numpy()
                mask_resize = cv2.resize(mask_np, (IMG_W, IMG_H),
                                         interpolation=cv2.INTER_NEAREST)
                binary = (mask_resize > 0.5).astype(np.uint8)
                poly   = mask_to_polygon(binary, MAX_POLY_PTS)

            tokens.append(str(len(poly)))   # npts
            for (px, py) in poly:
                tokens += [str(px), str(py)]

        response = " ".join(tokens)

    except Exception as e:
        print(f"  ERROR: {e}")
        response = f"ERR {e}"

    encoded = response.encode("utf-8")
    conn.sendall(struct.pack(">I", len(encoded)))
    conn.sendall(encoded)
    print(f"  Response: {len(encoded)} bytes, {len(results.boxes)} instances")


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(5)
    print(f"YOLOv8-seg socket server on {HOST}:{PORT}")
    while True:
        conn, addr = server.accept()
        try:
            handle_client(conn, addr)
        finally:
            conn.close()

if __name__ == "__main__":
    main()
```

---

## 3. YOLOv8 Detection — RGB Variable Size

For color images or non-fixed sizes. HALCON sends: `W H channels N_bytes pixels`.

```python
"""
Python TCP Socket Server — YOLOv8 Detection, RGB, variable image size.

HALCON sends header first:
  [4 bytes] width  (uint32 big-endian)
  [4 bytes] height (uint32 big-endian)
  [4 bytes] channels (1 or 3)
  [4 bytes] total bytes N
  [N bytes] raw pixels

Response: same "0 N x1 y1 x2 y2 score cls ..." format.
Port: 12002
"""

import socket, struct, time
import numpy as np
import cv2

MODEL_PATH  = "yolov8n.pt"
HOST        = "0.0.0.0"
PORT        = 12002
CONF_THRESH = 0.25

from ultralytics import YOLO
model = YOLO(MODEL_PATH)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        c = sock.recv(n - len(buf))
        if not c: raise ConnectionError("Closed")
        buf += c
    return buf


def handle_client(conn, addr):
    try:
        # Extended header: W, H, C, N
        hdr = recv_exact(conn, 16)
        W, H, C, N = struct.unpack(">IIII", hdr)
        print(f"  Image: {W}×{H}×{C}, {N} bytes")
        raw = recv_exact(conn, N)

        arr = np.frombuffer(raw, dtype=np.uint8).reshape((H, W, C) if C > 1 else (H, W))
        bgr = arr if C == 3 else cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
        if C == 3:
            bgr = cv2.cvtColor(bgr, cv2.COLOR_RGB2BGR)  # HALCON stores RGB

        t0 = time.time()
        results = model(bgr, conf=CONF_THRESH, verbose=False)[0]
        print(f"  {len(results.boxes)} dets in {(time.time()-t0)*1000:.1f} ms")

        tokens = ["0", str(len(results.boxes))]
        for box in results.boxes:
            x1,y1,x2,y2 = map(int, box.xyxy[0].tolist())
            tokens += [str(x1),str(y1),str(x2),str(y2),
                       f"{float(box.conf[0]):.4f}", str(int(box.cls[0]))]
        response = " ".join(tokens)
    except Exception as e:
        response = f"ERR {e}"

    enc = response.encode()
    conn.sendall(struct.pack(">I", len(enc)))
    conn.sendall(enc)


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT)); srv.listen(5)
    print(f"RGB socket server on {HOST}:{PORT}")
    while True:
        conn, addr = srv.accept()
        try: handle_client(conn, addr)
        finally: conn.close()

if __name__ == "__main__":
    main()
```

---

## 4. Generic PyTorch Skeleton

```python
"""
Generic socket server skeleton — fill in load_model() and run_model().
Returns same "0 N x1 y1 x2 y2 score cls ..." format.
Port: 12002
"""

import socket, struct, time
import numpy as np
import cv2
import torch

MODEL_PATH  = "model.pth"
HOST        = "0.0.0.0"
PORT        = 12002
IMG_W       = 640
IMG_H       = 640
DEVICE      = "cuda" if torch.cuda.is_available() else "cpu"


def load_model():
    """TODO: load and return your model here."""
    raise NotImplementedError


def run_model(bgr_image: np.ndarray) -> list:
    """
    TODO: run inference and return list of dicts:
    [{"x1":..,"y1":..,"x2":..,"y2":..,"score":..,"cls":..}, ...]
    """
    raise NotImplementedError


model = load_model()


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        c = sock.recv(n - len(buf))
        if not c: raise ConnectionError("Closed")
        buf += c
    return buf


def handle_client(conn, addr):
    try:
        img_bytes  = struct.unpack(">I", recv_exact(conn, 4))[0]
        raw        = recv_exact(conn, img_bytes)
        arr        = np.frombuffer(raw, dtype=np.uint8).reshape((IMG_H, IMG_W))
        bgr        = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)

        t0   = time.time()
        dets = run_model(bgr)
        print(f"  {len(dets)} dets in {(time.time()-t0)*1000:.1f} ms")

        tokens = ["0", str(len(dets))]
        for d in dets:
            tokens += [str(d["x1"]), str(d["y1"]), str(d["x2"]), str(d["y2"]),
                       f"{d['score']:.4f}", str(d["cls"])]
        response = " ".join(tokens)
    except Exception as e:
        response = f"ERR {e}"

    enc = response.encode()
    conn.sendall(struct.pack(">I", len(enc)))
    conn.sendall(enc)


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT)); srv.listen(5)
    print(f"Socket server on {HOST}:{PORT}")
    while True:
        conn, addr = srv.accept()
        try: handle_client(conn, addr)
        finally: conn.close()

if __name__ == "__main__":
    main()
```

---

## requirements.txt

```
ultralytics>=8.0.0
opencv-python>=4.8.0
numpy>=1.24.0
torch>=2.0.0
```
