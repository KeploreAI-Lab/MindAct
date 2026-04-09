# HALCON HDevelop Test Script Templates

Ready-to-use `.hdev` scripts for testing the Python API from HDevelop.
All scripts call `http://127.0.0.1:12002/infer_file` via curl, parse the JSON,
and display results in the HALCON window.

---

## Table of Contents
1. [Detection — Bounding Boxes](#1-detection--bounding-boxes)
2. [Segmentation — Boxes + Mask Polygons](#2-segmentation--boxes--mask-polygons)
3. [Anomaly Detection — Score + Region](#3-anomaly-detection--score--region)
4. [Batch Mode — Loop Over Folder](#4-batch-mode--loop-over-folder)

---

## 1. Detection — Bounding Boxes

Draws yellow bounding boxes with class name + confidence label for each detected instance.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test_image.png'</l>
<l>ServerUrl := 'http://127.0.0.1:12002/infer_file'</l>
<l>TmpDir    := 'C:/temp_halcon_infer'</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>

<c>* Create temp dir if needed</c>
<l>file_exists (TmpDir, Exists)</l>
<l>if (Exists == 0)</l>
<l>  make_dir (TmpDir)</l>
<l>endif</l>
<l>JsonPath := TmpDir + '/out.json'</l>

<c>* Read and display image</c>
<l>read_image (Image, ImagePath)</l>
<l>get_image_size (Image, W, H)</l>
<l>dev_open_window_fit_image (Image, 0, 0, -1, -1, WindowHandle)</l>
<l>dev_display (Image)</l>

<c>* Call API via curl (multipart upload)</c>
<l>CurlCmd := 'curl -s -X POST "' + ServerUrl + '" -F "file=@' + ImagePath + '" -o "' + JsonPath + '"'</l>
<l>system_call (CurlCmd)</l>

<c>* Parse JSON response</c>
<l>read_dict (JsonPath, [], [], Dict)</l>
<l>get_dict_tuple (Dict, 'defects', Detections)</l>
<l>get_dict_tuple (Dict, 'inference_time_ms', InferMs)</l>
<l>NumDet := |Detections|</l>

<c>* Draw each detection</c>
<l>dev_set_line_width (3)</l>
<l>for i := 0 to NumDet - 1 by 1</l>
<l>  get_dict_tuple (Detections, i, Det)</l>
<l>  get_dict_tuple (Det, 'bbox',       Bbox)</l>
<l>  get_dict_tuple (Det, 'class_name', ClassName)</l>
<l>  get_dict_tuple (Det, 'confidence', Conf)</l>
<l>  get_dict_tuple (Bbox, 'x1', X1)</l>
<l>  get_dict_tuple (Bbox, 'y1', Y1)</l>
<l>  get_dict_tuple (Bbox, 'x2', X2)</l>
<l>  get_dict_tuple (Bbox, 'y2', Y2)</l>
<c>  * gen_rectangle1 uses (Row1, Col1, Row2, Col2) = (Y1, X1, Y2, X2)</c>
<l>  gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>  dev_set_color ('yellow')</l>
<l>  dev_display (Rect)</l>
<c>  * Label: ClassName + confidence</c>
<l>  tuple_string (Conf, '.2f', ConfStr)</l>
<l>  Label := ClassName + ' ' + ConfStr</l>
<l>  disp_message (WindowHandle, Label, 'image', Y1 - 5, X1, 'yellow', 'false')</l>
<l>endfor</l>

<c>* Show summary</c>
<l>tuple_string (InferMs, '.1f', MsStr)</l>
<l>Summary := 'Detections: ' + NumDet + '  |  ' + MsStr + ' ms'</l>
<l>disp_message (WindowHandle, Summary, 'window', 12, 12, 'white', 'true')</l>

<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 2. Segmentation — Boxes + Mask Polygons

Draws yellow bounding boxes and overlays filled green regions for each instance mask.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test_image.png'</l>
<l>ServerUrl := 'http://127.0.0.1:12002/infer_file'</l>
<l>TmpDir    := 'C:/temp_halcon_infer'</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>file_exists (TmpDir, Exists)</l>
<l>if (Exists == 0)</l>
<l>  make_dir (TmpDir)</l>
<l>endif</l>
<l>JsonPath := TmpDir + '/out.json'</l>

<l>read_image (Image, ImagePath)</l>
<l>get_image_size (Image, W, H)</l>
<l>dev_open_window_fit_image (Image, 0, 0, -1, -1, WindowHandle)</l>
<l>dev_display (Image)</l>

<c>* Call API</c>
<l>CurlCmd := 'curl -s -X POST "' + ServerUrl + '" -F "file=@' + ImagePath + '" -o "' + JsonPath + '"'</l>
<l>system_call (CurlCmd)</l>

<c>* Parse JSON</c>
<l>read_dict (JsonPath, [], [], Dict)</l>
<l>get_dict_tuple (Dict, 'defects', Detections)</l>
<l>get_dict_tuple (Dict, 'inference_time_ms', InferMs)</l>
<l>NumDet := |Detections|</l>

<l>dev_set_line_width (2)</l>
<l>for i := 0 to NumDet - 1 by 1</l>
<l>  get_dict_tuple (Detections, i, Det)</l>
<l>  get_dict_tuple (Det, 'bbox',       Bbox)</l>
<l>  get_dict_tuple (Det, 'class_name', ClassName)</l>
<l>  get_dict_tuple (Det, 'confidence', Conf)</l>
<l>  get_dict_tuple (Det, 'polygon',    Polygons)</l>
<l>  get_dict_tuple (Bbox, 'x1', X1)</l>
<l>  get_dict_tuple (Bbox, 'y1', Y1)</l>
<l>  get_dict_tuple (Bbox, 'x2', X2)</l>
<l>  get_dict_tuple (Bbox, 'y2', Y2)</l>

<c>  * Draw bounding box</c>
<l>  gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>  dev_set_color ('yellow')</l>
<l>  dev_display (Rect)</l>

<c>  * Draw mask polygon (first contour) as filled region</c>
<l>  NumPolys := |Polygons|</l>
<l>  if (NumPolys > 0)</l>
<l>    get_dict_tuple (Polygons, 0, PolyPoints)</l>
<c>    * PolyPoints is [[x0,y0],[x1,y1],...] — flatten to rows/cols</c>
<l>    NumPts := |PolyPoints|</l>
<l>    ColCoords := []</l>
<l>    RowCoords := []</l>
<l>    for k := 0 to NumPts - 1 by 1</l>
<l>      get_dict_tuple (PolyPoints, k, Pt)</l>
<l>      ColCoords := [ColCoords, Pt[0]]</l>
<l>      RowCoords := [RowCoords, Pt[1]]</l>
<l>    endfor</l>
<l>    gen_region_polygon (MaskRegion, RowCoords, ColCoords)</l>
<l>    dev_set_color ('green')</l>
<l>    dev_set_draw ('margin')</l>
<l>    dev_display (MaskRegion)</l>
<l>  endif</l>

<l>  tuple_string (Conf, '.2f', ConfStr)</l>
<l>  disp_message (WindowHandle, ClassName + ' ' + ConfStr, 'image', Y1 - 5, X1, 'yellow', 'false')</l>
<l>endfor</l>

<l>tuple_string (InferMs, '.1f', MsStr)</l>
<l>disp_message (WindowHandle, NumDet + ' instances  |  ' + MsStr + ' ms', 'window', 12, 12, 'white', 'true')</l>
<l>dev_set_draw ('fill')</l>
<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 3. Anomaly Detection — Score + Region

Shows anomaly score as text and highlights defect regions in red.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test_image.png'</l>
<l>ServerUrl := 'http://127.0.0.1:12002/infer_file'</l>
<l>TmpDir    := 'C:/temp_halcon_infer'</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>file_exists (TmpDir, Exists)</l>
<l>if (Exists == 0)</l>
<l>  make_dir (TmpDir)</l>
<l>endif</l>
<l>JsonPath := TmpDir + '/out.json'</l>

<l>read_image (Image, ImagePath)</l>
<l>dev_open_window_fit_image (Image, 0, 0, -1, -1, WindowHandle)</l>
<l>dev_display (Image)</l>

<l>CurlCmd := 'curl -s -X POST "' + ServerUrl + '" -F "file=@' + ImagePath + '" -o "' + JsonPath + '"'</l>
<l>system_call (CurlCmd)</l>

<l>read_dict (JsonPath, [], [], Dict)</l>
<l>get_dict_tuple (Dict, 'anomaly_score', AnomalyScore)</l>
<l>get_dict_tuple (Dict, 'is_defect',     IsDefect)</l>
<l>get_dict_tuple (Dict, 'defects',       Detections)</l>
<l>NumDet := |Detections|</l>

<c>* Show verdict</c>
<l>tuple_string (AnomalyScore, '.4f', ScoreStr)</l>
<l>if (IsDefect == 1)</l>
<l>  Verdict := 'NG  score=' + ScoreStr</l>
<l>  VerdictColor := 'red'</l>
<l>else</l>
<l>  Verdict := 'OK  score=' + ScoreStr</l>
<l>  VerdictColor := 'green'</l>
<l>endif</l>
<l>disp_message (WindowHandle, Verdict, 'window', 12, 12, VerdictColor, 'true')</l>

<c>* Draw anomaly regions</c>
<l>dev_set_color ('red')</l>
<l>dev_set_line_width (2)</l>
<l>dev_set_draw ('margin')</l>
<l>for i := 0 to NumDet - 1 by 1</l>
<l>  get_dict_tuple (Detections, i, Det)</l>
<l>  get_dict_tuple (Det, 'bbox', Bbox)</l>
<l>  get_dict_tuple (Bbox, 'x1', X1)</l>
<l>  get_dict_tuple (Bbox, 'y1', Y1)</l>
<l>  get_dict_tuple (Bbox, 'x2', X2)</l>
<l>  get_dict_tuple (Bbox, 'y2', Y2)</l>
<l>  gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>  dev_display (Rect)</l>
<l>endfor</l>

<l>dev_set_draw ('fill')</l>
<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 4. Batch Mode — Loop Over Folder

Processes all images in a folder and saves result images with drawn annotations.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImageDir  := 'C:/your_images/test_folder'</l>
<l>OutputDir := 'C:/your_images/results'</l>
<l>ServerUrl := 'http://127.0.0.1:12002/infer_file'</l>
<l>TmpDir    := 'C:/temp_halcon_infer'</l>
<l>Extension := 'png'</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>file_exists (TmpDir,    E1)</l>
<l>file_exists (OutputDir, E2)</l>
<l>if (E1 == 0) make_dir (TmpDir)    endif</l>
<l>if (E2 == 0) make_dir (OutputDir) endif</l>
<l>JsonPath := TmpDir + '/out.json'</l>

<c>* List all images in folder</c>
<l>list_files (ImageDir, ['files','follow_links'], ImageFiles)</l>
<l>tuple_regexp_select (ImageFiles, '\.(png|jpg|jpeg|tif|bmp)$', ImageFiles)</l>
<l>NumImages := |ImageFiles|</l>
<l>dev_inspect_ctrl (NumImages)</l>

<l>for idx := 0 to NumImages - 1 by 1</l>
<l>  ImagePath := ImageFiles[idx]</l>

<c>  * Extract filename for output</c>
<l>  tuple_strrchr (ImagePath, '/', Pos)</l>
<l>  if (Pos >= 0)</l>
<l>    tuple_strlen (ImagePath, L)</l>
<l>    tuple_substr (ImagePath, Pos+1, L-1, FileName)</l>
<l>  else</l>
<l>    FileName := ImagePath</l>
<l>  endif</l>

<l>  read_image (Image, ImagePath)</l>
<l>  get_image_size (Image, W, H)</l>

<c>  * Call API</c>
<l>  CurlCmd := 'curl -s -X POST "' + ServerUrl + '" -F "file=@' + ImagePath + '" -o "' + JsonPath + '"'</l>
<l>  system_call (CurlCmd)</l>

<l>  read_dict (JsonPath, [], [], Dict)</l>
<l>  get_dict_tuple (Dict, 'defects', Detections)</l>
<l>  NumDet := |Detections|</l>

<c>  * Draw results on image (paint overlay into new image)</c>
<l>  copy_image (Image, ResultImg)</l>
<l>  dev_set_line_width (3)</l>
<l>  dev_set_color ('yellow')</l>

<l>  for i := 0 to NumDet - 1 by 1</l>
<l>    get_dict_tuple (Detections, i, Det)</l>
<l>    get_dict_tuple (Det, 'bbox', Bbox)</l>
<l>    get_dict_tuple (Bbox, 'x1', X1)</l>
<l>    get_dict_tuple (Bbox, 'y1', Y1)</l>
<l>    get_dict_tuple (Bbox, 'x2', X2)</l>
<l>    get_dict_tuple (Bbox, 'y2', Y2)</l>
<l>    get_dict_tuple (Det, 'class_name', ClassName)</l>
<l>    get_dict_tuple (Det, 'confidence', Conf)</l>
<l>    gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>    paint_region (Rect, ResultImg, ResultImg, 255, 'margin')</l>
<l>  endfor</l>

<c>  * Save result image</c>
<l>  OutPath := OutputDir + '/' + FileName</l>
<l>  write_image (ResultImg, 'png', 0, OutPath)</l>

<l>  dev_inspect_ctrl (idx)</l>
<l>endfor</l>

<l>dev_disp_text ('Batch done: ' + NumImages + ' images processed', 'window', 12, 12, 'black', [], [])</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```
