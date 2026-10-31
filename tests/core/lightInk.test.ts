// Chế độ "mực nhạt": chỉ hạ ngưỡng ô đáp án, lưới SBD/mã đề vẫn như APK.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OMR_TUNING,
  LIGHT_INK_ANSWER_DELTA,
  LIGHT_INK_TUNING
} from '../../src/core/density';
import { AlignmentQuad, Rect } from '../../src/core/geometry';
import { scanAndGrade } from '../../src/core/scanFlow';
import { SheetLayout } from '../../src/core/sheetLayout';
import { contestSheetSpec, type Contest } from '../../src/core/types';

const CONTEST: Contest = {
  id: 1,
  name: 'light-ink',
  examDate: '2026-01-01',
  classRoomId: null,
  questionCount: 40,
  answerChoices: 4,
  maxScore: 10,
  formType: 'standard',
  orientation: 'portrait'
};

const BACKGROUND = 235;
/** Mực nhạt: tương phản 40 mức xám — dưới ngưỡng 45 của APK. */
const LIGHT_MARK = 195;

function fillCenter(
  gray: Uint8Array,
  width: number,
  rect: Rect,
  value: number
): void {
  const side = Math.min(rect.width, rect.height) * 0.5;
  const center = rect.center;
  const x0 = Math.round(center.dx - side / 2);
  const y0 = Math.round(center.dy - side / 2);
  const x1 = Math.round(center.dx + side / 2);
  const y1 = Math.round(center.dy + side / 2);
  for (let y = y0; y < y1; y++) gray.fill(value, y * width + x0, y * width + x1);
}

function buildPage(): {
  image: { data: Uint8ClampedArray; width: number; height: number };
  layout: SheetLayout;
  quad: AlignmentQuad;
} {
  const page = SheetLayout.standardPage;
  const layout = SheetLayout.forSpec(contestSheetSpec(CONTEST), page);
  const width = page.width;
  const height = page.height;
  const gray = new Uint8Array(width * height).fill(BACKGROUND);

  const filled = ['A', 'B', 'C', 'D'];
  filled.forEach((_, index) => {
    fillCenter(gray, width, layout.answerCellRect(index, index), LIGHT_MARK);
  });
  // Một ô mã đề mực nhạt: lưới mã đề phải tiếp tục dùng ngưỡng 45.
  fillCenter(gray, width, layout.examCodeGrid.cellRect(0, 0), LIGHT_MARK);

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    rgba[i * 4] = gray[i];
    rgba[i * 4 + 1] = gray[i];
    rgba[i * 4 + 2] = gray[i];
    rgba[i * 4 + 3] = 255;
  }

  const corners = layout.cornerMarkerCenters;
  return {
    image: { data: rgba, width, height },
    layout,
    quad: new AlignmentQuad(corners[0], corners[1], corners[2], corners[3])
  };
}

describe('light ink mode', () => {
  it('default tuning is unchanged (45, no answer override)', () => {
    expect(DEFAULT_OMR_TUNING.inkDelta).toBe(45);
    expect(DEFAULT_OMR_TUNING.answerInkDelta).toBeNull();
    expect(LIGHT_INK_TUNING.inkDelta).toBe(45);
    expect(LIGHT_INK_TUNING.answerInkDelta).toBe(LIGHT_INK_ANSWER_DELTA);
  });

  it('APK threshold reads light marks as blank; light ink reads them', () => {
    const { image, quad } = buildPage();

    const strict = scanAndGrade({
      image,
      contest: CONTEST,
      keys: [],
      candidateStudents: [],
      knownQuad: quad
    });
    expect(strict).not.toBeNull();
    expect(strict!.photo.scan.answers).toEqual(new Array(40).fill(null));

    const tolerant = scanAndGrade({
      image,
      contest: CONTEST,
      keys: [],
      candidateStudents: [],
      knownQuad: quad,
      tuning: LIGHT_INK_TUNING
    });
    expect(tolerant).not.toBeNull();
    expect(tolerant!.photo.scan.answers.slice(0, 5)).toEqual([
      'A',
      'B',
      'C',
      'D',
      null
    ]);
    expect(tolerant!.photo.scan.answers.slice(5).every((answer) => answer == null)).toBe(
      true
    );
    // Lưới mã đề vẫn ở ngưỡng APK: ô mực nhạt không sinh chữ số.
    expect(tolerant!.photo.scan.examCodeRaw).not.toMatch(/[0-9]/);
  });
});
