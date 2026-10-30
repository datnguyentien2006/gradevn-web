// Quét ô vuông đen (mốc) trong 1 vùng ảnh xám — port 1:1 từ Dart.
// Nguồn Dart: lib/data/cv/marker_blob_scan.dart.

import { clamp, Offset, Rect } from './geometry';

export interface MarkerLocate {
  /** Tâm khối pixel tối (= tâm mốc thật). */
  centroid: Offset;
  /** Cỡ cạnh ước lượng từ bbox khối tối (px). */
  side: number;
  /** Tỉ lệ pixel tối trên bbox (0..1) — mốc là khối ĐẶC. */
  fill: number;
}

export interface LocateDarkBlobOptions {
  width: number;
  height: number;
  region: Rect;
  grayAt: (x: number, y: number) => number;
  minFill?: number;
  aspectMin?: number;
  aspectMax?: number;
  minAreaCells?: number;
  minSidePx?: number;
  maxSidePx?: number;
}

/**
 * Tìm blob tối trong 1 vùng ảnh xám.
 *
 * Thuật toán khớp Dart:
 *  1. Ngưỡng đen = phân vị 75 × 0.5 của cửa sổ.
 *  2. Mask + BFS thành phần liên thông trên lưới bước subsample.
 *  3. Giữ khối gần-ĐẶC (fill ≥ 0.5) gần-vuông (aspect 0.55..1.8) đủ to.
 *  4. Khối gần tâm cửa sổ nhất thắng (cộng hưởng nhẹ `area × 0.01`).
 */
export function locateDarkBlobInRegion(options: LocateDarkBlobOptions): MarkerLocate | null {
  const {
    width,
    height,
    region,
    grayAt,
    minFill = 0.5,
    aspectMin = 0.55,
    aspectMax = 1.8,
    minAreaCells = 8,
    minSidePx = 0,
    maxSidePx = Infinity
  } = options;

  const x0 = Math.trunc(clamp(region.left, 0, width - 1));
  const y0 = Math.trunc(clamp(region.top, 0, height - 1));
  const x1 = Math.trunc(clamp(region.right, x0 + 8, width));
  const y1 = Math.trunc(clamp(region.bottom, y0 + 8, height));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 8 || rh < 8) return null;

  const step = Math.max(1, Math.floor(Math.min(rw, rh) / 48));

  const hist = new Int32Array(256);
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      hist[grayAt(x, y)]++;
      count++;
    }
  }
  if (count === 0) return null;

  let acc = 0;
  let pageLevel = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= count * 0.25) {
      pageLevel = v;
      break;
    }
  }
  const threshold = clamp(pageLevel * 0.5, 30, 200);

  const gw = Math.ceil(rw / step);
  const gh = Math.ceil(rh / step);
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const yy = y0 + gy * step;
    for (let gx = 0; gx < gw; gx++) {
      mask[gy * gw + gx] = grayAt(x0 + gx * step, yy) < threshold ? 1 : 0;
    }
  }

  const visited = new Uint8Array(gw * gh);
  const stack: number[] = [];
  let best: MarkerLocate | null = null;
  let bestDist = Infinity;
  const cxImg = x0 + rw / 2;
  const cyImg = y0 + rh / 2;

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    visited[start] = 1;
    stack.push(start);
    let minX = start % gw;
    let maxX = minX;
    let minY = Math.floor(start / gw);
    let maxY = minY;
    let area = 0;

    while (stack.length > 0) {
      const i = stack.pop()!;
      const iy = Math.floor(i / gw);
      const ix = i % gw;
      area++;
      if (ix < minX) minX = ix;
      if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy;
      if (iy > maxY) maxY = iy;
      if (ix + 1 < gw && mask[i + 1] === 1 && visited[i + 1] === 0) {
        visited[i + 1] = 1;
        stack.push(i + 1);
      }
      if (ix > 0 && mask[i - 1] === 1 && visited[i - 1] === 0) {
        visited[i - 1] = 1;
        stack.push(i - 1);
      }
      if (iy + 1 < gh && mask[i + gw] === 1 && visited[i + gw] === 0) {
        visited[i + gw] = 1;
        stack.push(i + gw);
      }
      if (iy > 0 && mask[i - gw] === 1 && visited[i - gw] === 0) {
        visited[i - gw] = 1;
        stack.push(i - gw);
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (area < minAreaCells) continue;
    const fill = area / (bw * bh);
    if (fill < minFill) continue;
    const aspect = bw / bh;
    if (aspect < aspectMin || aspect > aspectMax) continue;
    const side = ((bw + bh) / 2) * step;
    if (side < minSidePx || side > maxSidePx) continue;
    const centroid = new Offset(
      x0 + ((minX + maxX + 1) / 2) * step,
      y0 + ((minY + maxY + 1) / 2) * step
    );
    const dist = centroid.distanceTo(new Offset(cxImg, cyImg)) - area * 0.01;
    if (dist < bestDist) {
      bestDist = dist;
      best = { centroid, side, fill };
    }
  }
  return best;
}
