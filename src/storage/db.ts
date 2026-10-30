// IndexedDB thay cho SQLite/Drift của bản Flutter.
// Nguồn Dart: lib/data/db/schema.dart (bảng class_rooms, students, contests,
// answer_keys, graded_sheets, app_settings).
//
// Khác biệt có chủ đích:
// - Ảnh phiếu lưu trong store `images` (Blob) thay vì file trên đĩa; trường
//   originalImagePath/markedImagePath vẫn giữ nguyên dạng chuỗi đường dẫn.
// - partScores lưu dạng object thay vì 3 cột partOneScore/Two/Three.
// - examDate lưu chuỗi ISO "YYYY-MM-DD" để index và xuất file ổn định.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AnswerKey,
  ClassRoom,
  Contest,
  GradedSheet,
  Student
} from '../core/types';

export interface SheetImage {
  path: string;
  blob: Blob;
}

export interface SettingRow {
  key: string;
  value: string;
}

export interface GradeVNDB extends DBSchema {
  classRooms: {
    key: number;
    value: ClassRoom;
    indexes: { 'by-name': string };
  };
  students: {
    key: number;
    value: Student;
    indexes: { 'by-class': number };
  };
  contests: {
    key: number;
    value: Contest;
    indexes: { 'by-class': number; 'by-date': string };
  };
  answerKeys: {
    key: number;
    value: AnswerKey;
    indexes: {
      'by-contest': number;
      'contest-exam': [number, string];
    };
  };
  gradedSheets: {
    key: number;
    value: GradedSheet;
    indexes: {
      'by-contest': number;
      'by-student': number;
      'by-key': number;
      'by-date': string;
    };
  };
  images: {
    key: string;
    value: SheetImage;
  };
  settings: {
    key: string;
    value: SettingRow;
  };
}

export const DB_NAME = 'gradevn';
export const DB_VERSION = 1;

export const STORE_NAMES = [
  'classRooms',
  'students',
  'contests',
  'answerKeys',
  'gradedSheets',
  'images',
  'settings'
] as const;

let handle: Promise<IDBPDatabase<GradeVNDB>> | null = null;

export function database(): Promise<IDBPDatabase<GradeVNDB>> {
  if (!handle) {
    handle = openDB<GradeVNDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const classes = db.createObjectStore('classRooms', {
          keyPath: 'id',
          autoIncrement: true
        });
        classes.createIndex('by-name', 'name');

        const students = db.createObjectStore('students', {
          keyPath: 'id',
          autoIncrement: true
        });
        students.createIndex('by-class', 'classId');

        const contests = db.createObjectStore('contests', {
          keyPath: 'id',
          autoIncrement: true
        });
        contests.createIndex('by-class', 'classRoomId');
        contests.createIndex('by-date', 'examDate');

        const keys = db.createObjectStore('answerKeys', {
          keyPath: 'id',
          autoIncrement: true
        });
        keys.createIndex('by-contest', 'contestId');
        keys.createIndex('contest-exam', ['contestId', 'examCode'], {
          unique: true
        });

        const sheets = db.createObjectStore('gradedSheets', {
          keyPath: 'id',
          autoIncrement: true
        });
        sheets.createIndex('by-contest', 'contestId');
        sheets.createIndex('by-student', 'studentId');
        sheets.createIndex('by-key', 'keyId');
        sheets.createIndex('by-date', 'gradedAt');

        db.createObjectStore('images', { keyPath: 'path' });
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    });
    handle.catch(() => {
      handle = null;
    });
  }
  return handle;
}

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const storage = navigator.storage;
  if (!storage?.estimate) {
    return { supported: false, persisted: false, usage: null, quota: null };
  }
  try {
    const [estimate, persisted] = await Promise.all([
      storage.estimate(),
      storage.persisted ? storage.persisted() : Promise.resolve(false)
    ]);
    return {
      supported: true,
      persisted,
      usage: estimate.usage ?? null,
      quota: estimate.quota ?? null
    };
  } catch {
    return { supported: false, persisted: false, usage: null, quota: null };
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
