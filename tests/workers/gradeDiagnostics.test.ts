// Worker → UI: chẩn đoán quad ghim phải mang theo ngưỡng thực dùng (0.8 khi
// quét lại mốc mờ) để màn kết quả không báo nhầm "detector toàn trang".

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  coverMapping,
  guideGeometry,
  overlayRectsForFrame,
  type Area
} from '../../src/camera/overlayGeometry';
import type { Contest } from '../../src/core/types';
import type {
  GradeRequest,
  GradeResponse,
  GradeSuccessResponse,
  RectDto
} from '../../src/workers/protocol';

const AREA: Area = { width: 390, height: 844 };
const FRAME: Area = { width: 1600, height: 900 };

const posted: GradeResponse[] = [];
let onmessage: ((event: MessageEvent<GradeRequest>) => void) | null = null;

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

function request(): GradeRequest {
  const w = FRAME.width;
  const h = FRAME.height;
  const gray = new Uint8Array(w * h).fill(35);
  for (let y = 0; y < 720; y++) gray.fill(205, y * w + 480, y * w + 1150);
  const guide = guideGeometry(AREA);
  const mapping = coverMapping(FRAME, AREA);
  const centers = guide.centers.map((center) => mapping.toFrame(center, FRAME));
  const side = (guide.boxWidth / mapping.scale) * 0.35;
  for (const center of centers) fill(gray, w, center.x, center.y, side, 140);
  fill(gray, w, centers[2].x, 820, 60, 20);
  fill(gray, w, centers[3].x, 820, 60, 20);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i++) {
    rgba[i * 4] = gray[i];
    rgba[i * 4 + 1] = gray[i];
    rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }
  const overlayRects: RectDto[] = overlayRectsForFrame(AREA, FRAME).rects;
  const contest: Contest = {
    id: 1,
    name: 'test',
    examDate: '2026-01-01',
    classRoomId: null,
    questionCount: 40,
    answerChoices: 4,
    maxScore: 10,
    formType: 'standard',
    orientation: 'portrait'
  };
  return {
    type: 'grade',
    id: 7,
    image: { data: rgba.buffer, width: w, height: h },
    contest,
    keys: [],
    students: [],
    overlayRects,
    frameSize: { width: w, height: h },
    diagnostics: true,
    thresholdFactor: 0.5
  };
}

beforeAll(async () => {
  const scope = {
    onmessage: null,
    postMessage(message: GradeResponse) {
      posted.push(message);
    }
  };
  vi.stubGlobal('self', scope);
  await import('../../src/workers/omr.worker');
  onmessage = scope.onmessage as typeof onmessage;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('grade worker diagnostics', () => {
  it('trả quad ghim quét lại 0.8 và ngưỡng thực dùng', () => {
    expect(onmessage).not.toBeNull();
    onmessage!({ data: request() } as MessageEvent<GradeRequest>);
    expect(posted).toHaveLength(1);
    const response = posted[0];
    expect(response.type).toBe('grade-result');
    const success = response as GradeSuccessResponse;
    expect(success.diagnostics).not.toBeNull();
    expect(success.diagnostics!.quadSource).toBe('overlayRects');
    expect(success.diagnostics!.pinnedQuad).not.toBeNull();
    expect(success.diagnostics!.pinnedThresholdFactor).toBe(0.8);
    expect(success.lightInk).toBe(false);
  });

  it('echoes the light-ink mode used for this grade', () => {
    const gradeRequest = request();
    gradeRequest.id = 8;
    gradeRequest.lightInk = true;
    onmessage!({ data: gradeRequest } as MessageEvent<GradeRequest>);
    expect(posted).toHaveLength(2);
    const success = posted[1] as GradeSuccessResponse;
    expect(success.type).toBe('grade-result');
    expect(success.lightInk).toBe(true);
  });
});
