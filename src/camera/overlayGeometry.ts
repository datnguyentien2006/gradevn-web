// Hình học overlay camera — port từ Dart.
// Nguồn Dart: lib/data/cv/preview_overlay.dart
//   (CoverMapping, MarkerOverlayCalibration, MarkerOverlayCalibration.forArea).
//
// Web: vùng preview = toàn màn hình (video object-fit: cover, không
// letterbox) giống màn chụp Flutter. 4 ô ghim đặt theo calibration thực địa
// 720×1560; khi quay ngang dùng bản transpose 1560×720.

import type { PointDto, RectDto } from '../workers/protocol';

export interface Point {
  x: number;
  y: number;
}

export interface Area {
  width: number;
  height: number;
}

export interface GuideGeometry {
  /** Tâm 4 ô (px màn hình), thứ tự tl, tr, br, bl. */
  centers: Point[];
  /** Cỡ ô (px màn hình). */
  boxWidth: number;
  boxHeight: number;
}

interface Calibration {
  measureWidth: number;
  measureHeight: number;
  boxWidth: number;
  boxHeight: number;
  innerLeft: number;
  innerTop: number;
  innerRight: number;
  innerBottom: number;
  centerShift: number;
}

const PORTRAIT: Calibration = {
  measureWidth: 720,
  measureHeight: 1560,
  boxWidth: 157,
  boxHeight: 203,
  innerLeft: 0,
  innerTop: 64,
  innerRight: 719,
  innerBottom: 1177,
  centerShift: 16
};

const LANDSCAPE: Calibration = {
  measureWidth: 1560,
  measureHeight: 720,
  boxWidth: 203,
  boxHeight: 157,
  innerLeft: 64,
  innerTop: 0,
  innerRight: 1177,
  innerBottom: 719,
  centerShift: 16
};

export function calibrationForArea(area: Area): Calibration {
  return area.width >= area.height ? LANDSCAPE : PORTRAIT;
}

export function guideGeometry(area: Area): GuideGeometry {
  const cal = calibrationForArea(area);
  const halfBoxW = cal.boxWidth / 2;
  const halfBoxH = cal.boxHeight / 2;
  const fx = (px: number): number => px / cal.measureWidth;
  const fy = (py: number): number => py / cal.measureHeight;
  const leftX = fx(cal.innerLeft + halfBoxW + cal.centerShift);
  const rightX = fx(cal.innerRight + 1 - halfBoxW - cal.centerShift);
  const topY = fy(cal.innerTop + halfBoxH);
  const bottomY = fy(cal.innerBottom + 1 - halfBoxH);
  return {
    centers: [
      { x: leftX * area.width, y: topY * area.height },
      { x: rightX * area.width, y: topY * area.height },
      { x: rightX * area.width, y: bottomY * area.height },
      { x: leftX * area.width, y: bottomY * area.height }
    ],
    boxWidth: (cal.boxWidth / cal.measureWidth) * area.width,
    boxHeight: (cal.boxHeight / cal.measureHeight) * area.height
  };
}

export interface CoverMapping {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Điểm khung (px ảnh) → màn hình (px hiển thị). */
  toScreen(point: Point): Point;
  /** Điểm màn hình → khung, kẹp biên như CoverMapping.toFrame của Dart. */
  toFrame(point: Point, frame: Area): Point;
}

/** Ảnh xạ cover: lấy tỉ lệ lớn, phần lăn thừa bị cắt đối xứng hai bên. */
export function coverMapping(frame: Area, area: Area): CoverMapping {
  const scale = Math.max(
    area.width / frame.width,
    area.height / frame.height
  );
  const offsetX = (area.width - frame.width * scale) / 2;
  const offsetY = (area.height - frame.height * scale) / 2;
  const clamp = (value: number, max: number): number =>
    value < 0 ? 0 : value > max ? max : value;
  return {
    scale,
    offsetX,
    offsetY,
    toScreen(point: Point): Point {
      return {
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY
      };
    },
    toFrame(point: Point, frameArea: Area): Point {
      return {
        x: clamp((point.x - offsetX) / scale, frameArea.width),
        y: clamp((point.y - offsetY) / scale, frameArea.height)
      };
    }
  };
}

export interface OverlayRects {
  /** 4 ô theo tỉ lệ 0..1 của khung ảnh — đưa vào pipeline lúc chấm. */
  rects: RectDto[];
  /** 4 ô theo px màn hình — dùng để vẽ. */
  screenBoxes: { left: number; top: number; width: number; height: number }[];
  frameSize: Area;
}

/**
 * Quy 4 ô ghim từ màn hình về tỉ lệ khung — tương ứng
 * `_captureOverlayRects` trong scan_screen.dart.
 */
export function overlayRectsForFrame(area: Area, frame: Area): OverlayRects {
  const guide = guideGeometry(area);
  const mapping = coverMapping(frame, area);
  const halfW = guide.boxWidth / 2;
  const halfH = guide.boxHeight / 2;
  const rects: RectDto[] = [];
  const screenBoxes: { left: number; top: number; width: number; height: number }[] = [];
  for (const center of guide.centers) {
    const screenLeft = center.x - halfW;
    const screenTop = center.y - halfH;
    screenBoxes.push({
      left: screenLeft,
      top: screenTop,
      width: guide.boxWidth,
      height: guide.boxHeight
    });
    const topLeft = mapping.toFrame(
      { x: screenLeft, y: screenTop },
      frame
    );
    const bottomRight = mapping.toFrame(
      { x: screenLeft + guide.boxWidth, y: screenTop + guide.boxHeight },
      frame
    );
    rects.push({
      left: topLeft.x / frame.width,
      top: topLeft.y / frame.height,
      right: bottomRight.x / frame.width,
      bottom: bottomRight.y / frame.height
    });
  }
  return { rects, screenBoxes, frameSize: frame };
}

/** Quy tâm mốc phát hiện được (px khung) về px màn hình để vẽ. */
export function framePointToScreen(
  point: PointDto,
  frame: Area,
  area: Area
): Point {
  return coverMapping(frame, area).toScreen({ x: point.x, y: point.y });
}

/** Khoảng cách lớn nhất giữa 4 góc của 2 quad (px khung). */
export function quadMaxDistance(
  a: { tl: PointDto; tr: PointDto; br: PointDto; bl: PointDto } | null,
  b: { tl: PointDto; tr: PointDto; br: PointDto; bl: PointDto } | null
): number {
  if (!a || !b) return Infinity;
  const pairs: [PointDto, PointDto][] = [
    [a.tl, b.tl],
    [a.tr, b.tr],
    [a.br, b.br],
    [a.bl, b.bl]
  ];
  let max = 0;
  for (const [p, q] of pairs) {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d > max) max = d;
  }
  return max;
}
