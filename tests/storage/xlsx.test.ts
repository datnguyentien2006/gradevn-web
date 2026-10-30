import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  readKeysWorkbook,
  readStudentsWorkbook,
  writeKeysWorkbook,
  writeResultsWorkbook,
  workbookBytes
} from '../../src/storage/xlsx';
import type { AnswerKey, Contest, GradedSheet } from '../../src/core/types';

function workbookBytesOf(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    'Sheet1'
  );
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('XLSX', () => {
  it('đọc danh sách học sinh, bỏ tiêu đề và hàng trống', () => {
    const data = workbookBytesOf([
      ['Mã', 'Họ tên'],
      ['000001', 'Nguyễn An'],
      ['', ''],
      ['000002', 'Trần Bình']
    ]);
    expect(readStudentsWorkbook(data)).toEqual([
      { code: '000001', fullName: 'Nguyễn An' },
      { code: '000002', fullName: 'Trần Bình' }
    ]);
  });

  it('đọc đáp án từng ô và tách chuỗi trong một ô', () => {
    const data = workbookBytesOf([
      ['Mã đề', 'Câu 1', 'Câu 2', 'Câu 3'],
      ['001', 'A', 'B', 'C'],
      ['002', 'A B C D'],
      ['Mã đề', 'x', 'y', 'z'],
      ['', '', '', '']
    ]);
    expect(readKeysWorkbook(data)).toEqual([
      { examCode: '001', answerSequence: 'ABC' },
      { examCode: '002', answerSequence: 'ABCD' }
    ]);
  });

  it('xuất đáp án và kết quả đúng bố cục Flutter', () => {
    const keys: AnswerKey[] = [
      { id: 1, contestId: 1, examCode: '001', answerSequence: 'ABCD' }
    ];
    const contest: Contest = {
      id: 1,
      name: 'Giữa kỳ',
      examDate: '2026-10-01',
      questionCount: 40,
      answerChoices: 4,
      maxScore: 10,
      formType: 'standard',
      orientation: 'portrait'
    };
    const sheet: GradedSheet = {
      id: 1,
      contestId: 1,
      examCode: '001',
      studentCode: '000001',
      chosen: 'ABCD',
      correctFlags: '1111',
      score: 8,
      keyId: 1,
      studentId: null,
      partScores: {},
      gradedAt: '2026-10-01T10:00:00.000Z'
    };

    const keyBook = XLSX.read(workbookBytes(writeKeysWorkbook(keys)), { type: 'array' });
    const keyRows = XLSX.utils.sheet_to_json(keyBook.Sheets[keyBook.SheetNames[0]], {
      header: 1
    });
    expect(keyRows[0]).toEqual(['Exam code', 'Answer sequence']);
    expect(keyRows[1]).toEqual(['001', 'A B C D']);

    const resultBook = XLSX.read(
      workbookBytes(writeResultsWorkbook(contest, [sheet])),
      { type: 'array' }
    );
    const resultRows = XLSX.utils.sheet_to_json<unknown[]>(
      resultBook.Sheets.Results,
      { header: 1 }
    );
    expect(resultRows[0][0]).toBe('Exam: Giữa kỳ');
    expect(resultRows[1]).toEqual([
      'No.',
      'Student ID',
      'Exam code',
      'Full name',
      'Score',
      'Part I',
      'Part II',
      'Part III'
    ]);
    expect(resultRows[2]).toEqual([
      1,
      '000001',
      '001',
      '',
      8,
      0,
      0,
      0
    ]);
  });
});
