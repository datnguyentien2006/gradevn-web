// CRUD mirrors of lib/data/repositories/drift_repositories.dart.
// Rules carried over from the Flutter app:
// - a class with students cannot be deleted;
// - deleting a student clears studentId on graded sheets but keeps the rows;
// - one answer key per (contestId, examCode); examCode "" = common key;
// - deleting a contest removes its keys, sheets, and sheet images.

import type {
  AnswerKey,
  ClassRoom,
  Contest,
  GradedSheet,
  Student
} from '../core/types';
import { database } from './db';

const collator = new Intl.Collator('vi');

function compareCode(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { numeric: true });
}

export function normalizeExamCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}

// Giữ dấu '-' vì key editor (và Flutter) lưu câu chưa nhập đáp án bằng '-'
// để không làm lệch vị trí các câu phía sau.
export function normalizeAnswerSequence(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z-]/g, '');
}

function normalizeDate(value: Date | string): string {
  if (value instanceof Date) {
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

function cleanName(raw: string): string {
  return raw.trim();
}

// ---------------------------------------------------------------- classes

export async function listClassRooms(): Promise<ClassRoom[]> {
  const db = await database();
  const rows = await db.getAll('classRooms');
  return rows.sort((a, b) => collator.compare(a.name, b.name));
}

export async function getClassRoom(id: number): Promise<ClassRoom | null> {
  const db = await database();
  return (await db.get('classRooms', id)) ?? null;
}

export async function addClassRoom(input: {
  name: string;
  description?: string | null;
}): Promise<number> {
  const name = cleanName(input.name);
  if (!name) throw new Error('Tên lớp không được để trống.');
  const db = await database();
  return (await db.add('classRooms', {
    name,
    description: input.description?.trim() || null
  } as ClassRoom)) as number;
}

export async function updateClassRoom(
  id: number,
  input: { name: string; description?: string | null }
): Promise<void> {
  const name = cleanName(input.name);
  if (!name) throw new Error('Tên lớp không được để trống.');
  const db = await database();
  const current = await db.get('classRooms', id);
  if (!current) throw new Error('Không tìm thấy lớp.');
  await db.put('classRooms', {
    ...current,
    name,
    description: input.description?.trim() || null
  });
}

export async function deleteClassRoom(id: number): Promise<void> {
  const db = await database();
  const rosterCount = await db.countFromIndex('students', 'by-class', id);
  if (rosterCount > 0) {
    throw new Error('Lớp còn học sinh — xoá học sinh trước khi xoá lớp.');
  }
  const contests = await db.getAllFromIndex('contests', 'by-class', id);
  const tx = db.transaction(['classRooms', 'contests'], 'readwrite');
  for (const contest of contests) {
    await tx.objectStore('contests').put({ ...contest, classRoomId: null });
  }
  await tx.objectStore('classRooms').delete(id);
  await tx.done;
}

// --------------------------------------------------------------- students

export async function listStudents(classId: number): Promise<Student[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('students', 'by-class', classId);
  return rows.sort((a, b) => compareCode(a.code, b.code));
}

export async function listAllStudents(): Promise<Student[]> {
  const db = await database();
  const rows = await db.getAll('students');
  return rows.sort((a, b) => compareCode(a.code, b.code));
}

export async function findStudentByCode(
  classId: number,
  code: string
): Promise<Student | null> {
  const normalized = code.trim();
  if (!normalized) return null;
  const roster = await listStudents(classId);
  return (
    roster.find((student) => student.code.trim() === normalized) ?? null
  );
}

export async function addStudent(input: {
  classId: number;
  code: string;
  fullName: string;
}): Promise<number> {
  const code = input.code.trim();
  const fullName = input.fullName.trim();
  if (!code) throw new Error('SBD/mã học sinh không được để trống.');
  const existing = await findStudentByCode(input.classId, code);
  if (existing) throw new Error(`SBD ${code} đã có trong lớp.`);
  const db = await database();
  return (await db.add('students', {
    classId: input.classId,
    code,
    fullName
  } as Student)) as number;
}

export async function updateStudent(
  id: number,
  input: { code: string; fullName: string }
): Promise<void> {
  const code = input.code.trim();
  if (!code) throw new Error('SBD/mã học sinh không được để trống.');
  const db = await database();
  const current = await db.get('students', id);
  if (!current) throw new Error('Không tìm thấy học sinh.');
  const roster = await listStudents(current.classId);
  if (
    roster.some(
      (student) => student.id !== id && student.code.trim() === code
    )
  ) {
    throw new Error(`SBD ${code} đã có trong lớp.`);
  }
  await db.put('students', { ...current, code, fullName: input.fullName.trim() });
}

/** Ghi đè theo SBD giống import XLSX của bản Flutter. */
export async function importStudents(
  classId: number,
  rows: { code: string; fullName: string }[]
): Promise<{ added: number; updated: number; skipped: number }> {
  const db = await database();
  const roster = await listStudents(classId);
  const byCode = new Map(roster.map((student) => [student.code.trim(), student]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const tx = db.transaction('students', 'readwrite');
  for (const row of rows) {
    const code = row.code.trim();
    const fullName = row.fullName.trim();
    if (!code) {
      skipped += 1;
      continue;
    }
    const existing = byCode.get(code);
    if (existing) {
      await tx.store.put({ ...existing, fullName: fullName || existing.fullName });
      updated += 1;
    } else {
      const key = (await tx.store.add({
        classId,
        code,
        fullName
      } as Student)) as number;
      byCode.set(code, { id: key, classId, code, fullName });
      added += 1;
    }
  }
  await tx.done;
  return { added, updated, skipped };
}

export async function deleteStudent(id: number): Promise<void> {
  const db = await database();
  const sheets = await db.getAllFromIndex('gradedSheets', 'by-student', id);
  const tx = db.transaction(['students', 'gradedSheets'], 'readwrite');
  for (const sheet of sheets) {
    await tx.objectStore('gradedSheets').put({ ...sheet, studentId: null });
  }
  await tx.objectStore('students').delete(id);
  await tx.done;
}

// --------------------------------------------------------------- contests

export async function listContests(): Promise<Contest[]> {
  const db = await database();
  const rows = await db.getAll('contests');
  return rows.sort((a, b) => {
    const dateA = String(a.examDate);
    const dateB = String(b.examDate);
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return collator.compare(a.name, b.name);
  });
}

export async function getContest(id: number): Promise<Contest | null> {
  const db = await database();
  return (await db.get('contests', id)) ?? null;
}

export interface ContestInput {
  name: string;
  examDate: string;
  classRoomId?: number | null;
  questionCount: number;
  answerChoices: number;
  maxScore: number;
  formType: Contest['formType'];
  orientation: Contest['orientation'];
  partOneCount?: number | null;
  partTwoCount?: number | null;
  partThreeCount?: number | null;
  partOneWeight?: number | null;
  partTwoWeight?: number | null;
  partThreeWeight?: number | null;
}

function cleanContest(input: ContestInput): Omit<Contest, 'id'> {
  const name = cleanName(input.name);
  if (!name) throw new Error('Tên kỳ thi không được để trống.');
  const questionCount = Math.max(1, Math.round(input.questionCount || 0));
  const answerChoices = Math.max(2, Math.min(5, Math.round(input.answerChoices || 4)));
  const maxScore = input.maxScore > 0 ? input.maxScore : 10;
  const ministry = input.formType === 'ministry';
  return {
    name,
    examDate: normalizeDate(input.examDate),
    classRoomId: input.classRoomId ?? null,
    questionCount,
    answerChoices,
    maxScore,
    formType: input.formType,
    orientation: input.orientation,
    partOneCount: ministry ? input.partOneCount ?? null : null,
    partTwoCount: ministry ? input.partTwoCount ?? null : null,
    partThreeCount: ministry ? input.partThreeCount ?? null : null,
    partOneWeight: ministry ? input.partOneWeight ?? null : null,
    partTwoWeight: ministry ? input.partTwoWeight ?? null : null,
    partThreeWeight: ministry ? input.partThreeWeight ?? null : null
  };
}

export async function addContest(input: ContestInput): Promise<number> {
  const db = await database();
  return (await db.add('contests', cleanContest(input) as Contest)) as number;
}

export async function updateContest(
  id: number,
  input: ContestInput
): Promise<void> {
  const db = await database();
  const current = await db.get('contests', id);
  if (!current) throw new Error('Không tìm thấy kỳ thi.');
  await db.put('contests', { ...cleanContest(input), id });
}

export async function deleteContest(id: number): Promise<void> {
  const db = await database();
  const [keys, sheets] = await Promise.all([
    db.getAllFromIndex('answerKeys', 'by-contest', id),
    db.getAllFromIndex('gradedSheets', 'by-contest', id)
  ]);
  const tx = db.transaction(
    ['contests', 'answerKeys', 'gradedSheets', 'images'],
    'readwrite'
  );
  for (const sheet of sheets) {
    for (const path of [sheet.originalImagePath, sheet.markedImagePath]) {
      if (path) await tx.objectStore('images').delete(path);
    }
    await tx.objectStore('gradedSheets').delete(sheet.id);
  }
  for (const key of keys) await tx.objectStore('answerKeys').delete(key.id);
  await tx.objectStore('contests').delete(id);
  await tx.done;
}

// ------------------------------------------------------------- answer keys

export async function listAnswerKeys(contestId: number): Promise<AnswerKey[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('answerKeys', 'by-contest', contestId);
  return rows.sort((a, b) => {
    if (a.examCode === '') return -1;
    if (b.examCode === '') return 1;
    return a.examCode.localeCompare(b.examCode, 'vi', { numeric: true });
  });
}

export async function getAnswerKey(id: number): Promise<AnswerKey | null> {
  const db = await database();
  return (await db.get('answerKeys', id)) ?? null;
}

/**
 * Lưu đáp án; nếu (contestId, examCode) đã tồn tại thì ghi đè chuỗi đáp án
 * (giống ràng buộc unique của bảng answer_keys) và giữ id cũ.
 */
export async function upsertAnswerKey(input: {
  id?: number;
  contestId: number;
  examCode: string;
  answerSequence: string;
}): Promise<AnswerKey> {
  const examCode = normalizeExamCode(input.examCode);
  const answerSequence = normalizeAnswerSequence(input.answerSequence);
  const db = await database();
  const existing = await db.getFromIndex(
    'answerKeys',
    'contest-exam',
    [input.contestId, examCode] as [number, string]
  );
  const record: AnswerKey = {
    id: existing?.id ?? input.id ?? 0,
    contestId: input.contestId,
    examCode,
    answerSequence,
    createdAt: existing?.createdAt ?? new Date()
  };
  if (record.id) {
    await db.put('answerKeys', record);
    return record;
  }
  // Khoá tự tăng: không được đưa thuộc tính id vào payload, kể cả undefined,
  // vì IndexedDB sẽ coi keyPath trỏ tới một khoá không hợp lệ.
  const id = (await db.add('answerKeys', {
    contestId: record.contestId,
    examCode: record.examCode,
    answerSequence: record.answerSequence,
    createdAt: record.createdAt
  } as AnswerKey)) as number;
  return { ...record, id };
}

export async function deleteAnswerKey(id: number): Promise<void> {
  const db = await database();
  await db.delete('answerKeys', id);
}

// ----------------------------------------------------------- graded sheets

export async function listGradedSheets(contestId: number): Promise<GradedSheet[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('gradedSheets', 'by-contest', contestId);
  return rows.sort((a, b) => {
    const code = compareCode(a.studentCode, b.studentCode);
    if (code !== 0) return code;
    return String(a.gradedAt).localeCompare(String(b.gradedAt));
  });
}

export async function listAllGradedSheets(): Promise<GradedSheet[]> {
  const db = await database();
  return db.getAll('gradedSheets');
}

export async function getGradedSheet(id: number): Promise<GradedSheet | null> {
  const db = await database();
  return (await db.get('gradedSheets', id)) ?? null;
}

export type GradedSheetInput = Omit<
  GradedSheet,
  'id' | 'originalImagePath' | 'markedImagePath'
> & {
  id?: number;
  originalImagePath?: string | null;
  markedImagePath?: string | null;
};

export interface SheetImageBlobs {
  original?: Blob | null;
  marked?: Blob | null;
}

/** Lưu phiếu + 2 ảnh PNG trong cùng một transaction. */
export async function saveGradedSheet(
  input: GradedSheetInput,
  blobs: SheetImageBlobs = {}
): Promise<GradedSheet> {
  const db = await database();
  const existing = input.id ? await getGradedSheet(input.id) : null;
  const stamp = Date.now();
  const base = `sheets/contest_${input.contestId}`;
  let originalImagePath =
    input.originalImagePath ?? existing?.originalImagePath ?? null;
  let markedImagePath = input.markedImagePath ?? existing?.markedImagePath ?? null;
  if (blobs.original) originalImagePath = `${base}/orig_${stamp}.png`;
  if (blobs.marked) markedImagePath = `${base}/marked_${stamp}.png`;

  const record = {
    contestId: input.contestId,
    examCode: input.examCode,
    studentCode: input.studentCode,
    chosen: input.chosen,
    correctFlags: input.correctFlags,
    score: input.score,
    keyId: input.keyId ?? null,
    studentId: input.studentId ?? null,
    partScores: input.partScores ?? {},
    originalImagePath,
    markedImagePath,
    infoImagePath: input.infoImagePath ?? existing?.infoImagePath ?? null,
    gradedAt: input.gradedAt ?? new Date().toISOString()
  } as GradedSheet;

  const tx = db.transaction(['gradedSheets', 'images'], 'readwrite');
  if (blobs.original && originalImagePath) {
    await tx.objectStore('images').put({
      path: originalImagePath,
      blob: blobs.original
    });
  }
  if (blobs.marked && markedImagePath) {
    await tx.objectStore('images').put({
      path: markedImagePath,
      blob: blobs.marked
    });
  }
  let id: number;
  if (input.id) {
    id = input.id;
    await tx.objectStore('gradedSheets').put({ ...record, id });
  } else {
    id = (await tx.objectStore('gradedSheets').add(record)) as number;
  }
  await tx.done;
  return { ...record, id };
}

export async function updateGradedSheet(
  id: number,
  patch: Partial<
    Pick<
      GradedSheet,
      'studentCode' | 'examCode' | 'studentId' | 'keyId' | 'score' | 'correctFlags'
    >
  >
): Promise<GradedSheet> {
  const db = await database();
  const current = await db.get('gradedSheets', id);
  if (!current) throw new Error('Không tìm thấy phiếu.');
  const next = { ...current, ...patch };
  await db.put('gradedSheets', next);
  return next;
}

export async function deleteGradedSheet(id: number): Promise<void> {
  const db = await database();
  const sheet = await db.get('gradedSheets', id);
  if (!sheet) return;
  const tx = db.transaction(['gradedSheets', 'images'], 'readwrite');
  for (const path of [sheet.originalImagePath, sheet.markedImagePath]) {
    if (path) await tx.objectStore('images').delete(path);
  }
  await tx.objectStore('gradedSheets').delete(id);
  await tx.done;
}

export async function getImageBlob(path: string | null | undefined): Promise<Blob | null> {
  if (!path) return null;
  const db = await database();
  return (await db.get('images', path))?.blob ?? null;
}

// --------------------------------------------------------------- settings

export async function getSetting(key: string): Promise<string | null> {
  const db = await database();
  return (await db.get('settings', key))?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await database();
  await db.put('settings', { key, value });
}

export async function getJsonSetting<T>(
  key: string,
  fallback: T
): Promise<T> {
  const raw = await getSetting(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}
