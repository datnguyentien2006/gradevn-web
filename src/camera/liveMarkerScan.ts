// Quét mốc từng ô trên khung preview — port `rectReads` của
// scan_screen.dart `_analyzeMarkerFrame` (R8/R9/R11).
//
// Ô xanh = CHÍNH phép quét của đường chụp đọc được mốc trong ô này:
// cửa sổ phóng 1.5×, blob đặc/gần vuông/cỡ "ô đen in", tâm blob phải nằm
// trong ô gốc. Không phụ thuộc detector toàn trang.

import { expandFractionRect, Offset, Rect } from '../core/geometry';
import { locateDarkBlobInRegion } from '../core/markerBlobScan';

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

/**
 * Quét tối đa 4 ô (thứ tự tl, tr, br, bl).
 * [rects] là tỉ lệ 0..1 của khung đã quét, cùng hệ với [frame].
 */
export function scanLiveMarkerBoxes(
  frame: LiveMarkerFrame,
  rects: readonly Rect[]
): LiveMarkerBox[] {
  return rects.slice(0, 4).map((rect) => scanLiveMarkerBox(frame, rect));
}

function scanLiveMarkerBox(
  frame: LiveMarkerFrame,
  rect: Rect
): LiveMarkerBox {
  const { width, height, grayAt } = frame;
  const shortRect = Math.min(rect.width * width, rect.height * height);
  const expanded = expandFractionRect(rect, 1.5);
  const locate = locateDarkBlobInRegion({
    width,
    height,
    region: new Rect(
      expanded.left * width,
      expanded.top * height,
      expanded.right * width,
      expanded.bottom * height
    ),
    grayAt,
    minFill: 0.6,
    aspectMin: 0.6,
    aspectMax: 1.65,
    minSidePx: Math.max(4, shortRect * 0.12),
    maxSidePx: shortRect * 0.95
  });
  if (!locate) {
    return { ok: false, fill: 0, side: 0, centroid: null };
  }
  const center = new Offset(locate.centroid.dx / width, locate.centroid.dy / height);
  return {
    ok: rect.contains(center),
    fill: locate.fill,
    side: locate.side,
    centroid: locate.centroid
  };
}
