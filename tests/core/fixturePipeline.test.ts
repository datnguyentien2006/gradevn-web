// So khớp pipeline TS với kết quả Dart trên cùng fixture PNG.
// Nguồn Dart: test/omr_pipeline_test.dart, test/fixtures/fixture_builder.dart.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { measureRgba, rgbaChannel0Gray, type RgbaImage } from '../../src/core/density';
import { Grader } from '../../src/core/grader';
import { OmrDecoder } from '../../src/core/omrDecoder';
import { SheetLayout } from '../../src/core/sheetLayout';
import type { AnswerKey, Contest, SheetSpec } from '../../src/core/types';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures');

interface ExpectedFixture {
  name: string;
  spec: SheetSpec;
  studentCodeRaw: string;
  examCodeRaw: string;
  answers: (string | null)[];
  answerKey: string;
  expected: {
    score: number;
    partScores: Record<string, number>;
    correctCount: number;
  };
}

async function loadPng(name: string): Promise<RgbaImage> {
  const { data, info } = await sharp(join(fixtureRoot, 'generated', `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height
  };
}

function loadExpected(name: string): ExpectedFixture {
  return JSON.parse(readFileSync(join(fixtureRoot, 'expected', `${name}.json`), 'utf8')) as ExpectedFixture;
}

function contestFor(fixture: ExpectedFixture): Contest {
  return {
    id: 1,
    name: fixture.name,
    examDate: '2026-01-01',
    classRoomId: 1,
    questionCount: fixture.spec.questionCount,
    answerChoices: fixture.spec.answerChoices,
    maxScore: fixture.spec.maxScore,
    formType: fixture.spec.formType,
    orientation: fixture.spec.orientation
  };
}

for (const name of ['standard40', 'noisy40'] as const) {
  describe(`fixture ${name}`, () => {
    it('matches Dart answers, SBD, exam code and score', async () => {
      const fixture = loadExpected(name);
      const image = await loadPng(name);
      const layout = SheetLayout.forSpec(fixture.spec, SheetLayout.standardPage);

      const gray = rgbaChannel0Gray(image.data, image.width, image.height);
      const densities = measureRgba(image.data, image.width, image.height, layout);
      const decoder = new OmrDecoder();

      const answers = decoder.decodeAnswers(
        densities.answerBlocks,
        fixture.spec,
        layout.totalQuestions
      );
      const studentCodeRaw = decoder.decodeDigits(densities.studentCodeGrid);
      const examCodeRaw = decoder.decodeDigits(densities.examCodeGrid);

      expect(studentCodeRaw).toBe(fixture.studentCodeRaw);
      expect(examCodeRaw).toBe(fixture.examCodeRaw);
      expect(answers).toEqual(fixture.answers);

      const key: AnswerKey = {
        id: 1,
        contestId: 1,
        examCode: fixture.examCodeRaw,
        answerSequence: fixture.answerKey
      };
      const chosen = answers;
      const directKey = Grader.selectKey([key], examCodeRaw);
      expect(directKey).toBe(key);
      expect(OmrDecoder.normalizeCode(examCodeRaw)).toBe(
        OmrDecoder.normalizeCode(fixture.examCodeRaw)
      );

      const result = new Grader().gradeForContest(
        contestFor(fixture),
        directKey?.answerSequence ?? '',
        chosen
      );
      expect(result.score).toBe(fixture.expected.score);
      expect(result.correctCount).toBe(fixture.expected.correctCount);
      expect(result.partScores).toEqual(fixture.expected.partScores);

      // Kênh 0 (đường chụp thật) phải cho cùng kết quả với luma trên fixture
      // xám R=G=B — bảo vệ giả định của scanService.
      const densitiesCh0 = measureRgba(
        new Uint8Array(
          (() => {
            const out = new Uint8Array(image.data.length);
            for (let i = 0; i < image.width * image.height; i++) {
              const g = gray.data[i];
              out[i * 4] = g;
              out[i * 4 + 1] = g;
              out[i * 4 + 2] = g;
              out[i * 4 + 3] = 255;
            }
            return out;
          })()
        ),
        image.width,
        image.height,
        layout
      );
      const answersCh0 = decoder.decodeAnswers(
        densitiesCh0.answerBlocks,
        fixture.spec,
        layout.totalQuestions
      );
      expect(answersCh0).toEqual(fixture.answers);
    });

    it('separates marked and empty bubbles like the Dart fixture test', async () => {
      const fixture = loadExpected(name);
      const image = await loadPng(name);
      const layout = SheetLayout.forSpec(fixture.spec, SheetLayout.standardPage);
      const densities = measureRgba(image.data, image.width, image.height, layout);
      const first = densities.answerBlocks[0];

      let marked = 0;
      let empty = 0;
      for (let row = 0; row < first.rows; row++) {
        const sorted = [...first.values[row]].sort((a, b) => b - a);
        marked += sorted[0];
        for (let c = 1; c < sorted.length; c++) empty += sorted[c];
      }
      expect(marked / first.rows).toBeGreaterThan(0.45);
      expect(empty / (first.rows * (first.columns - 1))).toBeLessThan(0.2);
    });
  });
}
