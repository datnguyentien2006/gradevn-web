// Quét ô vuông đen (mốc) trong 1 vùng ảnh xám — port 1:1 từ Dart.
// Nguồn Dart: lib/data/cv/marker_blob_scan.dart.
//
// `locateDarkBlobInRegionDetailed` trả thêm số liệu chẩn đoán (ngưỡng, số pixel
// tối, blob gần tâm nhất + lý do loại) phục vụ màn chẩn đoán trên iPhone.
// `locateDarkBlobInRegion` giữ nguyên hành vi cũ và dùng chung phần lõi.

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
  /** Hệ số nhân phân vị 75 (Dart: 0.5). Chỉ đổi khi bật chế độ dễ tính. */
  thresholdFactor?: number;
  /** Kèm mask nhị phân của vùng ROI (cho thumbnail chẩn đoán). */
  includeMask?: boolean;
}

export type BlobRejectReason =
  | 'area-too-small'
  | 'fill-too-low'
  | 'aspect-out-of-range'
  | 'side-out-of-range';

export interface BlobBBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BlobCandidateDetail {
  bbox: BlobBBox;
  centroid: Offset;
  side: number;
  fill: number;
  aspect: number;
  /** Diện tích khối (px²) / diện tích ROI (px²). */
  areaRatio: number;
  /** Khoảng cách tâm blob → tâm ROI (px, chưa trừ ưu tiên diện tích). */
  distance: number;
  /** Khối chạm mép lưới quét (ROI) — chỉ để chẩn đoán, không phải luật loại. */
  touchesRegionEdge: boolean;
  accepted: boolean;
  reason: BlobRejectReason | null;
}

export interface BlobMask {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface BlobScanDiagnostics {
  region: BlobBBox;
  step: number;
  pageLevel: number;
  threshold: number;
  thresholdFactor: number;
  sampledPixels: number;
  darkPixels: number;
  componentCount: number;
  rejectionCounts: Record<BlobRejectReason, number>;
  /** Blob gần tâm ROI nhất (kể cả bị loại) + lý do. */
  closest: BlobCandidateDetail | null;
  mask: BlobMask | null;
}

/**
 * Tìm blob tối trong 1 vùng ảnh xám.
 *
 * Thuật toán khớp Dart:
 *  1. Ngưỡng đen = phân vị 75 × 0.5 của cửa sổ (clamp 30..200).
 *  2. Mask + BFS thành phần liên thông trên lưới bước subsample.
 *  3. Giữ khối gần-ĐẶC (fill ≥ 0.5) gần-vuông (aspect 0.55..1.8) đủ to.
 *  4. Khối gần tâm cửa sổ nhất thắng (cộng hưởng nhẹ `area × 0.01`).
 */
export function locateDarkBlobInRegion(options: LocateDarkBlobOptions): MarkerLocate | null {
  return locateDarkBlobInRegionDetailed(options).locate;
}

export function locateDarkBlobInRegionDetailed(options: LocateDarkBlobOptions): {
  locate: MarkerLocate | null;
  diagnostics: BlobScanDiagnostics;
} {
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
    maxSidePx = Infinity,
    thresholdFactor = 0.5,
    includeMask = false
  } = options;

  const x0 = Math.trunc(clamp(region.left, 0, width - 1));
  const y0 = Math.trunc(clamp(region.top, 0, height - 1));
  const x1 = Math.trunc(clamp(region.right, x0 + 8, width));
  const y1 = Math.trunc(clamp(region.bottom, y0 + 8, height));
  const rw = x1 - x0;
  const rh = y1 - y0;
  const emptyDiagnostics = (): BlobScanDiagnostics => ({
    region: { left: x0, top: y0, right: x1, bottom: y1 },
    step: 1,
    pageLevel: 255,
    threshold: 0,
    thresholdFactor,
    sampledPixels: 0,
    darkPixels: 0,
    componentCount: 0,
    rejectionCounts: createRejectionCounts(),
    closest: null,
    mask: null
  });
  if (rw < 8 || rh < 8) {
    return { locate: null, diagnostics: emptyDiagnostics() };
  }

  const step = Math.max(1, Math.floor(Math.min(rw, rh) / 48));

  const hist = new Int32Array(256);
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      hist[grayAt(x, y)]++;
      count++;
    }
  }
  if (count === 0) {
    return { locate: null, diagnostics: emptyDiagnostics() };
  }

  let acc = 0;
  let pageLevel = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= count * 0.25) {
      pageLevel = v;
      break;
    }
  }
  const threshold = clamp(pageLevel * thresholdFactor, 30, 200);

  const gw = Math.ceil(rw / step);
  const gh = Math.ceil(rh / step);
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const yy = y0 + gy * step;
    for (let gx = 0; gx < gw; gx++) {
      mask[gy * gw + gx] = grayAt(x0 + gx * step, yy) < threshold ? 1 : 0;
    }
  }

  const rejectionCounts = createRejectionCounts();
  const visited = new Uint8Array(gw * gh);
  const stack: number[] = [];
  let best: MarkerLocate | null = null;
  let bestDist = Infinity;
  const cxImg = x0 + rw / 2;
  const cyImg = y0 + rh / 2;
  let closest: BlobCandidateDetail | null = null;
  let closestDist = Infinity;
  let componentCount = 0;
  let darkPixels = 0;
  for (let i = 0; i < mask.length; i++) darkPixels += mask[i];

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
    const fill = area / (bw * bh);
    const aspect = bw / bh;
    const side = ((bw + bh) / 2) * step;
    const centroid = new Offset(
      x0 + ((minX + maxX + 1) / 2) * step,
      y0 + ((minY + maxY + 1) / 2) * step
    );
    const distance = centroid.distanceTo(new Offset(cxImg, cyImg));

    let reason: BlobRejectReason | null = null;
    if (area < minAreaCells) {
      reason = 'area-too-small';
    } else if (fill < minFill) {
      reason = 'fill-too-low';
    } else if (aspect < aspectMin || aspect > aspectMax) {
      reason = 'aspect-out-of-range';
    } else if (side < minSidePx || side > maxSidePx) {
      reason = 'side-out-of-range';
    }

    const detail: BlobCandidateDetail = {
      bbox: {
        left: x0 + minX * step,
        top: y0 + minY * step,
        right: x0 + Math.min(gw - 1, maxX) * step + step,
        bottom: y0 + Math.min(gh - 1, maxY) * step + step
      },
      centroid,
      side,
      fill,
      aspect,
      areaRatio: (area * step * step) / (rw * rh),
      distance,
      touchesRegionEdge: minX === 0 || minY === 0 || maxX === gw - 1 || maxY === gh - 1,
      accepted: reason == null,
      reason
    };
    if (distance < closestDist) {
      closestDist = distance;
      closest = detail;
    }

    if (area < minAreaCells) continue;
    componentCount++;
    if (reason != null) {
      rejectionCounts[reason]++;
      continue;
    }
    const dist = distance - area * 0.01;
    if (dist < bestDist) {
      bestDist = dist;
      best = { centroid, side, fill };
    }
  }

  return {
    locate: best,
    diagnostics: {
      region: { left: x0, top: y0, right: x1, bottom: y1 },
      step,
      pageLevel,
      threshold,
      thresholdFactor,
      sampledPixels: count,
      darkPixels,
      componentCount,
      rejectionCounts,
      closest,
      mask: includeMask
        ? {
            data: maskToRgba(mask, gw, gh),
            width: gw,
            height: gh
          }
        : null
    }
  };
}

function createRejectionCounts(): Record<BlobRejectReason, number> {
  return {
    'area-too-small': 0,
    'fill-too-low': 0,
    'aspect-out-of-range': 0,
    'side-out-of-range': 0
  };
}

function maskToRgba(mask: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] === 1 ? 0 : 255;
    const j = i * 4;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}
