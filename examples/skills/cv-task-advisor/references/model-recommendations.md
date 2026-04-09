# Model & Framework Recommendations by CV Task

Use this table to select the best model given the user's confirmed requirements.
Cross-reference task type with hardware and speed constraints.

---

## Object Detection

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| High accuracy, GPU server | YOLOv8x / YOLOv9 | RT-DETR-X | YOLO easier to train; RT-DETR better on small objects |
| Real-time, mid-range GPU | YOLOv8m / YOLOv8l | YOLOv10m | Good accuracy/speed balance |
| Edge device (Jetson) | YOLOv8n/s + TensorRT | YOLO-NAS-S | TensorRT export critical for Jetson speedup |
| CPU-only / mobile | YOLOv8n, MobileNet-SSD | NanoDet | Quantize to INT8 for best CPU perf |
| Small object detection | SAHI + YOLOv8 | YOLOv9-GELAN | SAHI slicing helps significantly for small targets |
| Max accuracy, no speed limit | Co-DETR, InternImage | YOLOv9-E | Research-grade; slower training |

**Framework**: Ultralytics (YOLOv8/v9/v10), MMDetection, Detectron2
**Annotation tool**: Roboflow, CVAT, LabelImg

---

## Instance Segmentation

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| General purpose | YOLOv8-seg | Mask R-CNN (Detectron2) | YOLOv8-seg faster; Mask R-CNN more mature |
| High accuracy masks | Mask2Former | SAM + detector | Mask2Former best quality; SAM good for interactive |
| Real-time video | YOLOv8-seg + TensorRT | YOLACT | YOLACT designed for real-time seg |
| Edge device | YOLOv8n-seg | MobileNetV3 + DeepLabV3 | Quantize; seg on edge is resource-heavy |

**Framework**: Ultralytics, Detectron2, MMSegmentation
**Annotation tool**: CVAT (polygon tools), Labelme, Roboflow

---

## Semantic Segmentation

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| General / high accuracy | SegFormer-B4/B5 | Mask2Former | Transformer-based; strong on diverse scenes |
| Real-time | BiSeNetV2, DDRNet | SegFormer-B0 | BiSeNet optimized for speed |
| Medical / satellite imagery | SwinUNet, nnU-Net | U-Net variants | Domain-specific architectures matter here |
| Edge / mobile | LiteSeg, MobileNetV3+DeepLabV3 | STDC | INT8 quantization needed |

**Framework**: MMSegmentation, HuggingFace Transformers, segmentation_models.pytorch
**Annotation tool**: CVAT, Labelme, SuperAnnotate

---

## Anomaly Detection

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| Industrial inspection, no defect labels | PatchCore (Anomalib) | EfficientAD | PatchCore is SOTA, easy to use via Anomalib |
| Need pixel-level anomaly map | PatchCore, CFlow-AD | FastFlow | All produce heatmaps |
| Very fast inference needed | EfficientAD | STFPM | EfficientAD specifically designed for speed |
| Few defect examples available | PatchCore + few-shot fine-tune | WinCLIP | WinCLIP uses CLIP for zero/few-shot anomaly |
| High-res textures | PaDiM | PatchCore with high-res patches | PaDiM efficient on texture defects |

**Framework**: Anomalib (Intel) — covers PatchCore, PaDiM, FastFlow, EfficientAD, CFlow-AD
**Dataset format**: MVTec-style (normal/train, test/defect_type)
**Key metric**: AUROC, per-pixel AUROC, F1 at best threshold

---

## Image Classification

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| General, enough data (1k+ per class) | EfficientNetV2-M, ConvNeXt-S | ViT-B/16 | Fine-tune from ImageNet pretrain |
| Few data (< 200 per class) | CLIP fine-tune, DINOv2 linear probe | EfficientNetV2-S + heavy augmentation | Foundation models shine with little data |
| Edge / mobile | MobileNetV3, EfficientNet-Lite | SqueezeNet | Quantize to INT8 |
| Multi-label classification | Same backbone + sigmoid head | CLIP zero-shot | Multi-label needs BCEWithLogitsLoss |
| Hierarchical classes | Custom head on ResNet/EfficientNet | — | Design label hierarchy carefully |

**Framework**: PyTorch + timm, HuggingFace, Keras
**Annotation tool**: Simple folder structure (class/image.jpg), or Roboflow for easy splits

---

## Pose Estimation

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| Human 2D pose, real-time | YOLOv8-pose, RTMPose | MoveNet (TFLite) | YOLOv8-pose easiest; MoveNet for mobile |
| Human 2D pose, high accuracy | ViTPose | HRNet | ViTPose SOTA; HRNet well-tested |
| Human 3D pose | MotionBERT, VideoPose3D | MediaPipe Pose (approx.) | True 3D needs depth or multi-view |
| Hand pose | MediaPipe Hands | HRNet-W32 (hand) | MediaPipe is plug-and-play |
| Object/vehicle pose | FoundPose, GDR-Net | — | 6DoF pose estimation domain |
| Mobile / browser | MoveNet Lightning (TFLite) | BlazePose | Very fast on-device |

**Framework**: Ultralytics, MMPose, MediaPipe, OpenPose (legacy)
**Key metric**: OKS, PCKh@0.5

---

## OCR / Text Detection

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| General printed text | PaddleOCR | EasyOCR, Tesseract | PaddleOCR best accuracy/speed balance |
| Document layout + text | LayoutLMv3, Donut | PaddleOCR + layout parser | Structured documents need layout understanding |
| License plates | LPRNet, PaddleOCR fine-tune | OpenALPR | Domain fine-tune strongly recommended |
| Handwritten text | TrOCR (HuggingFace) | CRNN fine-tune | TrOCR is SOTA for handwriting |
| Multi-language | PaddleOCR (80+ languages) | EasyOCR | Both support many languages |
| Scene text (signs, labels) | CRAFT + CRNN, PaddleOCR | ABCNet | Curved/arbitrary text needs specialized model |
| Edge / embedded | Tesseract (CPU) | PaddleOCR-mobile | Lower accuracy but lightweight |

**Framework**: PaddleOCR, EasyOCR, HuggingFace (TrOCR, Donut), Tesseract
**Key metric**: Character Error Rate (CER), Word Error Rate (WER), end-to-end accuracy

---

## Multi-Object Tracking

| Scenario | Primary Recommendation | Alternative | Notes |
|----------|----------------------|-------------|-------|
| General tracking, real-time | ByteTrack + YOLOv8 | BoT-SORT | ByteTrack robust, widely used |
| Highest accuracy tracking | BoT-SORT, StrongSORT | OC-SORT | Better handling of occlusion |
| Re-identification across cameras | DeepSORT + ReID model | FairMOT | Needs a dedicated ReID embedding model |
| Crowd / dense scenes | ByteTrack | MOTRv2 | End-to-end transformer tracker |
| Vehicle tracking | ByteTrack + fine-tuned YOLO | — | Fine-tune detector on vehicle dataset |
| Sports analytics | ByteTrack + domain detector | TrackNetV2 (ball tracking) | Ball tracking needs specialized model |

**Framework**: Ultralytics (built-in tracking), BoxMOT (wraps ByteTrack, BoT-SORT, etc.)
**Key metric**: MOTA, HOTA, IDF1

---

## General Framework Notes

### When to use which training framework
- **Ultralytics**: Best for detection, segmentation, pose, tracking — unified API, easiest to start
- **MMDetection / MMPose / MMSegmentation**: More flexible, research-oriented, harder setup
- **Detectron2**: Facebook's framework, strong for Mask R-CNN, panoptic seg
- **Anomalib**: Go-to for all anomaly detection tasks
- **HuggingFace Transformers**: Best for ViT, SegFormer, TrOCR, foundation models
- **timm**: Best model zoo for classification backbones

### Export & Deployment Formats
| Target | Export Format | Tool |
|--------|-------------|------|
| NVIDIA GPU (server) | TensorRT (.engine) | `trtexec`, Ultralytics export |
| Jetson | TensorRT INT8 | Jetson-optimized builds |
| CPU server | ONNX + OpenVINO | Ultralytics / torch.onnx |
| Mobile (Android/iOS) | TFLite, CoreML | TF Lite Converter, coremltools |
| Browser | ONNX.js, TensorFlow.js | — |
| Cloud API | Triton Inference Server, TorchServe | — |
