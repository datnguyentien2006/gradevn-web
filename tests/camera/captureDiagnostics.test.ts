// Hồi quy cho chẩn đoán iOS: mapping cover-crop, lý do loại từng ô,
// stride RGBA, xoay 0/90/180/270 của ảnh chụp, và cảnh báo khi quad ghim
// không khớp sau khi nắn (không được im lặng chấm bằng ô ghim sai).

import { describe, expect, it } from 'vitest';

import {
  coverMapping,
  guideGeometry,
  overlayRectsForFrame,
  type Area
} from '../../src/camera/overlayGeometry';
import {
  cloneImage,
  type DecodedImage
} from '../../src/camera/imageInput';
import {
  scanLiveMarkerBoxesDetailed,
  type LiveMarkerFrame
} from '../../src/camera/liveMarkerScan';
import { AlignmentQuad, Offset, Rect, Size } from '../../src/core/geometry';
import { OmrScanService } from '../../src/core/scanService';
import { SheetLayout } from '../../src/core/sheetLayout';
import type { SheetSpec } from '../../src/core/types';

const SPEC: SheetSpec = {
  formType: 'standard',
  orientation: 'portrait',
  questionCount: 40,
  answerChoices: 4,
  maxScore: 10
};

const AREA: Area = { width: 390, height: 844 };

interface Patch {
  cx: number;
  cy: number;
  side: number;
  value: number;
}

function makeFrame(
  width: number,
  height: number,
  patches: Patch[],
  background = 235
): LiveMarkerFrame & { data: Uint8Array } {
  const data = new Uint8Array(width * height).fill(background);
  for (const patch of patches) {
    const x0 = Math.max(0, Math.round(patch.cx - patch.side / 2));
    const y0 = Math.max(0, Math.round(patch.cy - patch.side / 2));
    const x1 = Math.min(width, Math.round(patch.cx + patch.side / 2));
    const y1 = Math.min(height, Math.round(patch.cy + patch.side / 2));
    for (let y = y0; y < y1; y++) {
      data.fill(patch.value, y * width + x0, y * width + x1);
    }
  }
  return { width, height, data, grayAt: (x, y) => data[y * width + x] };
}

/** Mốc đen đặt đúng tâm 4 ô hướng dẫn đã quy về khung video. */
function markersFor(frame: Area): Patch[] {
  const guide = guideGeometry(AREA);
  const mapping = coverMapping(frame, AREA);
  const side = (guide.boxWidth / mapping.scale) * 0.18;
  return guide.centers.map((center) => {
    const point = mapping.toFrame(center, frame);
    return { cx: point.x, cy: point.y, side, value: 22 };
  });
}

function dtoRects(frame: Area): Rect[] {
  return overlayRectsForFrame(AREA, frame).rects.map(
    (rect) => new Rect(rect.left, rect.top, rect.right, rect.bottom)
  );
}

function rgbaFrom(frame: LiveMarkerFrame & { data: Uint8Array }): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let i = 0; i < frame.data.length; i++) {
    const value = frame.data[i];
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

describe('cover-crop ROI mapping 390×844', () => {
  const cases: { name: string; frame: Area }[] = [
    { name: 'video 1920×1080 (landscape trong màn dọc)', frame: { width: 1920, height: 1080 } },
    { name: 'video 1080×1920 (dọc)', frame: { width: 1080, height: 1920 } },
    { name: 'video 1280×720', frame: { width: 1280, height: 720 } },
    { name: 'video 720×1280', frame: { width: 720, height: 1280 } }
  ];

  for (const testCase of cases) {
    it(`mốc thẳng đứng trong ${testCase.name} đều FOUND`, () => {
      const frame = makeFrame(testCase.frame.width, testCase.frame.height, markersFor(testCase.frame));
      const details = scanLiveMarkerBoxesDetailed(frame, dtoRects(testCase.frame), {
        includeDiagnostics: true
      });
      expect(details.map((detail) => detail.box.ok)).toEqual([true, true, true, true]);
      expect(details.map((detail) => detail.reason)).toEqual([
        'FOUND',
        'FOUND',
        'FOUND',
        'FOUND'
      ]);

      const mapping = coverMapping(testCase.frame, AREA);
      const guide = guideGeometry(AREA);
      const overlay = overlayRectsForFrame(AREA, testCase.frame);
      overlay.rects.forEach((rect, index) => {
        // Tâm ô quy đổi phải trùng tâm hướng dẫn trên màn hình, kể cả khi
        // cover cắt bớt hai bên (1920×1080 trong 390×844).
        const screen = mapping.toScreen({
          x: ((rect.left + rect.right) / 2) * testCase.frame.width,
          y: ((rect.top + rect.bottom) / 2) * testCase.frame.height
        });
        expect(screen.x).toBeCloseTo(guide.centers[index].x, 3);
        expect(screen.y).toBeCloseTo(guide.centers[index].y, 3);
      });

      for (const detail of details) {
        const mask = detail.diagnostics?.mask;
        expect(mask).not.toBeNull();
        expect(mask!.data.byteLength).toBe(mask!.width * mask!.height * 4);
      }
    });
  }
});

describe('xoay ảnh chụp 0/90/180/270', () => {
  const previewFrame: Area = { width: 1080, height: 1920 };

  function rotateGray(
    source: Uint8Array,
    width: number,
    height: number,
    rotation: number
  ): { data: Uint8Array; width: number; height: number } {
    if (rotation === 0) return { data: source, width, height };
    if (rotation === 2) {
      const data = new Uint8Array(source.length);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          data[(height - 1 - y) * width + (width - 1 - x)] = source[y * width + x];
        }
      }
      return { data, width, height };
    }
    const outWidth = height;
    const outHeight = width;
    const data = new Uint8Array(source.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rotation === 1) {
          // Xoay 90° theo chiều kim đồng hồ.
          data[x * outWidth + (height - 1 - y)] = source[y * width + x];
        } else {
          // Xoay 270° (ngược chiều kim đồng hồ).
          data[(width - 1 - x) * outWidth + y] = source[y * width + x];
        }
      }
    }
    return { data, width: outWidth, height: outHeight };
  }

  function expectedPoint(point: { x: number; y: number }, rotation: number): { x: number; y: number } {
    switch (rotation) {
      case 1:
        return { x: previewFrame.height - point.y, y: point.x };
      case 2:
        return { x: previewFrame.width - point.x, y: previewFrame.height - point.y };
      case 3:
        return { x: point.y, y: previewFrame.width - point.x };
      default:
        return point;
    }
  }

  const guide = guideGeometry(AREA);
  const mapping = coverMapping(previewFrame, AREA);
  const centers = guide.centers.map((center) => mapping.toFrame(center, previewFrame));
  const side = (guide.boxWidth / mapping.scale) * 0.18;
  const base = makeFrame(
    previewFrame.width,
    previewFrame.height,
    centers.map((point) => ({ cx: point.x, cy: point.y, side, value: 20 }))
  );
  const overlayRects = overlayRectsForFrame(AREA, previewFrame).rects;

  for (const rotation of [0, 1, 2, 3]) {
    it(`quad ghim vẫn tìm đúng 4 mốc khi ảnh chụp xoay ${rotation * 90}°`, () => {
      const rotated = rotateGray(base.data, base.width, base.height, rotation);
      const rgb = new Uint8Array(rotated.width * rotated.height * 4);
      for (let i = 0; i < rotated.data.length; i++) {
        const value = rotated.data[i];
        rgb[i * 4] = value;
        rgb[i * 4 + 1] = value;
        rgb[i * 4 + 2] = value;
        rgb[i * 4 + 3] = 255;
      }

      const photo = new OmrScanService().scanPhoto(
        { data: rgb, width: rotated.width, height: rotated.height },
        {
          spec: SPEC,
          overlayRects: overlayRects.map(
            (rect) => new Rect(rect.left, rect.top, rect.right, rect.bottom)
          ),
          frameSize: new Size(previewFrame.width, previewFrame.height),
          requireVerifiedWarp: false
        }
      );
      expect(photo).not.toBeNull();
      expect(photo!.diagnostics).toBeNull();
      photo!.quad.corners.forEach((corner: Offset, index: number) => {
        const expected = expectedPoint(centers[index], rotation);
        const error = Math.hypot(corner.dx - expected.x, corner.dy - expected.y);
        expect(
          error,
          `rotation ${rotation}, corner ${index}: (${corner.dx.toFixed(
            0
          )},${corner.dy.toFixed(0)}) vs (${expected.x.toFixed(0)},${expected.y.toFixed(0)})`
        ).toBeLessThan(9);
      });
    });
  }
});

describe('lý do loại từng ô chẩn đoán', () => {
  const frame = { width: 720, height: 1560 };
  const centers = [
    { x: 94.5, y: 165.5 },
    { x: 625.5, y: 165.5 },
    { x: 625.5, y: 1076.5 },
    { x: 94.5, y: 1076.5 }
  ];
  const box = { width: 157, height: 203 };

  function rects(): Rect[] {
    return centers.map(
      (center) =>
        new Rect(
          (center.x - box.width / 2) / frame.width,
          (center.y - box.height / 2) / frame.height,
          (center.x + box.width / 2) / frame.width,
          (center.y + box.height / 2) / frame.height
        )
    );
  }

  it('không có pixel tối → nêu ngưỡng và p75', () => {
    const scene = makeFrame(frame.width, frame.height, []);
    const details = scanLiveMarkerBoxesDetailed(scene, rects(), {
      includeDiagnostics: true
    });
    for (const detail of details) {
      expect(detail.box.ok).toBe(false);
      expect(detail.reason).toMatch(/no dark pixels/);
      expect(detail.reason).toMatch(/threshold/);
    }
  });

  it('blob quá nhỏ / quá dẹt / quá rỗng đều có lý do cụ thể', () => {
    const tiny = makeFrame(frame.width, frame.height, [
      { cx: centers[0].x, cy: centers[0].y, side: 12, value: 18 }
    ]);
    expect(scanLiveMarkerBoxesDetailed(tiny, rects(), { includeDiagnostics: true })[0].reason).toMatch(
      /area too small|side .*outside/
    );

    const data = new Uint8Array(frame.width * frame.height).fill(235);
    for (let y = Math.round(centers[1].y - 6); y < Math.round(centers[1].y + 6); y++) {
      data.fill(18, y * frame.width + Math.round(centers[1].x - 35), y * frame.width + Math.round(centers[1].x + 35));
    }
    const flat = { ...frame, data, grayAt: (x: number, y: number) => data[y * frame.width + x] };
    const flatReason = scanLiveMarkerBoxesDetailed(flat, rects(), {
      includeDiagnostics: true
    })[1].reason;
    expect(flatReason).toMatch(/aspect|fill|side/);

    // Khung rỗng: đủ cạnh nhưng ruột trắng → đặc thấp (fill-too-low).
    const ring = new Uint8Array(frame.width * frame.height).fill(235);
    const size = 44;
    const border = 5;
    for (let y = Math.round(centers[2].y - size / 2); y < Math.round(centers[2].y + size / 2); y++) {
      for (let x = Math.round(centers[2].x - size / 2); x < Math.round(centers[2].x + size / 2); x++) {
        const edge =
          x < centers[2].x - size / 2 + border ||
          x >= centers[2].x + size / 2 - border ||
          y < centers[2].y - size / 2 + border ||
          y >= centers[2].y + size / 2 - border;
        if (edge) ring[y * frame.width + x] = 18;
      }
    }
    const ringFrame = { ...frame, data: ring, grayAt: (x: number, y: number) => ring[y * frame.width + x] };
    expect(
      scanLiveMarkerBoxesDetailed(ringFrame, rects(), { includeDiagnostics: true })[2].reason
    ).toMatch(/fill 0\.4 < 0\.6/);
  });

  it('mask ngưỡng đúng kích thước RGBA', () => {
    const scene = makeFrame(frame.width, frame.height, [
      { cx: centers[0].x, cy: centers[0].y, side: 30, value: 18 }
    ]);
    const detail = scanLiveMarkerBoxesDetailed(scene, rects(), {
      includeDiagnostics: true
    })[0];
    const mask = detail.diagnostics!.mask!;
    expect(mask.width * mask.height * 4).toBe(mask.data.byteLength);
    expect(detail.diagnostics!.threshold).toBeCloseTo(
      Math.max(30, Math.min(200, detail.diagnostics!.pageLevel * 0.5)),
      5
    );
  });

  it('chế độ dễ tính p75×0.8 bật mốc xám mà APK p75×0.5 bỏ qua', () => {
    // mốc 146 trên nền 232: p75≈232 → ngưỡng APK≈116 (loại), dễ tính≈185 (nhận).
    const grayScene = makeFrame(
      frame.width,
      frame.height,
      centers.map((center) => ({ cx: center.x, cy: center.y, side: 30, value: 146 }))
    );
    const strict = scanLiveMarkerBoxesDetailed(grayScene, rects());
    expect(strict.map((detail) => detail.box.ok)).toEqual([false, false, false, false]);
    const tolerant = scanLiveMarkerBoxesDetailed(grayScene, rects(), {
      thresholdFactor: 0.8
    });
    expect(tolerant.map((detail) => detail.box.ok)).toEqual([true, true, true, true]);
  });

  it('vùng ROI phóng 1.5× và tâm ngoài ô gốc bị từ chối', () => {
    const scene = makeFrame(frame.width, frame.height, [
      { cx: centers[0].x + 95, cy: centers[0].y, side: 30, value: 18 }
    ]);
    const detail = scanLiveMarkerBoxesDetailed(scene, rects(), {
      includeDiagnostics: true
    })[0];
    expect(detail.box.ok).toBe(false);
    expect(detail.reason).toBe('centroid outside guide box');
    expect(detail.guidePx.left).toBeCloseTo((centers[0].x - box.width / 2), 6);
    expect(detail.scanPx.left).toBeLessThan(detail.guidePx.left);
  });
});

describe('stride RGBA', () => {
  it('buffer sai kích thước bị từ chối kèm thông số', () => {
    const service = new OmrScanService();
    expect(() =>
      service.scanPhoto(
        { data: new Uint8ClampedArray(100), width: 10, height: 10 },
        { spec: SPEC }
      )
    ).toThrow(/Kích thước pixel không khớp: 100 byte, cần 10×10×4 = 400/);
  });
});

describe('quad ghim sai không được im lặng', () => {
  it('mốc thật mờ + mồi đen gần ô → cảnh báo hoặc cứu bằng quad đạt', () => {
    const frame: Area = { width: 1600, height: 900 };
    const guide = guideGeometry(AREA);
    const mapping = coverMapping(frame, AREA);
    const patches: Patch[] = [];
    const boxWidth = guide.boxWidth / mapping.scale;
    const boxHeight = guide.boxHeight / mapping.scale;
    guide.centers.forEach((center, index) => {
      const point = mapping.toFrame(center, frame);
      patches.push({ cx: point.x, cy: point.y, side: boxWidth * 0.18, value: 146 });
      const dx = (index % 2 === 0 ? 1 : -1) * boxWidth * 0.22;
      const dy = (index < 2 ? 1 : -1) * boxHeight * 0.18;
      patches.push({ cx: point.x + dx, cy: point.y + dy, side: boxWidth * 0.18, value: 28 });
    });
    const scene = makeFrame(frame.width, frame.height, patches, 232);

    const photo = new OmrScanService().scanPhoto(
      { data: rgbaFrom(scene), width: frame.width, height: frame.height },
      {
        spec: SPEC,
        overlayRects: dtoRects(frame),
        frameSize: new Size(frame.width, frame.height),
        diagnoseAlignment: true,
        requireVerifiedWarp: false
      }
    );
    expect(photo).not.toBeNull();
    const diagnostics = photo!.diagnostics!;
    expect(diagnostics.alignmentCheck).not.toBeNull();
    if (!diagnostics.rescuedQuad) {
      // Dart vẫn trả kết quả ở chế độ best-effort — nhưng UI phải cảnh báo.
      expect(diagnostics.quadSource).toBe('overlayRects');
      expect(diagnostics.alignmentWarning).toBe(true);
      expect(photo!.quad.corners.map((corner) => corner.dx)).toEqual(
        diagnostics.pinnedQuad!.corners.map((corner) => corner.dx)
      );
    } else {
      // Cứu bằng quad KHÁC (detector hoặc biến thể hướng còn lại của ô ghim).
      expect(diagnostics.alignmentCheck!.passed).toBe(true);
      const pinned = diagnostics.pinnedQuad!;
      const moved = photo!.quad.corners.some((corner, index) => {
        const before = pinned.corners[index];
        return Math.hypot(corner.dx - before.dx, corner.dy - before.dy) > 2;
      });
      expect(moved).toBe(true);
    }
  });
});

describe('ảnh chụp sống sót sau khi transfer sang worker', () => {
  it('cloneImage giữ nguyên pixel khi buffer gốc bị transfer', () => {
    const source = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    const image: DecodedImage = { data: source, width: 1, height: 2 };
    const copy = cloneImage(image);
    structuredClone(source.buffer, { transfer: [source.buffer] });
    expect(source.buffer.byteLength).toBe(0);
    expect(copy.data.buffer.byteLength).toBe(8);
    expect([...copy.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('layout chuẩn dùng cho quad đích', () => {
  it('4 tâm mốc trang chuẩn nằm trong biên trang', () => {
    const layout = SheetLayout.forSpec(SPEC, SheetLayout.standardPage);
    for (const center of layout.cornerMarkerCenters) {
      expect(center.dx).toBeGreaterThan(0);
      expect(center.dy).toBeGreaterThan(0);
      expect(center.dx).toBeLessThan(SheetLayout.standardPage.width);
      expect(center.dy).toBeLessThan(SheetLayout.standardPage.height);
    }
    const quad = new AlignmentQuad(
      layout.cornerMarkerCenters[0],
      layout.cornerMarkerCenters[1],
      layout.cornerMarkerCenters[2],
      layout.cornerMarkerCenters[3]
    );
    expect(quad.corners).toHaveLength(4);
  });
});
