// Sao lưu / phục hồi toàn bộ IndexedDB dạng JSON.
// Bản Flutter không có tính năng này; đây là bổ sung riêng cho web để dữ liệu
// không mất khi người dùng xoá dữ liệu website. Ảnh phiếu được nhúng base64
// (có thể tắt để file nhẹ hơn).

import { database, STORE_NAMES } from './db';
import type {
  AnswerKey,
  ClassRoom,
  Contest,
  GradedSheet,
  Student
} from '../core/types';
import type { SettingRow } from './db';

const FORMAT = 'gradevn-web';
const VERSION = 1;

export interface BackupImage {
  path: string;
  type: string;
  data: string;
}

export interface BackupPayload {
  app: typeof FORMAT;
  version: number;
  exportedAt: string;
  classRooms: ClassRoom[];
  students: Student[];
  contests: Contest[];
  answerKeys: AnswerKey[];
  gradedSheets: GradedSheet[];
  settings: SettingRow[];
  images: BackupImage[];
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: type || 'image/png' });
}

export async function createBackup(options: { images: boolean }): Promise<{
  blob: Blob;
  filename: string;
  counts: Record<string, number>;
}> {
  const db = await database();
  const [classRooms, students, contests, answerKeys, gradedSheets, settings] =
    await Promise.all([
      db.getAll('classRooms'),
      db.getAll('students'),
      db.getAll('contests'),
      db.getAll('answerKeys'),
      db.getAll('gradedSheets'),
      db.getAll('settings')
    ]);
  const imageRows = options.images ? await db.getAll('images') : [];
  const images: BackupImage[] = [];
  for (const row of imageRows) {
    images.push({
      path: row.path,
      type: row.blob.type || 'image/png',
      data: await blobToBase64(row.blob)
    });
  }
  const payload: BackupPayload = {
    app: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    classRooms,
    students,
    contests,
    answerKeys,
    gradedSheets,
    settings,
    images
  };
  const blob = new Blob([JSON.stringify(payload)], {
    type: 'application/json'
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    filename: `gradevn-backup-${stamp}.json`,
    counts: {
      classes: classRooms.length,
      students: students.length,
      contests: contests.length,
      keys: answerKeys.length,
      sheets: gradedSheets.length,
      images: images.length
    }
  };
}

export interface RestoreResult {
  classes: number;
  students: number;
  contests: number;
  keys: number;
  sheets: number;
  images: number;
}

function expectArray<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`File sao lưu thiếu mảng "${name}".`);
  }
  return value as T[];
}

/** Thay thế toàn bộ dữ liệu hiện tại bằng nội dung file sao lưu. */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('File sao lưu không hợp lệ.');
  }
  const payload = parsed as Partial<BackupPayload>;
  if (payload.app !== FORMAT) {
    throw new Error('File không phải bản sao lưu của GradeVN Web.');
  }
  if (payload.version !== VERSION) {
    throw new Error(`Phiên bản sao lưu ${payload.version} không được hỗ trợ.`);
  }
  const classRooms = expectArray<ClassRoom>(payload.classRooms, 'classRooms');
  const students = expectArray<Student>(payload.students, 'students');
  const contests = expectArray<Contest>(payload.contests, 'contests');
  const answerKeys = expectArray<AnswerKey>(payload.answerKeys, 'answerKeys');
  const gradedSheets = expectArray<GradedSheet>(
    payload.gradedSheets,
    'gradedSheets'
  );
  const settings = payload.settings
    ? expectArray<SettingRow>(payload.settings, 'settings')
    : [];
  const backupImages = payload.images
    ? expectArray<BackupImage>(payload.images, 'images')
    : [];
  const images = backupImages.map((image) => ({
    path: image.path,
    blob: base64ToBlob(image.data, image.type)
  }));

  const db = await database();
  const tx = db.transaction([...STORE_NAMES], 'readwrite');
  for (const store of STORE_NAMES) {
    await tx.objectStore(store).clear();
  }
  for (const value of classRooms) await tx.objectStore('classRooms').put(value);
  for (const value of students) await tx.objectStore('students').put(value);
  for (const value of contests) await tx.objectStore('contests').put(value);
  for (const value of answerKeys) await tx.objectStore('answerKeys').put(value);
  for (const value of gradedSheets) {
    await tx.objectStore('gradedSheets').put(value);
  }
  for (const image of images) {
    await tx.objectStore('images').put(image);
  }
  for (const value of settings) await tx.objectStore('settings').put(value);
  await tx.done;

  return {
    classes: classRooms.length,
    students: students.length,
    contests: contests.length,
    keys: answerKeys.length,
    sheets: gradedSheets.length,
    images: images.length
  };
}

export async function clearAllData(): Promise<void> {
  const db = await database();
  const tx = db.transaction([...STORE_NAMES], 'readwrite');
  for (const store of STORE_NAMES) {
    await tx.objectStore(store).clear();
  }
  await tx.done;
}
