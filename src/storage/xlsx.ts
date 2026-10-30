// Nhập/xuất XLSX — port từ lib/data/import_export/xlsx_service.dart và
// stats_export.dart (định dạng ở LOGIC_SPEC §4.4).
// Không đổi quy tắc đọc/ghi của bản Flutter; chỉ thay Syncfusion bằng SheetJS.

import * as XLSX from 'xlsx';
import type { AnswerKey, Contest, GradedSheet, Student } from '../core/types';
import type { StatsSnapshot } from './stats';

type Row = unknown[];

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function rowsOf(data: ArrayBuffer | Uint8Array): Row[] {
  const workbook = XLSX.read(data, { type: 'array' });
  const firstName = workbook.SheetNames[0];
  if (!firstName) return [];
  const sheet = workbook.Sheets[firstName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: ''
  });
}

function isHeaderCell(value: string): boolean {
  const lower = value.toLocaleLowerCase('vi');
  return (
    lower.includes('mã') ||
    lower.includes('sbd') ||
    lower.includes('code') ||
    lower.includes('stt')
  );
}

function digits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}

function letters(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '');
}

export interface StudentImportRow {
  code: string;
  fullName: string;
}

/** Cột A = SBD/mã học sinh, cột B = họ tên; bỏ hàng tiêu đề và hàng trống. */
export function readStudentsWorkbook(data: ArrayBuffer | Uint8Array): StudentImportRow[] {
  const result: StudentImportRow[] = [];
  for (const row of rowsOf(data)) {
    const first = cellText(row[0]);
    if (!first) continue;
    if (isHeaderCell(first)) continue;
    const fullName = cellText(row[1]);
    result.push({ code: first, fullName });
  }
  return result;
}

export interface KeyImportRow {
  examCode: string;
  answerSequence: string;
}

/**
 * Cột A = mã đề; các cột B.. = đáp án (mỗi ô một chữ).
 * Nếu chỉ có một ô đáp án chứa cả chuỗi thì tách theo khoảng trắng/dấu phẩy/chấm phẩy.
 */
export function readKeysWorkbook(data: ArrayBuffer | Uint8Array): KeyImportRow[] {
  const result: KeyImportRow[] = [];
  for (const row of rowsOf(data)) {
    const first = cellText(row[0]);
    if (!first && row.every((cell) => !cellText(cell))) continue;
    if (isHeaderCell(first)) continue;
    const examCode = digits(first);
    const cells = row
      .slice(1)
      .map(cellText)
      .filter((cell) => cell.length > 0);
    if (cells.length === 0) continue;
    const answerSequence =
      cells.length === 1
        ? letters(cells[0])
        : cells.map((cell) => letters(cell)).join('');
    if (!answerSequence) continue;
    result.push({ examCode, answerSequence });
  }
  return result;
}

function workout(
  sheetName: string,
  rows: unknown[][],
  widths: number[] = []
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return workbook;
}

function appendSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  rows: unknown[][],
  widths: number[] = []
): void {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

/** Sheet "Exam code": Exam code | Answer sequence (cách nhau bởi dấu cách). */
export function writeKeysWorkbook(keys: AnswerKey[]): XLSX.WorkBook {
  const rows: unknown[][] = [['Exam code', 'Answer sequence']];
  for (const key of keys) {
    rows.push([key.examCode, key.answerSequence.split('').join(' ')]);
  }
  return workout('Exam code', rows, [14, 86]);
}

/**
 * Sheet "Results" đúng bố cục Flutter: A1 = "Exam: <tên>", tiêu đề ở hàng 2,
 * dữ liệu từ hàng 3. Bản Flutter không điền họ tên ở màn chi tiết kỳ thi —
 * giữ nguyên hành vi đó (chỉ điền khi caller truyền danh sách học sinh).
 */
export function writeResultsWorkbook(
  contest: Contest,
  sheets: GradedSheet[],
  students?: Student[]
): XLSX.WorkBook {
  const names = new Map(
    (students ?? []).map((student) => [student.id, student.fullName])
  );
  const rows: unknown[][] = [
    [`Exam: ${contest.name}`],
    [
      'No.',
      'Student ID',
      'Exam code',
      'Full name',
      'Score',
      'Part I',
      'Part II',
      'Part III'
    ]
  ];
  sheets.forEach((sheet, index) => {
    rows.push([
      index + 1,
      sheet.studentCode,
      sheet.examCode,
      sheet.studentId != null ? names.get(sheet.studentId) ?? '' : '',
      sheet.score,
      sheet.partScores['1'] ?? 0,
      sheet.partScores['2'] ?? 0,
      sheet.partScores['3'] ?? 0
    ]);
  });
  return workout('Results', rows, [6, 16, 12, 28, 9, 9, 9, 9]);
}

function one(value: number | null): string {
  return value == null ? '-' : value.toFixed(1);
}

function percent(value: number | null): string {
  return value == null ? '-' : `${Math.round(value * 100)}%`;
}

function isoDate(value: Date | string): string {
  return String(value).slice(0, 10);
}

function attentionLabel(kind: StatsSnapshot['attention'][number]['kind']): string {
  switch (kind) {
    case 'incorrectStudentId':
      return 'Student ID not matched';
    case 'ungraded':
      return 'Saved but not graded';
    case 'missingSubmission':
      return 'No submission';
  }
}

/** 4 sheet Overview / Exams / Questions / Attention, nhãn giống bản Flutter. */
export function writeStatsWorkbook(
  stats: StatsSnapshot,
  scopeLabel: string,
  passThreshold: number
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const overview: unknown[][] = [];
  overview.push(['GradeVN statistics']);
  overview.push([]);
  const pairs: [string, string][] = [
    ['Scope', scopeLabel],
    ['Pass threshold', one(passThreshold)],
    ['Classes', String(stats.classCount)],
    ['Students', String(stats.studentCount)],
    ['Exams', String(stats.contestCount)],
    ['Sheets saved', String(stats.totalSheets)],
    ['Graded sheets', String(stats.gradedSheets)],
    ['Average (10)', one(stats.average10)],
    ['Completion', percent(stats.completion)]
  ];
  for (const pair of pairs) overview.push(pair);
  overview.push([]);
  overview.push(['Needs attention']);
  for (const item of stats.attention) {
    overview.push([attentionLabel(item.kind), item.count]);
  }
  appendSheet(workbook, 'Overview', overview, [28, 30]);

  const exams: unknown[][] = [
    [
      'Exam',
      'Class',
      'Date',
      'Sheets saved',
      'Graded',
      'Average (10)',
      'Median (10)',
      'Highest (10)',
      'Lowest (10)',
      'Pass rate'
    ]
  ];
  for (const exam of stats.exams) {
    exams.push([
      exam.contest.name,
      exam.className ?? 'Outside class',
      isoDate(exam.contest.examDate),
      exam.sheetCount,
      exam.gradedCount,
      one(exam.average10),
      one(exam.median10),
      one(exam.max10),
      one(exam.min10),
      percent(exam.passRate)
    ]);
  }
  appendSheet(workbook, 'Exams', exams, [28, 20, 12, 12, 10, 12, 12, 12, 12, 10]);

  const questions: unknown[][] = [
    ['Exam', 'Question', 'Correct', 'Total', 'Correct rate']
  ];
  for (const exam of stats.exams) {
    for (const question of exam.questions) {
      questions.push([
        exam.contest.name,
        question.question,
        question.correct,
        question.total,
        percent(question.rate)
      ]);
    }
  }
  appendSheet(workbook, 'Questions', questions, [28, 10, 10, 10, 12]);

  const attention: unknown[][] = [['Group', 'Count', 'Examples']];
  for (const item of stats.attention) {
    attention.push([attentionLabel(item.kind), item.count, item.samples.join(' | ')]);
  }
  appendSheet(workbook, 'Attention', attention, [26, 8, 80]);

  return workbook;
}

export function workbookBytes(workbook: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}
