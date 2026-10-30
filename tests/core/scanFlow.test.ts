// Đối chiếu "quét → chấm → gắn học sinh" với Dart scan_flow.dart.
// Nguồn Dart: lib/data/cv/scan_flow.dart (gradeScan / _scanAndGrade).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { DensityBlock } from '../../src/core/omrDecoder';
import { AlignmentQuad, Offset } from '../../src/core/geometry';
import { GradedScan, gradeScan, scanAndGrade } from '../../src/core/scanFlow';
import { SheetScan, type PhotoScan } from '../../src/core/scanService';
import type { AnswerKey, Contest, SheetSpec, Student } from '../../src/core/types';

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

function loadExpected(name: string): ExpectedFixture {
  return JSON.parse(
    readFileSync(join(fixtureRoot, 'expected', `${name}.json`), 'utf8')
  ) as ExpectedFixture;
}

function makeContest(overrides: Partial<Contest> = {}): Contest {
  return {
    id: 1,
    name: 'test',
    examDate: '2026-01-01',
    classRoomId: 1,
    questionCount: 4,
    answerChoices: 4,
    maxScore: 10,
    formType: 'standard',
    orientation: 'portrait',
    ...overrides
  };
}

function makeKey(id: number, examCode: string, answerSequence: string): AnswerKey {
  return { id, contestId: 1, examCode, answerSequence };
}

function makeStudent(id: number, code: string): Student {
  return { id, classId: 1, code, fullName: `HS ${id}` };
}

/** PhotoScan giả — đủ trường để gradeScan chạy thuần, không cần ảnh. */
function makePhoto(
  answers: (string | null)[],
  studentCodeRaw: string,
  examCodeRaw: string,
  answerBlocks: DensityBlock[] = []
): PhotoScan {
  const emptyGrid = new DensityBlock([[0]]);
  return {
    scan: new SheetScan(
      answers,
      studentCodeRaw,
      examCodeRaw,
      answerBlocks,
      emptyGrid,
      emptyGrid,
      0
    ),
    quad: new AlignmentQuad(
      new Offset(0, 0),
      new Offset(1, 0),
      new Offset(1, 1),
      new Offset(0, 1)
    ),
    warpedGray: new Uint8ClampedArray(0),
    warpedWidth: 0,
    warpedHeight: 0
  };
}

function gradeWith(overrides: {
  contest?: Partial<Contest>;
  keys?: AnswerKey[];
  students?: Student[];
  chosen?: (string | null)[];
  studentCodeRaw?: string;
  examCodeRaw?: string;
  answerBlocks?: DensityBlock[];
}): GradedScan {
  return gradeScan({
    contest: makeContest(overrides.contest),
    keys: overrides.keys ?? [],
    candidateStudents: overrides.students ?? [],
    chosen: overrides.chosen ?? ['A', 'B', 'C', 'D'],
    studentCodeRaw: overrides.studentCodeRaw ?? '',
    examCodeRaw: overrides.examCodeRaw ?? '',
    photo: makePhoto(
      overrides.chosen ?? ['A', 'B', 'C', 'D'],
      overrides.studentCodeRaw ?? '',
      overrides.examCodeRaw ?? '',
      overrides.answerBlocks ?? []
    )
  });
}

describe('gradeScan', () => {
  it('marks an in-class blank exam as ungraded but still matches the student', () => {
    const student = makeStudent(1, '000123');
    const scan = gradeWith({
      keys: [],
      students: [student],
      studentCodeRaw: '000123',
      examCodeRaw: '???'
    });

    expect(scan.graded).toBe(false);
    expect(scan.ungradedReason).toBe('examCode');
    expect(scan.usedExamCode).toBe('');
    expect(scan.usedKey).toBeNull();
    expect(scan.usedBestGuessKey).toBe(false);
    expect(scan.student).toBe(student);
    expect(scan.result.correctFlags).toEqual([null, null, null, null]);
    expect(scan.result.score).toBe(0);
    expect(scan.result.partScores).toEqual({});
    expect(scan.multiAnswerCount).toBe(0);
  });

  it('uses the default empty-exam key when the exam code is blank', () => {
    const defaultKey = makeKey(1, '', 'ABCD');
    const scan = gradeWith({
      keys: [defaultKey],
      examCodeRaw: '???',
      studentCodeRaw: '000123'
    });

    expect(scan.graded).toBe(true);
    expect(scan.ungradedReason).toBeNull();
    expect(scan.usedKey).toBe(defaultKey);
    expect(scan.usedExamCode).toBe('');
    expect(scan.usedBestGuessKey).toBe(false);
    expect(scan.result.correctFlags).toEqual([true, true, true, true]);
    expect(scan.result.score).toBe(10);
  });

  it('picks the key by normalized exam code', () => {
    const key = makeKey(1, '001', 'ABDC');
    const scan = gradeWith({
      keys: [key],
      examCodeRaw: '1',
      chosen: ['A', 'B', 'C', 'D']
    });

    expect(scan.graded).toBe(true);
    expect(scan.usedKey).toBe(key);
    expect(scan.usedExamCode).toBe('001');
    expect(scan.usedBestGuessKey).toBe(false);
    expect(scan.result.correctFlags).toEqual([true, true, false, false]);
    expect(scan.result.score).toBe(5);
  });

  it('falls back to the best-scoring key when the exam code is unreadable', () => {
    const wrongKey = makeKey(1, '1', 'AAAA');
    const rightKey = makeKey(2, '2', 'BBBB');
    const scan = gradeWith({
      keys: [wrongKey, rightKey],
      examCodeRaw: '0?1',
      chosen: ['B', 'B', 'B', 'B']
    });

    expect(scan.usedKey).toBe(rightKey);
    expect(scan.usedExamCode).toBe('2');
    expect(scan.usedBestGuessKey).toBe(true);
    expect(scan.result.score).toBe(10);
  });

  it('does not warn best-guess key for an outside-class contest', () => {
    const key = makeKey(1, '1', 'BBBB');
    const student = makeStudent(1, '000123');
    const scan = gradeWith({
      contest: { classRoomId: null },
      keys: [key],
      students: [student],
      examCodeRaw: '???',
      studentCodeRaw: '000123',
      chosen: ['B', 'B', 'B', 'B']
    });

    expect(scan.graded).toBe(true);
    expect(scan.usedKey).toBe(key);
    expect(scan.usedExamCode).toBe('1');
    expect(scan.usedBestGuessKey).toBe(false);
    expect(scan.student).toBeNull();
    expect(scan.result.score).toBe(10);
  });

  it('matches the student only for in-class contests with a readable code', () => {
    const student = makeStudent(1, '123');
    const key = makeKey(1, '1', 'ABCD');

    const matched = gradeWith({
      keys: [key],
      students: [student],
      examCodeRaw: '1',
      studentCodeRaw: '000123'
    });
    expect(matched.student).toBe(student);

    const outsideClass = gradeWith({
      contest: { classRoomId: null },
      keys: [key],
      students: [student],
      examCodeRaw: '1',
      studentCodeRaw: '000123'
    });
    expect(outsideClass.student).toBeNull();

    const blankSbd = gradeWith({
      keys: [key],
      students: [student],
      examCodeRaw: '1',
      studentCodeRaw: ''
    });
    expect(blankSbd.graded).toBe(true);
    expect(blankSbd.student).toBeNull();
  });

  it('counts rows with two dark bubbles as multi-answer', () => {
    const scan = gradeWith({
      keys: [makeKey(1, '1', 'ABCD')],
      examCodeRaw: '1',
      answerBlocks: [
        new DensityBlock([
          [0.9, 0.8, 0.1, 0.1],
          [0.1, 0.1, 0.1, 0.1]
        ])
      ]
    });
    expect(scan.multiAnswerCount).toBe(1);
  });

  it('grades every question null when there are no keys', () => {
    const scan = gradeWith({
      keys: [],
      examCodeRaw: '1',
      chosen: ['A', 'B', 'C', 'D']
    });

    expect(scan.graded).toBe(true);
    expect(scan.usedKey).toBeNull();
    expect(scan.usedExamCode).toBe('1');
    expect(scan.usedBestGuessKey).toBe(false);
    expect(scan.result.correctFlags).toEqual([null, null, null, null]);
    expect(scan.result.score).toBe(0);
  });
});

describe('scanAndGrade on fixtures', () => {
  async function loadPng(name: string) {
    const { data, info } = await sharp(
      join(fixtureRoot, 'generated', `${name}.png`)
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height
    };
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
    it(`reproduces Dart score/answers for ${name}`, async () => {
      const fixture = loadExpected(name);
      const image = await loadPng(name);
      const key = makeKey(1, fixture.examCodeRaw, fixture.answerKey);
      const student = makeStudent(1, fixture.studentCodeRaw);

      const scan = scanAndGrade({
        image,
        contest: contestFor(fixture),
        keys: [key],
        candidateStudents: [student]
      });

      expect(scan).not.toBeNull();
      const graded = scan!;
      expect(graded.graded).toBe(true);
      expect(graded.usedKey).toBe(key);
      expect(graded.usedExamCode).toBe(fixture.examCodeRaw);
      expect(graded.usedBestGuessKey).toBe(false);
      expect(graded.student).toBe(student);
      expect(graded.photo.scan.answers).toEqual(fixture.answers);
      expect(graded.photo.scan.studentCodeRaw).toBe(fixture.studentCodeRaw);
      expect(graded.photo.scan.examCodeRaw).toBe(fixture.examCodeRaw);
      expect(graded.photo.verification?.passed).toBe(true);
      expect(graded.photo.warpedGray.length).toBe(
        graded.photo.warpedWidth * graded.photo.warpedHeight
      );
      expect(graded.result.score).toBe(fixture.expected.score);
      expect(graded.result.correctCount).toBe(fixture.expected.correctCount);
      expect(graded.result.partScores).toEqual(fixture.expected.partScores);
      expect(graded.multiAnswerCount).toBe(0);
    });
  }

  it('returns null when no sheet frame can be built', () => {
    const width = 800;
    const height = 1100;
    const data = new Uint8Array(width * height * 4).fill(255);
    const scan = scanAndGrade({
      image: { data, width, height },
      contest: makeContest({ questionCount: 40 }),
      keys: [],
      candidateStudents: []
    });
    expect(scan).toBeNull();
  });
});
