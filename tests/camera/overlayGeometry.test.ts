// Hình học overlay camera — đối chiếu tỉ lệ calibration với Dart.
// Nguồn Dart: lib/data/cv/preview_overlay.dart

import { describe, expect, it } from 'vitest';

import {
  coverMapping,
  guideGeometry,
  overlayRectsForFrame,
  quadMaxDistance
} from '../../src/camera/overlayGeometry';

const PORTRAIT_AREA = { width: 390, height: 844 };
const LANDSCAPE_AREA = { width: 844, height: 390 };

describe('guideGeometry', () => {
  it('đặt 4 ô theo tỉ lệ calibration 720×1560 khi dọc', () => {
    const guide = guideGeometry(PORTRAIT_AREA);
    const [tl, tr, br, bl] = guide.centers;
    expect(tl.x / PORTRAIT_AREA.width).toBeCloseTo(0.13125, 5);
    expect(tr.x / PORTRAIT_AREA.width).toBeCloseTo(0.86875, 5);
    expect(tl.y / PORTRAIT_AREA.height).toBeCloseTo(165.5 / 1560, 5);
    expect(br.y / PORTRAIT_AREA.height).toBeCloseTo(1076.5 / 1560, 5);
    expect(bl.x).toBeCloseTo(tl.x, 6);
    expect(tr.y).toBeCloseTo(tl.y, 6);
    expect(guide.boxWidth / PORTRAIT_AREA.width).toBeCloseTo(157 / 720, 5);
    expect(guide.boxHeight / PORTRAIT_AREA.height).toBeCloseTo(203 / 1560, 5);
  });

  it('dùng bản transpose khi ngang', () => {
    const guide = guideGeometry(LANDSCAPE_AREA);
    const [tl, tr, , bl] = guide.centers;
    expect(tl.x / LANDSCAPE_AREA.width).toBeCloseTo(181.5 / 1560, 5);
    expect(tr.x / LANDSCAPE_AREA.width).toBeCloseTo(1060.5 / 1560, 5);
    expect(tl.y / LANDSCAPE_AREA.height).toBeCloseTo(78.5 / 720, 5);
    expect(bl.y / LANDSCAPE_AREA.height).toBeCloseTo(641.5 / 720, 5);
    expect(guide.boxWidth / LANDSCAPE_AREA.width).toBeCloseTo(203 / 1560, 5);
    expect(guide.boxHeight / LANDSCAPE_AREA.height).toBeCloseTo(157 / 720, 5);
  });

  it('ô giữ đúng tỉ lệ màn hình khi đổi kích thước', () => {
    for (const area of [PORTRAIT_AREA, LANDSCAPE_AREA]) {
      const guide = guideGeometry(area);
      const ratio = guide.boxWidth / guide.boxHeight;
      const expected =
        area.width >= area.height
          ? (203 / 1560) * area.width / ((157 / 720) * area.height)
          : (157 / 720) * area.width / ((203 / 1560) * area.height);
      expect(ratio).toBeCloseTo(expected, 6);
    }
  });
});

describe('coverMapping', () => {
  const frame = { width: 1920, height: 1080 };

  it('ánh xạ khứ hồi giữ nguyên điểm trong khung nhìn', () => {
    const mapping = coverMapping(frame, PORTRAIT_AREA);
    expect(mapping.scale).toBeCloseTo(844 / 1080, 8);
    const point = { x: 960, y: 540 };
    const screen = mapping.toScreen(point);
    const back = mapping.toFrame(screen, frame);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('kẹp biên khi điểm ngoài màn hình', () => {
    const mapping = coverMapping(frame, PORTRAIT_AREA);
    const back = mapping.toFrame({ x: -1000, y: 5000 }, frame);
    expect(back.x).toBe(0);
    expect(back.y).toBe(1080);
  });

  it('cắt đối xứng theo trục dư', () => {
    const portraitFrame = { width: 1080, height: 1920 };
    const mapping = coverMapping(portraitFrame, PORTRAIT_AREA);
    expect(mapping.scale).toBeCloseTo(844 / 1920, 8);
    expect(mapping.offsetY).toBeCloseTo(0, 8);
    expect(mapping.offsetX).toBeLessThan(0);
    expect(mapping.offsetX * 2 + portraitFrame.width * mapping.scale).toBeCloseTo(
      PORTRAIT_AREA.width,
      6
    );
  });
});

describe('overlayRectsForFrame', () => {
  it('trả 4 rect chuẩn hoá khớp vị trí ô trên màn hình', () => {
    const frame = { width: 1920, height: 1080 };
    const overlay = overlayRectsForFrame(PORTRAIT_AREA, frame);
    expect(overlay.rects).toHaveLength(4);
    expect(overlay.screenBoxes).toHaveLength(4);
    const mapping = coverMapping(frame, PORTRAIT_AREA);
    overlay.rects.forEach((rect, index) => {
      const box = overlay.screenBoxes[index];
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(1);
      expect(rect.bottom).toBeLessThanOrEqual(1);
      expect(rect.right).toBeGreaterThan(rect.left);
      expect(rect.bottom).toBeGreaterThan(rect.top);
      const frameWidth = (rect.right - rect.left) * frame.width;
      const frameHeight = (rect.bottom - rect.top) * frame.height;
      expect(frameWidth * mapping.scale).toBeCloseTo(box.width, 4);
      expect(frameHeight * mapping.scale).toBeCloseTo(box.height, 4);
    });
  });

  it('giữ thứ tự tl, tr, br, bl', () => {
    const overlay = overlayRectsForFrame(PORTRAIT_AREA, {
      width: 1080,
      height: 1920
    });
    const [tl, tr, br, bl] = overlay.rects;
    expect(tl.left).toBeLessThan(tr.left);
    expect(tl.top).toBeLessThan(bl.top);
    expect(br.right).toBeGreaterThan(bl.right);
    expect(br.bottom).toBeGreaterThan(tr.bottom);
  });
});

describe('quadMaxDistance', () => {
  const base = {
    tl: { x: 0, y: 0 },
    tr: { x: 10, y: 0 },
    br: { x: 10, y: 10 },
    bl: { x: 0, y: 10 }
  };

  it('trả Infinity khi thiếu quad', () => {
    expect(quadMaxDistance(null, base)).toBe(Infinity);
    expect(quadMaxDistance(base, null)).toBe(Infinity);
  });

  it('trả 0 khi trùng nhau', () => {
    expect(quadMaxDistance(base, base)).toBe(0);
  });

  it('lấy khoảng cách lớn nhất trong 4 cặp góc', () => {
    const moved = { ...base, br: { x: 13, y: 14 } };
    expect(quadMaxDistance(base, moved)).toBeCloseTo(5, 8);
  });
});
