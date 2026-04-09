# HALCON HDevelop Socket Client Templates

Ready-to-use `.hdev` scripts that connect to the Python socket server,
send raw image bytes, and display results — no curl, no disk, no JSON.

---

## Table of Contents
1. [Detection — Single Image Grayscale](#1-detection--single-image-grayscale)
2. [Detection — Folder Loop](#2-detection--folder-loop)
3. [Segmentation — Boxes + Polygon Regions](#3-segmentation--boxes--polygon-regions)
4. [RGB Image — Variable Size](#4-rgb-image--variable-size)

---

## 1. Detection — Single Image Grayscale

Exact match to the uploaded `client_socket.hdev` with a clean CONFIG block.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test.tif'</l>
<l>Host      := '127.0.0.1'</l>
<l>Port      := 12002</l>
<l>ImgW      := 640</l>
<l>ImgH      := 640</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>dev_open_window (0, 0, 1200, 900, 'black', WindowHandle)</l>
<l>set_display_font (WindowHandle, 16, 'mono', 'true', 'false')</l>

<c>* Read image — must be byte grayscale</c>
<l>read_image (Image, ImagePath)</l>
<l>get_image_type (Image, ImageType)</l>
<l>count_channels (Image, Channels)</l>
<l>if (ImageType != 'byte' or Channels != 1)</l>
<l>    throw ('Requires byte grayscale image')</l>
<l>endif</l>

<c>* Resize to model input size</c>
<l>zoom_image_size (Image, ImageNet, ImgW, ImgH, 'constant')</l>
<l>dev_display (ImageNet)</l>

<c>* Get raw pixel pointer and copy to memory block</c>
<l>get_image_pointer1 (ImageNet, Pointer, Type, Width, Height)</l>
<l>ImgBytes := Width * Height</l>
<l>create_memory_block_extern_copy (Pointer, ImgBytes, RawBlock)</l>

<c>* Connect to Python socket server</c>
<l>open_socket_connect (Host, Port, ['protocol'], ['TCP'], Socket)</l>

<c>* Send image byte length (4-byte uint32), then raw pixels</c>
<l>send_data (Socket, 'In', ImgBytes, [])</l>
<l>send_data (Socket, 'a', RawBlock, [])</l>

<c>* Receive response length (4-byte uint32), then response text</c>
<l>receive_data (Socket, 'In', RespLen, From1)</l>
<l>RespFormat := 'z' + RespLen</l>
<l>receive_data (Socket, RespFormat, ResponseText, From2)</l>

<l>close_socket (Socket)</l>

<c>* Parse response: "0 num_det x1 y1 x2 y2 score cls ..."</c>
<l>tuple_split (ResponseText, ' ', Tokens)</l>

<c>* Check for error</c>
<l>if (Tokens[0] = 'ERR')</l>
<l>    disp_message (WindowHandle, ResponseText, 'window', 60, 20, 'red', 'true')</l>
<l>    stop ()</l>
<l>endif</l>

<c>* Tokens[1] = num detections</c>
<l>NumDet := number(Tokens[1])</l>
<l>disp_message (WindowHandle, 'Detections: ' + NumDet, 'window', 20, 20, 'white', 'true')</l>

<c>* Draw each detection  (6 tokens each, Base = 1 + I*6)</c>
<l>dev_set_line_width (3)</l>
<l>for I := 0 to NumDet - 1 by 1</l>
<l>    Base  := 1 + I * 6</l>
<l>    X1    := number(Tokens[Base + 1])</l>
<l>    Y1    := number(Tokens[Base + 2])</l>
<l>    X2    := number(Tokens[Base + 3])</l>
<l>    Y2    := number(Tokens[Base + 4])</l>
<l>    Score := number(Tokens[Base + 5])</l>
<l>    Cls   := number(Tokens[Base + 6])</l>
<l>    gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>    dev_set_color ('red')</l>
<l>    dev_display (Rect)</l>
<l>    tuple_string (Score, '.2f', ScoreStr)</l>
<l>    disp_message (WindowHandle, 'c=' + Cls + ' s=' + ScoreStr, 'image', Y1, X1, 'yellow', 'false')</l>
<l>endfor</l>

<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 2. Detection — Folder Loop

Loops over all images in a folder, connects to the server once per image.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImageDir := 'C:/your_images/test_folder'</l>
<l>Host     := '127.0.0.1'</l>
<l>Port     := 12002</l>
<l>ImgW     := 640</l>
<l>ImgH     := 640</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>dev_open_window (0, 0, 1200, 900, 'black', WindowHandle)</l>
<l>set_display_font (WindowHandle, 14, 'mono', 'true', 'false')</l>

<l>list_files (ImageDir, ['files','follow_links'], ImageFiles)</l>
<l>tuple_regexp_select (ImageFiles, '\.(png|jpg|jpeg|tif|bmp)$', ImageFiles)</l>
<l>NumImages := |ImageFiles|</l>

<l>for Idx := 0 to NumImages - 1 by 1</l>
<l>    ImagePath := ImageFiles[Idx]</l>

<l>    read_image (Image, ImagePath)</l>
<l>    convert_image_type (Image, ImageByte, 'byte')</l>
<l>    rgb1_to_gray (ImageByte, ImageGray)</l>
<l>    zoom_image_size (ImageGray, ImageNet, ImgW, ImgH, 'constant')</l>

<l>    get_image_pointer1 (ImageNet, Pointer, Type, Width, Height)</l>
<l>    ImgBytes := Width * Height</l>
<l>    create_memory_block_extern_copy (Pointer, ImgBytes, RawBlock)</l>

<l>    open_socket_connect (Host, Port, ['protocol'], ['TCP'], Socket)</l>
<l>    send_data (Socket, 'In', ImgBytes, [])</l>
<l>    send_data (Socket, 'a', RawBlock, [])</l>
<l>    receive_data (Socket, 'In', RespLen, From1)</l>
<l>    RespFormat := 'z' + RespLen</l>
<l>    receive_data (Socket, RespFormat, ResponseText, From2)</l>
<l>    close_socket (Socket)</l>

<l>    tuple_split (ResponseText, ' ', Tokens)</l>
<l>    if (Tokens[0] = 'ERR')</l>
<l>        disp_message (WindowHandle, 'ERR on ' + ImagePath, 'window', 40, 20, 'red', 'false')</l>
<l>    else</l>
<l>        NumDet := number(Tokens[1])</l>
<l>        dev_display (ImageNet)</l>
<l>        dev_set_line_width (2)</l>
<l>        for I := 0 to NumDet - 1 by 1</l>
<l>            Base := 1 + I * 6</l>
<l>            X1   := number(Tokens[Base + 1])</l>
<l>            Y1   := number(Tokens[Base + 2])</l>
<l>            X2   := number(Tokens[Base + 3])</l>
<l>            Y2   := number(Tokens[Base + 4])</l>
<l>            gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>            dev_set_color ('red')</l>
<l>            dev_display (Rect)</l>
<l>        endfor</l>
<l>        disp_message (WindowHandle, Idx + '/' + NumImages + '  dets=' + NumDet, 'window', 20, 20, 'white', 'true')</l>
<l>    endif</l>

<l>endfor</l>
<l>disp_message (WindowHandle, 'Done: ' + NumImages + ' images', 'window', 20, 20, 'green', 'true')</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 3. Segmentation — Boxes + Polygon Regions

Parses the extended token format from server template #2 (includes `npts + px py` per instance).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test.tif'</l>
<l>Host      := '127.0.0.1'</l>
<l>Port      := 12002</l>
<l>ImgW      := 640</l>
<l>ImgH      := 640</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>dev_open_window (0, 0, 1200, 900, 'black', WindowHandle)</l>
<l>set_display_font (WindowHandle, 14, 'mono', 'true', 'false')</l>

<l>read_image (Image, ImagePath)</l>
<l>zoom_image_size (Image, ImageNet, ImgW, ImgH, 'constant')</l>
<l>dev_display (ImageNet)</l>

<l>get_image_pointer1 (ImageNet, Pointer, Type, Width, Height)</l>
<l>ImgBytes := Width * Height</l>
<l>create_memory_block_extern_copy (Pointer, ImgBytes, RawBlock)</l>

<l>open_socket_connect (Host, Port, ['protocol'], ['TCP'], Socket)</l>
<l>send_data (Socket, 'In', ImgBytes, [])</l>
<l>send_data (Socket, 'a', RawBlock, [])</l>
<l>receive_data (Socket, 'In', RespLen, From1)</l>
<l>receive_data (Socket, 'z' + RespLen, ResponseText, From2)</l>
<l>close_socket (Socket)</l>

<l>tuple_split (ResponseText, ' ', Tokens)</l>
<l>if (Tokens[0] = 'ERR')</l>
<l>    disp_message (WindowHandle, ResponseText, 'window', 40, 20, 'red', 'true')</l>
<l>    stop ()</l>
<l>endif</l>

<l>NumDet := number(Tokens[1])</l>
<l>disp_message (WindowHandle, 'Instances: ' + NumDet, 'window', 20, 20, 'white', 'true')</l>

<c>* Token cursor — starts after "0 NumDet"</c>
<l>TokIdx := 2</l>
<l>dev_set_line_width (2)</l>

<l>for I := 0 to NumDet - 1 by 1</l>
<c>    * Read 6 fixed fields: x1 y1 x2 y2 score cls</c>
<l>    X1    := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>
<l>    Y1    := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>
<l>    X2    := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>
<l>    Y2    := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>
<l>    Score := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>
<l>    Cls   := number(Tokens[TokIdx]);    TokIdx := TokIdx + 1</l>

<c>    * Draw bounding box</c>
<l>    gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>    dev_set_color ('yellow')</l>
<l>    dev_display (Rect)</l>

<c>    * Read npts then npts pairs of (px, py)</c>
<l>    NPts := number(Tokens[TokIdx]);     TokIdx := TokIdx + 1</l>
<l>    ColCoords := []</l>
<l>    RowCoords := []</l>
<l>    for K := 0 to NPts - 1 by 1</l>
<l>        PX := number(Tokens[TokIdx]);   TokIdx := TokIdx + 1</l>
<l>        PY := number(Tokens[TokIdx]);   TokIdx := TokIdx + 1</l>
<l>        ColCoords := [ColCoords, PX]</l>
<l>        RowCoords := [RowCoords, PY]</l>
<l>    endfor</l>

<c>    * Draw polygon mask region</c>
<l>    if (NPts > 2)</l>
<l>        gen_region_polygon (MaskRegion, RowCoords, ColCoords)</l>
<l>        dev_set_color ('green')</l>
<l>        dev_set_draw ('margin')</l>
<l>        dev_display (MaskRegion)</l>
<l>        dev_set_draw ('fill')</l>
<l>    endif</l>

<l>    tuple_string (Score, '.2f', ScoreStr)</l>
<l>    disp_message (WindowHandle, 'c=' + Cls + ' ' + ScoreStr, 'image', Y1, X1, 'yellow', 'false')</l>
<l>endfor</l>

<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```

---

## 4. RGB Image — Variable Size

Sends a 16-byte header (W, H, C, N) before pixels. Matches server template #3.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hdevelop file_version="1.2" halcon_version="24.11.1.0">
<procedure name="main">
<interface/>
<body>

<c>* ── USER CONFIG ─────────────────────────────────────────</c>
<l>ImagePath := 'C:/your_images/test_color.png'</l>
<l>Host      := '127.0.0.1'</l>
<l>Port      := 12002</l>
<c>* ─────────────────────────────────────────────────────────</c>

<l>dev_update_off ()</l>
<l>dev_close_window ()</l>
<l>dev_open_window (0, 0, 1200, 900, 'black', WindowHandle)</l>

<l>read_image (Image, ImagePath)</l>
<l>get_image_size (Image, W, H)</l>
<l>count_channels (Image, C)</l>
<l>dev_display (Image)</l>

<c>* Get raw pointer — for 3-channel, use get_image_pointer3</c>
<l>if (C == 3)</l>
<l>    get_image_pointer3 (Image, PR, PG, PB, Type, Width, Height)</l>
<c>    * Interleave R,G,B into one memory block — use compose3 trick</c>
<l>    channels_to_image (Image, ImageInterleaved)</l>
<l>    get_image_pointer1 (ImageInterleaved, Pointer, Type2, Width2, Height2)</l>
<l>    ImgBytes := Width * Height * 3</l>
<l>    create_memory_block_extern_copy (Pointer, ImgBytes, RawBlock)</l>
<l>else</l>
<l>    get_image_pointer1 (Image, Pointer, Type, Width, Height)</l>
<l>    ImgBytes := Width * Height</l>
<l>    create_memory_block_extern_copy (Pointer, ImgBytes, RawBlock)</l>
<l>endif</l>

<c>* Send header: W H C N (4×uint32 big-endian)</c>
<l>open_socket_connect (Host, Port, ['protocol'], ['TCP'], Socket)</l>
<l>send_data (Socket, 'In', W,        [])</l>
<l>send_data (Socket, 'In', H,        [])</l>
<l>send_data (Socket, 'In', C,        [])</l>
<l>send_data (Socket, 'In', ImgBytes, [])</l>
<l>send_data (Socket, 'a',  RawBlock, [])</l>

<l>receive_data (Socket, 'In', RespLen, From1)</l>
<l>receive_data (Socket, 'z' + RespLen, ResponseText, From2)</l>
<l>close_socket (Socket)</l>

<l>tuple_split (ResponseText, ' ', Tokens)</l>
<l>if (Tokens[0] = 'ERR')</l>
<l>    disp_message (WindowHandle, ResponseText, 'window', 40, 20, 'red', 'true')</l>
<l>    stop ()</l>
<l>endif</l>

<l>NumDet := number(Tokens[1])</l>
<l>dev_set_line_width (3)</l>
<l>for I := 0 to NumDet - 1 by 1</l>
<l>    Base  := 1 + I * 6</l>
<l>    X1    := number(Tokens[Base + 1])</l>
<l>    Y1    := number(Tokens[Base + 2])</l>
<l>    X2    := number(Tokens[Base + 3])</l>
<l>    Y2    := number(Tokens[Base + 4])</l>
<l>    Score := number(Tokens[Base + 5])</l>
<l>    Cls   := number(Tokens[Base + 6])</l>
<l>    gen_rectangle1 (Rect, Y1, X1, Y2, X2)</l>
<l>    dev_set_color ('red')</l>
<l>    dev_display (Rect)</l>
<l>    tuple_string (Score, '.2f', ScoreStr)</l>
<l>    disp_message (WindowHandle, 'c=' + Cls + ' ' + ScoreStr, 'image', Y1, X1, 'yellow', 'false')</l>
<l>endfor</l>

<l>disp_message (WindowHandle, NumDet + ' detections', 'window', 20, 20, 'white', 'true')</l>
<l>dev_update_on ()</l>

</body>
<docu id="main"><parameters/></docu>
</procedure>
</hdevelop>
```
