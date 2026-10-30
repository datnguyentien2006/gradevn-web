// Cấu hình "đề thử" tạm thời cho bước 4 (chưa có IndexedDB — bước 5).
// Lưu localStorage để thử camera + pipeline trên iPhone thật trước khi có
// màn hình kỳ thi/đáp án đầy đủ.
//
// Đề thử dùng đúng cấu hình phiếu chuẩn TN40: 40 câu, 4 lựa chọn, điểm 10.

import type { AnswerKey, Contest } from '../core/types';

const STORAGE_KEY = 'gradevn.scan.practice.v1';

/** Đề mẫu khớp fixtures/standard40.png (37/40 câu đúng, 9.25 điểm). */
export const SAMPLE_EXAM_CODE = '001';
export const SAMPLE_ANSWERS =
  'BADCBADCBADCCADCBADCBADCBADCBADCBADCBADC';

export interface PracticeSettings {
  examCode: string;
  answers: string;
  autoCapture: boolean;
}

export const DEFAULT_PRACTICE: PracticeSettings = {
  examCode: SAMPLE_EXAM_CODE,
  answers: SAMPLE_ANSWERS,
  autoCapture: true
};

export function loadPracticeSettings(): PracticeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PRACTICE };
    const parsed = JSON.parse(raw) as Partial<PracticeSettings>;
    return {
      examCode: normalizeExamCode(String(parsed.examCode ?? DEFAULT_PRACTICE.examCode)),
      answers: normalizeAnswerSequence(String(parsed.answers ?? DEFAULT_PRACTICE.answers)),
      autoCapture: parsed.autoCapture !== false
    };
  } catch {
    return { ...DEFAULT_PRACTICE };
  }
}

export function savePracticeSettings(settings: PracticeSettings): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        examCode: normalizeExamCode(settings.examCode),
        answers: normalizeAnswerSequence(settings.answers),
        autoCapture: settings.autoCapture
      })
    );
  } catch {
    // Chế độ riêng tư của Safari có thể chặn localStorage — bỏ qua.
  }
}

/** Chỉ giữ chữ cái A–Z, viết hoa, tối đa 40 câu. */
export function normalizeAnswerSequence(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 40);
}

/** Mã đề trên phiếu là 3 ô số 0–9. */
export function normalizeExamCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}

export interface PracticeSession {
  contest: Contest;
  keys: AnswerKey[];
}

export function buildPracticeSession(settings: PracticeSettings): PracticeSession {
  const answers = normalizeAnswerSequence(settings.answers);
  const examCode = normalizeExamCode(settings.examCode);
  const questionCount = answers.length > 0 ? Math.min(40, answers.length) : 40;
  const contest: Contest = {
    id: 1,
    name: 'Phiếu thử',
    examDate: new Date().toISOString().slice(0, 10),
    classRoomId: null,
    questionCount,
    answerChoices: 4,
    maxScore: 10,
    formType: 'standard',
    orientation: 'portrait'
  };
  const keys: AnswerKey[] =
    answers.length === 0
      ? []
      : [
          {
            id: 1,
            contestId: contest.id,
            examCode,
            answerSequence: answers.slice(0, questionCount)
          }
        ];
  return { contest, keys };
}
