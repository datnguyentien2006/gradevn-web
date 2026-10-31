// Quét mốc từng ô trên khung preview — port `rectReads` của
// scan_screen.dart `_analyzeMarkerFrame` (R8/R9/R11).
//
// Ô xanh = CHÍNH phép quét của đường chụp đọc được mốc trong ô này:
// cửa sổ phóng 1.5×, blob đặc/gần vuông/cỡ "ô đen in", tâm blob phải nằm
// trong ô gốc. Không phụ thuộc detector toàn trang.
//
// `scanLiveMarkerBoxesDetailed` trả thêm lý do từng ô (ngưỡng, số pixel tối,
// blob gần tâm nhất, lỗi loại) cho màn chẩn đoán iOS.

import { expandFractionRect, Offset, Rect } from '../core/geometry';
import {
  locateDarkBlobInRegionDetailed,
  type BlobScanDiagnostics
} from '../core/markerBlobScan';

export interface LiveMarkerFrame {
  width: number;
  height: number;
  grayAt: (x: number, y: number) => number;
}

export interface LiveMarkerBox {
  /** Blob đủ tiêu chí và tâm nằm trong ô gốc. */
  ok: boolean;
  fill: number;
  /** Cạnh blob (px khung quét), 0 khi không tìm thấy. */
  side: number;
  centroid: Offset | null;
}

export interface LiveMarkerScanOptions {
  /** Hệ số ngưỡng p75 (Dart: 0.5). Chế độ iOS dễ tính dùng 0.8. */
  thresholdFactor?: number;
  /** Kèm số liệu + mask từng ô. */
  includeDiagnostics?: boolean;
}

export interface LiveMarkerBoxDetail {
  box: LiveMarkerBox;
  /** Ô ghim gốc (tỉ lệ khung). */
  guideRect: Rect;
  /** Ô ghim gốc trong pixel khung. */
  guidePx: Rect;
  /** Cửa sổ quét 1.5× trong pixel khung. */
  scanPx: Rect;
  diagnostics: BlobScanDiagnostics | null;
  /** Lý do ngắn gọn để hiển thị/gửi kèm. */
  reason: string;
}

/**
 * Quét tối đa 4 ô (thứ tự tl, tr, br, bl).
 * [rects] là tỉ lệ 0..1 của khung đã quét, cùng hệ với [frame].
 */
export function scanLiveMarkerBoxes(
  frame: LiveMarkerFrame,
  rects: readonly Rect[],
  options: LiveMarkerScanOptions = {}
): LiveMarkerBox[] {
  return rects
    .slice(0, 4)
    .map((rect) => scanLiveMarkerBox(frame, rect, options).box);
}

export function scanLiveMarkerBoxesDetailed(
  frame: LiveMarkerFrame,
  rects: readonly Rect[],
  options: LiveMarkerScanOptions = {}
): LiveMarkerBoxDetail[] {
  return rects
    .slice(0, 4)
    .map((rect) => scanLiveMarkerBox(frame, rect, options));
}

function scanLiveMarkerBox(
  frame: LiveMarkerFrame,
  rect: Rect,
  options: LiveMarkerScanOptions
): LiveMarkerBoxDetail {
  const { width, height, grayAt } = frame;
  const shortRect = Math.min(rect.width * width, rect.height * height);
  const expanded = expandFractionRect(rect, 1.5);
  const scanPx = new Rect(
    expanded.left * width,
    expanded.top * height,
    expanded.right * width,
    expanded.bottom * height
  );
  const guidePx = new Rect(
    rect.left * width,
    rect.top * height,
    rect.right * width,
    rect.bottom * height
  );
  const limits = {
    minFill: 0.6,
    aspectMin: 0.6,
    aspectMax: 1.65,
    minSidePx: Math.max(4, shortRect * 0.12),
    maxSidePx: shortRect * 0.95
  };
  const locateOptions = {
    width,
    height,
    region: scanPx,
    grayAt,
    ...limits,
    thresholdFactor: options.thresholdFactor ?? 0.5,
    includeMask: options.includeDiagnostics ?? false
  };
  const { locate, diagnostics } = locateDarkBlobInRegionDetailed(locateOptions);

  if (!locate) {
    return {
      box: { ok: false, fill: 0, side: 0, centroid: null },
      guideRect: rect,
      guidePx,
      scanPx,
      diagnostics: options.includeDiagnostics ? diagnostics : null,
      reason: describeFailure(diagnostics, limits)
    };
  }
  const center = new Offset(locate.centroid.dx / width, locate.centroid.dy / height);
  const ok = rect.contains(center);
  return {
    box: {
      ok,
      fill: locate.fill,
      side: locate.side,
      centroid: locate.centroid
    },
    guideRect: rect,
    guidePx,
    scanPx,
    diagnostics: options.includeDiagnostics ? diagnostics : null,
    reason: ok ? 'FOUND' : 'centroid outside guide box'
  };
}

function describeFailure(
  diagnostics: BlobScanDiagnostics,
  limits: { minFill: number; aspectMin: number; aspectMax: number; minSidePx: number; maxSidePx: number }
): string {
  if (diagnostics.darkPixels === 0) {
    return `no dark pixels (threshold ${round1(diagnostics.threshold)}, p75 ${diagnostics.pageLevel})`;
  }
  const blob = diagnostics.closest;
  if (!blob) {
    return `no blob (threshold ${round1(diagnostics.threshold)}, dark px ${diagnostics.darkPixels})`;
  }
  switch (blob.reason) {
    case 'area-too-small':
      return 'area too small';
    case 'fill-too-low':
      return `fill ${round2(blob.fill)} < ${round2(limits.minFill)}`;
    case 'aspect-out-of-range':
      return `aspect ${round2(blob.aspect)} outside ${round2(limits.aspectMin)}..${round2(
        limits.aspectMax
      )}`;
    case 'side-out-of-range':
      return `side ${round1(blob.side)} px outside ${round1(limits.minSidePx)}..${round1(
        limits.maxSidePx
      )}`;
    default:
      return 'no blob';
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
