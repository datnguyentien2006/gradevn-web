import { describe, expect, it } from 'vitest';
import {
  buildHistogram,
  buildStatsSnapshot,
  computeContestStats,
  median,
  normalizeStudentCode,
  normalizeTo10
} from '../../src/storage/stats';
import type {
  ClassRoom,
  Contest,
  GradedSheet,
  Student
} from '../../src/core/types';

const contest: Contest = {
  id: 1,
  name: 'Giữa kỳ 1',
  examDate: '2026-10-01',
  classRoomId: 10,
  questionCount: 5,
  answerChoices: 4,
  maxScore: 10,
  formType: 'standard',
  orientation: 'portrait'
};

const room: ClassRoom = { id: 10, name: '10A1' };
const students: Student[] = [
  { id: 1, classId: 10, code: '000001', fullName: 'An' },
  { id: 2, classId: 10, code: '000002', fullName: 'Bình' },
  { id: 3, classId: 10, code: '000003', fullName: 'Chi' }
];

function sheet(partial: Partial<GradedSheet> & { id: number }): GradedSheet {
  return {
    contestId: 1,
    examCode: '001',
    studentCode: '000001',
    chosen: 'ABCDA',
    correctFlags: '11111',
    score: 10,
    keyId: 1,
    studentId: 1,
    partScores: {},
    gradedAt: '2026-10-01T10:00:00.000Z',
    ...partial
  };
}

describe('thống kê', () => {
  it('chuẩn hoá điểm 10 và kẹp biên', () => {
    expect(normalizeTo10(9.25, 10)).toBeCloseTo(9.25);
    expect(normalizeTo10(5, 20)).toBe(2.5);
    expect(normalizeTo10(25, 10)).toBe(10);
    expect(normalizeTo10(-1, 10)).toBe(0);
    expect(normalizeTo10(10, 0)).toBe(0);
  });

  it('histogram 10 khoảng, điểm 10 vào khoảng cuối', () => {
    const bins = buildHistogram([0, 0.2, 1, 9.99, 10]);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toBe(2);
    expect(bins[1]).toBe(1);
    expect(bins[9]).toBe(2);
  });

  it('trung vị chẵn/lẻ', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('chuẩn hoá SBD bỏ số 0 đầu', () => {
    expect(normalizeStudentCode('000413')).toBe('413');
    expect(normalizeStudentCode(' 0000 ')).toBe('0');
    expect(normalizeStudentCode('AB12')).toBe('AB12');
  });

  it('tính điểm, histogram và câu khó', () => {
    const sheets = [
      sheet({ id: 1, studentId: 1, score: 10 }),
      sheet({
        id: 2,
        studentId: 2,
        studentCode: '000002',
        score: 5,
        correctFlags: '10?10',
        keyId: 2
      }),
      sheet({
        id: 3,
        studentId: null,
        studentCode: '000999',
        score: 0,
        correctFlags: '00000',
        keyId: null
      })
    ];
    const stats = computeContestStats(contest, sheets, '10A1', students);
    expect(stats.sheetCount).toBe(3);
    expect(stats.gradedCount).toBe(2);
    expect(stats.average10).toBeCloseTo(7.5);
    expect(stats.median10).toBeCloseTo(7.5);
    expect(stats.max10).toBe(10);
    expect(stats.min10).toBe(5);
    expect(stats.passRate).toBe(1);
    expect(stats.histogram[5]).toBe(1);
    expect(stats.histogram[9]).toBe(1);
    expect(stats.questions).toHaveLength(5);
    // Chỉ 2 phiếu đã chấm. Câu 1: 2/2, câu 2: 1/2, câu 3: 1/2 (ô '?'
    // vẫn tính vào total như Flutter), câu 4: 2/2, câu 5: 1/2.
    expect(stats.hardest[0].rate).toBe(0.5);
    expect(stats.questions[1]).toMatchObject({ correct: 1, total: 2 });
    expect(stats.questions[2]).toMatchObject({ correct: 1, total: 2 });
  });

  it('dựng snapshot + nhóm cần chú ý', () => {
    const sheets = [
      sheet({ id: 1, studentId: 1 }),
      sheet({ id: 2, studentId: null, studentCode: '000001', keyId: null }),
      sheet({ id: 3, studentId: 3, studentCode: '000003', keyId: 2 })
    ];
    const snapshot = buildStatsSnapshot(
      { classes: [room], students, contests: [contest], sheets },
      { kind: 'all' }
    );
    expect(snapshot.totalSheets).toBe(3);
    expect(snapshot.gradedSheets).toBe(2);
    expect(snapshot.expectedSlots).toBe(3);
    // student 1 matches by SBD even though one row has studentId null.
    expect(snapshot.completedSlots).toBe(2);
    expect(snapshot.attention[0].count).toBe(1);
    expect(snapshot.attention[1].count).toBe(1);
    expect(snapshot.attention[2].count).toBe(1);
    expect(snapshot.trend).toHaveLength(1);
  });

  it('phạm vi ngoài lớp không có học sinh', () => {
    const outside: Contest = {
      ...contest,
      id: 2,
      name: 'Ngoài lớp',
      classRoomId: null
    };
    const snapshot = buildStatsSnapshot(
      {
        classes: [room],
        students,
        contests: [outside],
        sheets: [sheet({ id: 4, contestId: 2, studentId: null })]
      },
      { kind: 'outside' }
    );
    expect(snapshot.classCount).toBe(0);
    expect(snapshot.studentCount).toBe(0);
    expect(snapshot.totalSheets).toBe(1);
    expect(snapshot.completion).toBeNull();
  });
});
