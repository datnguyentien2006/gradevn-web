// Thống kê — port từ lib/domain/services/stats.dart (định nghĩa ở LOGIC_SPEC §4.5).
// "Đã chấm" iff keyId != null. Điểm chuẩn hoá 10: score / maxScore × 10, kẹp 0..10.
// Histogram 10 khoảng [0,1) … [9,10]. Ngưỡng đạt cố định 5/10 như bản Flutter.

import type {
  AnswerKey,
  ClassRoom,
  Contest,
  GradedSheet,
  Student
} from '../core/types';

export const PASS_THRESHOLD = 5;

export interface QuestionStat {
  question: number;
  correct: number;
  total: number;
  rate: number;
}

export interface ContestStats {
  contest: Contest;
  className: string | null;
  sheetCount: number;
  gradedCount: number;
  average10: number | null;
  median10: number | null;
  max10: number | null;
  min10: number | null;
  passRate: number | null;
  histogram: number[];
  questions: QuestionStat[];
  hardest: QuestionStat[];
}

export type AttentionKind =
  | 'incorrectStudentId'
  | 'ungraded'
  | 'missingSubmission';

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  samples: string[];
}

export interface TrendPoint {
  contestId: number;
  name: string;
  examDate: string;
  average10: number;
}

export interface StatsSnapshot {
  classCount: number;
  studentCount: number;
  contestCount: number;
  totalSheets: number;
  gradedSheets: number;
  average10: number | null;
  completion: number | null;
  expectedSlots: number;
  completedSlots: number;
  exams: ContestStats[];
  attention: AttentionItem[];
  trend: TrendPoint[];
}

export interface StatsInput {
  classes: ClassRoom[];
  students: Student[];
  contests: Contest[];
  sheets: GradedSheet[];
  keys?: AnswerKey[];
}

export type StatsScope =
  | { kind: 'all' }
  | { kind: 'class'; classId: number }
  | { kind: 'outside' };

export function normalizeTo10(score: number, maxScore: number): number {
  if (!(maxScore > 0)) return 0;
  const normalized = (score / maxScore) * 10;
  return Math.max(0, Math.min(10, normalized));
}

export function buildHistogram(scores10: number[]): number[] {
  const bins = new Array<number>(10).fill(0);
  for (const score of scores10) {
    const index = Math.max(0, Math.min(9, Math.floor(score)));
    bins[index] += 1;
  }
  return bins;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreOf(sheet: GradedSheet, contest: Contest): number {
  return normalizeTo10(sheet.score, contest.maxScore);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeStudentCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^0+/, '');
  return stripped || '0';
}

export function sheetMatchesStudent(
  sheet: GradedSheet,
  student: Student
): boolean {
  if (sheet.studentId === student.id) return true;
  return (
    normalizeStudentCode(sheet.studentCode) ===
    normalizeStudentCode(student.code)
  );
}

function sampleLabel(contest: Contest, sheet: GradedSheet): string {
  return `${contest.name} · SBD ${sheet.studentCode || '?'}`;
}

export function computeContestStats(
  contest: Contest,
  sheets: GradedSheet[],
  className: string | null,
  roster: Student[] = []
): ContestStats {
  const inContest = sheets.filter((sheet) => sheet.contestId === contest.id);
  const graded = inContest.filter((sheet) => sheet.keyId != null);
  const scores = graded.map((sheet) => scoreOf(sheet, contest));
  const questions: QuestionStat[] = [];
  for (let index = 0; index < contest.questionCount; index++) {
    let correct = 0;
    let total = 0;
    for (const sheet of graded) {
      if (index >= sheet.correctFlags.length) continue;
      total += 1;
      if (sheet.correctFlags[index] === '1') correct += 1;
    }
    if (total > 0) {
      questions.push({
        question: index + 1,
        correct,
        total,
        rate: correct / total
      });
    }
  }
  const hardest = [...questions]
    .sort((a, b) => a.rate - b.rate || a.question - b.question)
    .slice(0, 8);
  const passCount = scores.filter((score) => score >= PASS_THRESHOLD).length;

  // roster is kept for API symmetry with the Dart service; attention is built
  // separately so it can aggregate across contests.
  void roster;

  return {
    contest,
    className,
    sheetCount: inContest.length,
    gradedCount: graded.length,
    average10: average(scores),
    median10: median(scores),
    max10: scores.length > 0 ? Math.max(...scores) : null,
    min10: scores.length > 0 ? Math.min(...scores) : null,
    passRate: scores.length > 0 ? passCount / scores.length : null,
    histogram: buildHistogram(scores),
    questions,
    hardest
  };
}

function attentionItems(
  contests: Contest[],
  sheets: GradedSheet[],
  classes: ClassRoom[],
  students: Student[],
  currentClassId?: number
): AttentionItem[] {
  const classNames = new Map(classes.map((room) => [room.id, room.name]));
  const samples = {
    incorrectStudentId: [] as string[],
    ungraded: [] as string[],
    missingSubmission: [] as string[]
  };
  let incorrectStudentId = 0;
  let ungraded = 0;
  let missingSubmission = 0;

  for (const contest of contests) {
    const contestSheets = sheets.filter((sheet) => sheet.contestId === contest.id);
    for (const sheet of contestSheets) {
      if (sheet.keyId == null) {
        ungraded += 1;
        if (samples.ungraded.length < 3) {
          samples.ungraded.push(sampleLabel(contest, sheet));
        }
      }
      if (contest.classRoomId != null && sheet.studentId == null) {
        incorrectStudentId += 1;
        if (samples.incorrectStudentId.length < 3) {
          samples.incorrectStudentId.push(sampleLabel(contest, sheet));
        }
      }
    }
    if (contest.classRoomId == null) continue;
    const roster = students.filter(
      (student) =>
        student.classId === contest.classRoomId &&
        (currentClassId == null || student.classId === currentClassId)
    );
    if (roster.length === 0) continue;
    const className = classNames.get(contest.classRoomId);
    for (const student of roster) {
      const matched = contestSheets.some((sheet) =>
        sheetMatchesStudent(sheet, student)
      );
      if (!matched) {
        missingSubmission += 1;
        if (samples.missingSubmission.length < 3) {
          samples.missingSubmission.push(
            `${contest.name} · ${className ?? 'Lớp'} · SBD ${student.code}`
          );
        }
      }
    }
  }

  return [
    {
      kind: 'incorrectStudentId',
      count: incorrectStudentId,
      samples: samples.incorrectStudentId
    },
    {
      kind: 'ungraded',
      count: ungraded,
      samples: samples.ungraded
    },
    {
      kind: 'missingSubmission',
      count: missingSubmission,
      samples: samples.missingSubmission
    }
  ];
}

export function buildStatsSnapshot(
  input: StatsInput,
  scope: StatsScope
): StatsSnapshot {
  const classes = input.classes;
  const students = input.students;
  const selectedClass =
    scope.kind === 'class'
      ? classes.find((room) => room.id === scope.classId) ?? null
      : null;
  const scopeClassId = scope.kind === 'class' ? scope.classId : undefined;
  const scopeClasses =
    scope.kind === 'class'
      ? selectedClass
        ? [selectedClass]
        : []
      : scope.kind === 'outside'
        ? []
        : classes;
  const scopeStudents =
    scope.kind === 'class'
      ? students.filter((student) => student.classId === scopeClassId)
      : scope.kind === 'outside'
        ? []
        : students;
  const scopeContests = input.contests.filter((contest) => {
    if (scope.kind === 'class') return contest.classRoomId === scopeClassId;
    if (scope.kind === 'outside') return contest.classRoomId == null;
    return true;
  });
  const contestIds = new Set(scopeContests.map((contest) => contest.id));
  const scopeSheets = input.sheets.filter((sheet) =>
    contestIds.has(sheet.contestId)
  );
  const classNames = new Map(classes.map((room) => [room.id, room.name]));

  const exams = scopeContests
    .map((contest) =>
      computeContestStats(
        contest,
        scopeSheets,
        contest.classRoomId == null
          ? null
          : classNames.get(contest.classRoomId) ?? null,
        students.filter((student) => student.classId === contest.classRoomId)
      )
    )
    .sort((a, b) =>
      String(b.contest.examDate).localeCompare(String(a.contest.examDate))
    );

  const graded = scopeSheets.filter((sheet) => sheet.keyId != null);
  const contestById = new Map(
    scopeContests.map((contest) => [contest.id, contest])
  );
  const scores = graded
    .map((sheet) => {
      const contest = contestById.get(sheet.contestId);
      return contest ? scoreOf(sheet, contest) : null;
    })
    .filter((value): value is number => value != null);

  const classIdsWithExams = new Set(
    scopeContests
      .map((contest) => contest.classRoomId)
      .filter((id): id is number => id != null)
  );
  const expectedSlots = students.filter((student) =>
    classIdsWithExams.has(student.classId)
  ).length;
  const completedSlots = students.filter((student) => {
    if (!classIdsWithExams.has(student.classId)) return false;
    return scopeSheets.some((sheet) => sheetMatchesStudent(sheet, student));
  }).length;

  const trend = exams
    .filter((exam) => exam.average10 != null)
    .map((exam) => ({
      contestId: exam.contest.id,
      name: exam.contest.name,
      examDate: String(exam.contest.examDate),
      average10: exam.average10 as number
    }))
    .sort((a, b) =>
      String(a.examDate).localeCompare(String(b.examDate)) ||
      a.contestId - b.contestId
    );

  return {
    classCount: scopeClasses.length,
    studentCount: scopeStudents.length,
    contestCount: scopeContests.length,
    totalSheets: scopeSheets.length,
    gradedSheets: graded.length,
    average10: average(scores),
    completion: expectedSlots > 0 ? completedSlots / expectedSlots : null,
    expectedSlots,
    completedSlots,
    exams,
    attention: attentionItems(
      scopeContests,
      scopeSheets,
      classes,
      students,
      scopeClassId
    ),
    trend
  };
}
