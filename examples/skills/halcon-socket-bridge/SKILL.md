---
name: halcon-socket-bridge
description: >
  Use this skill whenever a user wants to run a deep learning model (YOLOv8, YOLOv9, segmentation, anomaly, classification) from HALCON with maximum speed using a direct TCP socket — NO disk I/O, NO HTTP overhead, NO curl, NO JSON file writing. This skill is the high-performance alternative to halcon-python-api-bridge. Use it when the user says: "socket", "faster than HTTP", "no disk IO", "real-time inference from HALCON", "low latency HALCON model", "send raw image bytes to Python", "TCP socket HALCON", or when they upload client_socket.hdev. The approach: HALCON sends raw pixel bytes over a persistent TCP socket; Python server runs the model and returns a compact space-delimited text response. Always use port 12002 for the first socket server.
---

# HALCON ↔ Python Socket Bridge (High-Performance)

Zero-disk, zero-HTTP inference bridge. HALCON sends raw image bytes over a TCP socket; the Python server runs the model and returns results as a compact text string. Latency is dominated by inference time only — no curl process spawn, no file write, no JSON parse overhead.

---

## How It Works — Protocol

```
HALCON (client)                      Python Server (host)
──────────────────────────────────────────────────────────
zoom to 640×640 grayscale
get_image_pointer1 → raw bytes
create_memory_block_extern_copy

open_socket_connect(host, 12002)  →  accept()

send_data('In', ImgBytes)         →  recv 4 bytes → image length N
send_data('a',  RawBlock)         →  recv N bytes  → numpy array → model()

receive_data('In', RespLen)       ←  send 4 bytes  ← len(response_str)
receive_data('z'+RespLen, Text)   ←  send text     ← "0 N x1 y1 x2 y2 s c ..."

close_socket()
parse Tokens, draw boxes
```

### Wire Format Details

**HALCON → Python (request):**
- 4 bytes: `uint32` image byte length (big-endian, HALCON `'In'` format)
- N bytes: raw grayscale pixel data, row-major, uint8, 640×640 = 409600 bytes

**Python → HALCON (response) — flat space-delimited string:**
```
"0 <num_det> <x1> <y1> <x2> <y2> <score> <cls>  <x1> <y1> ..."
  │  └── Tokens[1]    └── 6 tokens per detection, Base = 1 + I*6
  └── Tokens[0] = reserved "0" (error flag: "ERR" on failure)
```

Per detection (6 tokens starting at `Base = 1 + I*6`):
```
Tokens[Base+0] = x1    (int, pixel coords on 640×640)
Tokens[Base+1] = y1
Tokens[Base+2] = x2
Tokens[Base+3] = y2
Tokens[Base+4] = score (float, 0.0–1.0)
Tokens[Base+5] = cls   (int, class index)
```

On error: server sends `"ERR <message>"` → HALCON shows red text and stops.

---

## When to Use Socket vs HTTP

| | Socket (this skill) | HTTP/curl (halcon-python-api-bridge) |
|---|---|---|
| **Speed** | ✅ Fastest — no process spawn, no disk | Slower — curl starts a new process per image |
| **Image format** | Raw bytes only (grayscale, fixed size) | Any format (JPEG/PNG/TIFF via file) |
| **Response** | Compact text string | Full JSON |
| **Connection** | One socket per image (reconnect each call) | Stateless HTTP |
| **Best for** | High-FPS production pipelines | Prototyping, complex responses (masks, metadata) |
| **Setup** | Slightly more involved | Easier |

---

## Phase 1: Clarify Requirements

Ask (if not clear):
1. What model? (YOLOv8n, YOLOv8n-seg, custom .pt)
2. Input: grayscale or RGB? Fixed 640×640 or variable size?
3. Output: detection only, or also segmentation masks?
4. One image at a time or persistent connection (keep-alive loop)?

> For segmentation masks over socket, encode polygon points as additional tokens in the response string. See `references/socket-servers.md` for the extended protocol.

---

## Phase 2: Build the Python Socket Server

**Read `references/socket-servers.md`** for ready-to-run server code.

Available templates:
| Template | Model | Input |
|----------|-------|-------|
| `yolov8-detection` | YOLOv8 / YOLOv9 detection | 640×640 grayscale uint8 |
| `yolov8-segmentation` | YOLOv8-seg | 640×640 grayscale uint8 |
| `yolov8-rgb-detection` | YOLOv8 detection | Variable size RGB |
| `generic-pytorch` | Any model | 640×640 grayscale uint8 |

### Running the Server

```bash
pip install ultralytics numpy --break-system-packages

python socket_server.py
# Listening on 0.0.0.0:12002
```

Always port **12002** (12003, 12004 for additional servers — see port-conventions skill).

---

## Phase 3: Generate the HALCON Script

**Read `references/halcon-socket-scripts.md`** for `.hdev` templates.

Available scripts:
| Script | Description |
|--------|-------------|
| `socket-detection.hdev` | Single image, grayscale, draw boxes |
| `socket-detection-loop.hdev` | Continuous loop over image folder |
| `socket-rgb.hdev` | RGB image, sends 3-channel bytes |
| `socket-segmentation.hdev` | Parses extended token format with polygon counts |

---

## Phase 4: Deliver Files

Save and `present_files`:
1. `socket_server.py`
2. `socket_client.hdev`
3. `requirements.txt`

Print setup instructions:
```
1. pip install -r requirements.txt
2. python socket_server.py      ← keep running
3. Open socket_client.hdev in HDevelop
4. Edit ImagePath and Host/Port at the top
5. Press F5
```

---

## Reference Files

- `references/socket-servers.md` — Python TCP socket server templates. **Read before writing server code.**
- `references/halcon-socket-scripts.md` — HDevelop socket client templates. **Read before writing .hdev code.**
