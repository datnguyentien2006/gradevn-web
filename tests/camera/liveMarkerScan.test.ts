// Quét mốc live từng ô — đối chiếu APK `_analyzeMarkerFrame` / `rectReads`.
// Nguồn Dart: lib/presentation/screens/scan_screen.dart (R8/R9/R11),
// lib/data/cv/marker_blob_scan.dart.

import { describe, expect, it } from 'vitest';

import {
  coverMapping,
  guideGeometry,
  overlayRectsForFrame
} from '../../src/camera/overlayGeometry';
import {
  scanLiveMarkerBoxes,
  scanLiveMarkerBoxesDetailed,
  type LiveMarkerFrame
} from '../../src/camera/liveMarkerScan';
import { Rect } from '../../src/core/geometry';

interface Patch {
  cx: number;
  cy: number;
  width: number;
  height?: number;
  value?: number;
}

function makeFrame(
  width: number,
  height: number,
  patches: Patch[],
  background = 232
): LiveMarkerFrame {
  const data = new Uint8Array(width * height).fill(background);
  for (const patch of patches) {
    const w = Math.max(1, Math.round(patch.width));
    const h = Math.max(1, Math.round(patch.height ?? patch.width));
    const x0 = Math.max(0, Math.round(patch.cx - w / 2));
    const y0 = Math.max(0, Math.round(patch.cy - h / 2));
    const x1 = Math.min(width, x0 + w);
    const y1 = Math.min(height, y0 + h);
    for (let y = y0; y < y1; y++) {
      data.fill(patch.value ?? 18, y * width + x0, y * width + x1);
    }
  }
  return { width, height, grayAt: (x, y) => data[y * width + x] };
}

const CALIBRATION = { width: 720, height: 1560 };
const APK_BOX = { width: 157, height: 203 };
const APK_CENTERS = [
  { x: 94.5, y: 165.5 },
  { x: 625.5, y: 165.5 },
  { x: 625.5, y: 1076.5 },
  { x: 94.5, y: 1076.5 }
];

function apkRects(): Rect[] {
  return APK_CENTERS.map(
    (center) =>
      new Rect(
        (center.x - APK_BOX.width / 2) / CALIBRATION.width,
        (center.y - APK_BOX.height / 2) / CALIBRATION.height,
        (center.x + APK_BOX.width / 2) / CALIBRATION.width,
        (center.y + APK_BOX.height / 2) / CALIBRATION.height
      )
  );
}

function apkMarkers(
  size = 30,
  value = 18,
  shiftX = 0,
  shiftY = 0
): Patch[] {
  return APK_CENTERS.map((center) => ({
    cx: center.x + shiftX,
    cy: center.y + shiftY,
    width: size,
    value
  }));
}

function allOk(boxes: ReturnType<typeof scanLiveMarkerBoxes>): boolean[] {
  return boxes.map((box) => box.ok);
}

describe('scanLiveMarkerBoxes', () => {
  it('bật cả 4 ô khi mốc đen nằm đúng tâm ô', () => {
    const frame = makeFrame(CALIBRATION.width, CALIBRATION.height, apkMarkers());
    const boxes = scanLiveMarkerBoxes(frame, apkRects());
    expect(allOk(boxes)).toEqual([true, true, true, true]);
    for (const box of boxes) {
      expect(box.fill).toBeGreaterThan(0.85);
      expect(box.side).toBeGreaterThan(20);
      expect(box.centroid).not.toBeNull();
    }
  });

  it('không bật khi tâm mốc lệch ra ngoài ô gốc', () => {
    // Blob vẫn nằm trọn trong cửa sổ phóng 1.5× của ô TL, nhưng tâm nằm
    // ngoài ô gốc — APK từ chối (R9), web phải giống hệt.
    const frame = makeFrame(CALIBRATION.width, CALIBRATION.height, [
      { cx: APK_CENTERS[0].x + 95, cy: APK_CENTERS[0].y, width: 30 }
    ]);
    expect(allOk(scanLiveMarkerBoxes(frame, apkRects()))).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it('không bật ô nào khi cả 4 mốc lệch cùng hướng', () => {
    const frame = makeFrame(
      CALIBRATION.width,
      CALIBRATION.height,
      apkMarkers(30, 18, 95, 0)
    );
    expect(allOk(scanLiveMarkerBoxes(frame, apkRects()))).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it('loại mốc quá nhỏ và mốc dẹt', () => {
    const tiny = makeFrame(CALIBRATION.width, CALIBRATION.height, [
      { cx: APK_CENTERS[0].x, cy: APK_CENTERS[0].y, width: 12 }
    ]);
    expect(scanLiveMarkerBoxes(tiny, apkRects())[0].ok).toBe(false);

    const flat = makeFrame(CALIBRATION.width, CALIBRATION.height, [
      { cx: APK_CENTERS[0].x, cy: APK_CENTERS[0].y, width: 60, height: 12 }
    ]);
    expect(scanLiveMarkerBoxes(flat, apkRects())[0].ok).toBe(false);
  });

  it('ngưỡng đen p75×0.5: mốc xám trên nền sáng không bật', () => {
    // Ảnh chụp màn hình laptop: mốc xám ~146 trên nền ~232 → ngưỡng ~116.
    const grayScreen = makeFrame(
      CALIBRATION.width,
      CALIBRATION.height,
      apkMarkers(30, 146)
    );
    expect(allOk(scanLiveMarkerBoxes(grayScreen, apkRects()))).toEqual([
      false,
      false,
      false,
      false
    ]);

    const printed = makeFrame(
      CALIBRATION.width,
      CALIBRATION.height,
      apkMarkers(30, 90)
    );
    expect(allOk(scanLiveMarkerBoxes(printed, apkRects()))).toEqual([
      true,
      true,
      true,
      true
    ]);
  });

  it('khung trống không bật ô nào', () => {
    const frame = makeFrame(CALIBRATION.width, CALIBRATION.height, []);
    expect(allOk(scanLiveMarkerBoxes(frame, apkRects()))).toEqual([
      false,
      false,
      false,
      false
    ]);
  });
});

describe('quét lại ô trượt ở p75×0.8 (dự phòng iOS)', () => {
  it('mốc xám 146 trên nền 232: mặc định thư viện bỏ, bật dự phòng cả 4 xanh', () => {
    const frame = makeFrame(
      CALIBRATION.width,
      CALIBRATION.height,
      apkMarkers(30, 146)
    );
    const strict = scanLiveMarkerBoxesDetailed(frame, apkRects());
    expect(strict.map((detail) => detail.box.ok)).toEqual([
      false,
      false,
      false,
      false
    ]);
    expect(strict.every((detail) => !detail.usedFallback)).toBe(true);

    const rescued = scanLiveMarkerBoxesDetailed(frame, apkRects(), {
      allowFallback: true,
      includeDiagnostics: true
    });
    expect(rescued.map((detail) => detail.box.ok)).toEqual([
      true,
      true,
      true,
      true
    ]);
    for (const detail of rescued) {
      expect(detail.usedFallback).toBe(true);
      expect(detail.thresholdFactor).toBe(0.8);
      expect(detail.strictReason).toMatch(/no dark pixels/);
      expect(detail.reason).toBe('FOUND');
      expect(detail.diagnostics?.thresholdFactor).toBe(0.8);
      expect(detail.diagnostics!.threshold).toBeCloseTo(
        Math.max(30, Math.min(200, detail.diagnostics!.pageLevel * 0.8)),
        5
      );
    }
  });

  it('mốc đen đạt ngưỡng chuẩn không chạy dự phòng', () => {
    const frame = makeFrame(CALIBRATION.width, CALIBRATION.height, apkMarkers());
    const details = scanLiveMarkerBoxesDetailed(frame, apkRects(), {
      allowFallback: true,
      includeDiagnostics: true
    });
    for (const detail of details) {
      expect(detail.box.ok).toBe(true);
      expect(detail.usedFallback).toBe(false);
      expect(detail.strictReason).toBeNull();
      expect(detail.thresholdFactor).toBe(0.5);
      expect(detail.diagnostics?.thresholdFactor).toBe(0.5);
    }
  });

  it('dự phòng không nới luật tâm và không sinh mốc trên khung trống', () => {
    const shifted = makeFrame(
      CALIBRATION.width,
      CALIBRATION.height,
      apkMarkers(30, 18, 95, 0)
    );
    const shiftedDetails = scanLiveMarkerBoxesDetailed(shifted, apkRects(), {
      allowFallback: true
    });
    expect(shiftedDetails.map((detail) => detail.box.ok)).toEqual([
      false,
      false,
      false,
      false
    ]);
    expect(shiftedDetails[0].reason).toMatch(/centroid outside guide box/);

    const empty = makeFrame(CALIBRATION.width, CALIBRATION.height, []);
    const emptyDetails = scanLiveMarkerBoxesDetailed(empty, apkRects(), {
      allowFallback: true,
      includeDiagnostics: true
    });
    for (const detail of emptyDetails) {
      expect(detail.box.ok).toBe(false);
      expect(detail.usedFallback).toBe(true);
      expect(detail.reason).toMatch(
        /p75×0\.5: .*no dark pixels.* → p75×0\.8: .*no dark pixels/
      );
    }
  });
});

describe('chuỗi toạ độ màn hình → khung → quét', () => {
  const cases = [
    { name: 'dọc', area: { width: 428, height: 926 }, frame: { width: 1080, height: 1920 } },
    { name: 'ngang', area: { width: 926, height: 428 }, frame: { width: 1920, height: 1080 } }
  ];

  for (const testCase of cases) {
    it(`mốc đặt theo ô hướng dẫn ${testCase.name} đều xanh`, () => {
      const { area, frame } = testCase;
      const guide = guideGeometry(area);
      const mapping = coverMapping(frame, area);
      const overlay = overlayRectsForFrame(area, frame);
      const frameBoxWidth = guide.boxWidth / mapping.scale;
      const patches: Patch[] = guide.centers.map((center) => {
        const point = mapping.toFrame(center, frame);
        return { cx: point.x, cy: point.y, width: frameBoxWidth * 0.4 };
      });

      const boxes = scanLiveMarkerBoxes(
        makeFrame(frame.width, frame.height, patches),
        overlay.rects.map((rect) => new Rect(rect.left, rect.top, rect.right, rect.bottom))
      );
      expect(allOk(boxes)).toEqual([true, true, true, true]);

      overlay.rects.forEach((rect, index) => {
        const point = mapping.toFrame(guide.centers[index], frame);
        expect(((rect.left + rect.right) / 2) * frame.width).toBeCloseTo(point.x, 4);
        expect(((rect.top + rect.bottom) / 2) * frame.height).toBeCloseTo(point.y, 4);
      });
    });
  }

  it('mốc nằm giữa khung không bật ô nào', () => {
    const area = { width: 428, height: 926 };
    const frame = { width: 1080, height: 1920 };
    const overlay = overlayRectsForFrame(area, frame);
    const boxes = scanLiveMarkerBoxes(
      makeFrame(frame.width, frame.height, [
        { cx: frame.width / 2, cy: frame.height / 2, width: 120 }
      ]),
      overlay.rects.map((rect) => new Rect(rect.left, rect.top, rect.right, rect.bottom))
    );
    expect(allOk(boxes)).toEqual([false, false, false, false]);
  });
});
