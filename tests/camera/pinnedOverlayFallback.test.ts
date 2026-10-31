// Hồi quy: mốc in mờ trên giấy (p75×0.5 bỏ sót) từng làm quad ghim rớt,
// rơi xuống detector toàn ảnh — hai góc dưới bị thay bằng vật tối ngoài tờ
// giấy (lệch ~200 px, kiểm chứng 319 px trên máy thật). Quad ghim phải được
// quét lại ở p75×0.8 trước khi bỏ cuộc, giống đường live.

import { describe, expect, it } from 'vitest';

import {
  coverMapping,
  guideGeometry,
  overlayRectsForFrame,
  type Area
} from '../../src/camera/overlayGeometry';
import { Rect, Size } from '../../src/core/geometry';
import { OmrScanService } from '../../src/core/scanService';
import type { SheetSpec } from '../../src/core/types';

const SPEC: SheetSpec = {
  formType: 'standard',
  orientation: 'portrait',
  questionCount: 40,
  answerChoices: 4,
  maxScore: 10
};
const AREA: Area = { width: 390, height: 844 };
const FRAME: Area = { width: 1600, height: 900 };

function fill(
  gray: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  side: number,
  value: number
): void {
  const x0 = Math.max(0, Math.round(cx - side / 2));
  const y0 = Math.max(0, Math.round(cy - side / 2));
  const x1 = Math.min(width, Math.round(cx + side / 2));
  const y1 = Math.min(gray.length / width, Math.round(cy + side / 2));
  for (let y = y0; y < y1; y++) gray.fill(value, y * width + x0, y * width + x1);
}

/**
 * Tờ giấy 205 trên nền 35; 4 mốc in giá trị [markerValue]; hai khối tối
 * gần vuông NGOÀI tờ giấy ở đáy khung — mồi nhử của detector toàn ảnh.
 */
function scene(markerValue: number) {
  const w = FRAME.width;
  const h = FRAME.height;
  const gray = new Uint8Array(w * h).fill(35);
  for (let y = 0; y < 720; y++) gray.fill(205, y * w + 480, y * w + 1150);
  const guide = guideGeometry(AREA);
  const mapping = coverMapping(FRAME, AREA);
  const centers = guide.centers.map((center) => mapping.toFrame(center, FRAME));
  const side = (guide.boxWidth / mapping.scale) * 0.35;
  for (const center of centers) fill(gray, w, center.x, center.y, side, markerValue);
  fill(gray, w, centers[2].x, 820, 60, 20);
  fill(gray, w, centers[3].x, 820, 60, 20);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i++) {
    data[i * 4] = gray[i];
    data[i * 4 + 1] = gray[i];
    data[i * 4 + 2] = gray[i];
    data[i * 4 + 3] = 255;
  }
  return { data, centers };
}

function rects(): Rect[] {
  return overlayRectsForFrame(AREA, FRAME).rects.map(
    (rect) => new Rect(rect.left, rect.top, rect.right, rect.bottom)
  );
}

function expectedError(
  corners: { dx: number; dy: number }[],
  centers: { x: number; y: number }[]
): number {
  return Math.max(
    ...corners.map((corner, index) =>
      Math.hypot(corner.dx - centers[index].x, corner.dy - centers[index].y)
    )
  );
}

describe('ô ghim mốc mờ: quét lại p75×0.8 trước khi rơi xuống detector', () => {
  it('tắt dự phòng tái hiện lỗi: detector lấy vật tối ngoài giấy làm 2 góc dưới', () => {
    const { data, centers } = scene(140);
    const photo = new OmrScanService().scanPhoto(
      { data, width: FRAME.width, height: FRAME.height },
      {
        spec: SPEC,
        overlayRects: rects(),
        frameSize: new Size(FRAME.width, FRAME.height),
        diagnoseAlignment: true,
        requireVerifiedWarp: false,
        thresholdFactor: 0.5,
        allowPinnedFallback: false
      }
    );
    expect(photo).not.toBeNull();
    const diagnostics = photo!.diagnostics!;
    expect(diagnostics.quadSource).toBe('detector');
    expect(diagnostics.pinnedQuad).toBeNull();
    expect(diagnostics.pinnedThresholdFactor).toBeNull();
    expect(photo!.quad.br.dy).toBeGreaterThan(centers[2].y + 100);
    expect(photo!.quad.bl.dy).toBeGreaterThan(centers[3].y + 100);
    expect(diagnostics.alignmentWarning).toBe(true);
  });

  it('mặc định quét lại 0.8: quad ghim khớp cả 4 mốc, không rơi xuống detector', () => {
    const { data, centers } = scene(140);
    const photo = new OmrScanService().scanPhoto(
      { data, width: FRAME.width, height: FRAME.height },
      {
        spec: SPEC,
        overlayRects: rects(),
        frameSize: new Size(FRAME.width, FRAME.height),
        diagnoseAlignment: true,
        requireVerifiedWarp: false
      }
    );
    expect(photo).not.toBeNull();
    const diagnostics = photo!.diagnostics!;
    expect(diagnostics.quadSource).toBe('overlayRects');
    expect(diagnostics.pinnedQuad).not.toBeNull();
    expect(diagnostics.pinnedThresholdFactor).toBe(0.8);
    expect(expectedError(photo!.quad.corners, centers)).toBeLessThan(5);
  });

  it('mốc đậm giữ nguyên ngưỡng chuẩn 0.5 (không quét lại)', () => {
    const { data, centers } = scene(25);
    const photo = new OmrScanService().scanPhoto(
      { data, width: FRAME.width, height: FRAME.height },
      {
        spec: SPEC,
        overlayRects: rects(),
        frameSize: new Size(FRAME.width, FRAME.height),
        diagnoseAlignment: true,
        requireVerifiedWarp: false
      }
    );
    expect(photo).not.toBeNull();
    const diagnostics = photo!.diagnostics!;
    expect(diagnostics.quadSource).toBe('overlayRects');
    expect(diagnostics.pinnedThresholdFactor).toBe(0.5);
    expect(expectedError(photo!.quad.corners, centers)).toBeLessThan(5);
  });

  it('resolveOverlayRects: 0.5 trượt → chỉ trả quad khi bật dự phòng', () => {
    const { data, centers } = scene(140);
    const service = new OmrScanService();
    const size = new Size(FRAME.width, FRAME.height);

    expect(
      service.resolveOverlayRects(
        data,
        4,
        FRAME.width,
        FRAME.height,
        rects(),
        size,
        null,
        0.5,
        false
      )
    ).toBeNull();

    const fallback = service.resolveOverlayRects(
      data,
      4,
      FRAME.width,
      FRAME.height,
      rects(),
      size,
      null,
      0.5,
      true
    );
    expect(fallback?.thresholdFactor).toBe(0.8);
    expect(fallback).not.toBeNull();
    expect(expectedError(fallback!.quad.corners, centers)).toBeLessThan(5);
  });
});
