/**
 * generate-installer-assets.mts
 * Generates NSIS installer sidebar BMP (164×314, 24-bit uncompressed).
 *
 * Design (light business style):
 *   - White background
 *   - 8 px left stripe in brand blue (#3B82F6)
 *   - 40 px bottom band in light gray (#F1F5F9)
 *   - Thin 1 px separator line between body and bottom band (#CBD5E1)
 *
 * Usage:  bun scripts/generate-installer-assets.mts
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const OUT_DIR = join(import.meta.dir, "..", "build-resources");

// ── BMP helpers ──────────────────────────────────────────────────────────────

function writeLe32(buf: Buffer, offset: number, value: number) {
  buf.writeUInt32LE(value, offset);
}

function writeLe16(buf: Buffer, offset: number, value: number) {
  buf.writeUInt16LE(value, offset);
}

/**
 * Create a 24-bit uncompressed BMP buffer.
 * pixels: Float32Array-like array of [B, G, R] tuples stored row-major
 * from the TOP of the image (we flip to BMP's bottom-up order internally).
 */
function makeBMP(
  width: number,
  height: number,
  getPixel: (x: number, y: number) => [number, number, number] // returns [R, G, B]
): Buffer {
  const rowBytes = width * 3;
  // BMP rows must be padded to a multiple of 4 bytes
  const rowPadded = Math.ceil(rowBytes / 4) * 4;
  const pixelDataSize = rowPadded * height;
  const fileSize = 14 + 40 + pixelDataSize;

  const buf = Buffer.alloc(fileSize, 0);

  // ── File header (14 bytes) ────────────────────────────────────────────────
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  writeLe32(buf, 2, fileSize);        // bfSize
  writeLe32(buf, 6, 0);               // bfReserved
  writeLe32(buf, 10, 14 + 40);        // bfOffBits

  // ── DIB header BITMAPINFOHEADER (40 bytes) ────────────────────────────────
  writeLe32(buf, 14, 40);             // biSize
  writeLe32(buf, 18, width);          // biWidth
  writeLe32(buf, 22, height);         // biHeight (positive = bottom-up)
  writeLe16(buf, 26, 1);              // biPlanes
  writeLe16(buf, 28, 24);             // biBitCount
  writeLe32(buf, 30, 0);              // biCompression = BI_RGB
  writeLe32(buf, 34, pixelDataSize);  // biSizeImage
  writeLe32(buf, 38, 2835);           // biXPelsPerMeter (~72 dpi)
  writeLe32(buf, 42, 2835);           // biYPelsPerMeter
  writeLe32(buf, 46, 0);              // biClrUsed
  writeLe32(buf, 50, 0);              // biClrImportant

  // ── Pixel data (bottom-up row order) ─────────────────────────────────────
  const dataOffset = 54;
  for (let y = 0; y < height; y++) {
    // BMP row 0 = bottom of image → flip y
    const srcY = height - 1 - y;
    const rowStart = dataOffset + y * rowPadded;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, srcY);
      buf[rowStart + x * 3 + 0] = b; // BMP stores BGR
      buf[rowStart + x * 3 + 1] = g;
      buf[rowStart + x * 3 + 2] = r;
    }
  }

  return buf;
}

// ── Color definitions ────────────────────────────────────────────────────────

const WHITE:      [number, number, number] = [0xff, 0xff, 0xff];
const BLUE:       [number, number, number] = [0x3b, 0x82, 0xf6]; // #3B82F6
const LIGHT_BLUE: [number, number, number] = [0xdb, 0xea, 0xff]; // #DBEAFF subtle tint
const LIGHT_GRAY: [number, number, number] = [0xf1, 0xf5, 0xf9]; // #F1F5F9
const SEPARATOR:  [number, number, number] = [0xcb, 0xd5, 0xe1]; // #CBD5E1

// ── Sidebar: 164 × 314 ───────────────────────────────────────────────────────

const SW = 164;
const SH = 314;
const STRIPE_W = 8;       // left blue stripe width
const BOTTOM_H = 40;      // bottom gray band height
const TOP_TINT_H = 80;    // subtle blue-tinted area at top

const sidebarBuf = makeBMP(SW, SH, (x, y) => {
  // Left blue stripe
  if (x < STRIPE_W) return BLUE;
  // Separator line at top of bottom band
  if (y === BOTTOM_H) return SEPARATOR;
  // Bottom gray band
  if (y < BOTTOM_H) return LIGHT_GRAY;
  // Top tinted zone (linear fade from LIGHT_BLUE to WHITE)
  if (y >= SH - TOP_TINT_H) {
    const t = (y - (SH - TOP_TINT_H)) / TOP_TINT_H; // 0 → 1 as y goes to top
    const r = Math.round(WHITE[0] + (LIGHT_BLUE[0] - WHITE[0]) * t);
    const g = Math.round(WHITE[1] + (LIGHT_BLUE[1] - WHITE[1]) * t);
    const b = Math.round(WHITE[2] + (LIGHT_BLUE[2] - WHITE[2]) * t);
    return [r, g, b];
  }
  return WHITE;
});

const sidebarPath = join(OUT_DIR, "installer-sidebar.bmp");
writeFileSync(sidebarPath, sidebarBuf);
console.log(`✓ ${sidebarPath}  (${SW}×${SH}, ${sidebarBuf.length} bytes)`);

console.log("Done.");
