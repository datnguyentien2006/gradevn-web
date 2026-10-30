// Ghép "quét → chấm → gắn học sinh" — THUẦN TS, không DOM, không camera.
// Nguồn Dart: lib/data/cv/scan_flow.dart (dòng 1–187; phần isolate/decode
// thuộc worker ở web).
//
// [gradeScan] là hàm thuần port 1:1. [scanAndGrade] tương ứng
// `_scanAndGrade` của Dart: quét RGBA đã decode rồi chấm (worker gọi hàm
// này; decode ảnh nằm ngoài core).

import { GradingResult, Grader } from './grader';
import { OmrDecoder } from './omrDecoder';
import {
  OmrScanService,
  type PhotoScan,
  type RgbaScanImage
} from './scanService';
import type { AlignmentQuad, Rect, Size } from './geometry';
import type { OmrTuning } from './density';
import type { AnswerKey, Contest, Student } from './types';
import { contestSheetSpec } from './types';

/**
 * Lý do phiếu bị bỏ chấm. R24: SBD không còn là lý do — nhận diện học sinh
 * tách khỏi việc chấm. Chỉ còn kỳ thi TRONG LỚP thiếu mã đề mà không có bộ
 * đáp án chung mới không chấm được.
 */
export type UngradedReason = 'examCode';

/**
 * Kết quả chấm một phiếu đã quét: điểm + key đã dùng + học sinh đã gắn
 * + ảnh chụp gốc ([PhotoScan]) để lưu DB / vẽ phiếu có gạch đáp án.
 */
export class GradedScan {
  constructor(
    /** Cờ đúng/sai từng câu + điểm tổng + điểm từng phần. */
    public readonly result: GradingResult,
    /**
     * Mã đề thực dùng để chấm: mã đề nằm trên key đã chọn, hoặc mã đề đọc
     * được (đã chuẩn hoá) khi không có key. Phiếu bỏ chấm vì lưới mã đề
     * trống → ''.
     */
    public readonly usedExamCode: string,
    /** Key được chọn: khớp mã đề trước, fallback điểm cao nhất; null khi chưa có key. */
    public readonly usedKey: AnswerKey | null,
    /** true khi đọc không được mã đề và phải đoán key theo điểm khớp cao nhất. */
    public readonly usedBestGuessKey: boolean,
    /** Học sinh khớp SBD; null khi SBD không tra được / không có danh sách lớp. */
    public readonly student: Student | null,
    /** Kết quả quét ảnh gốc (khung + ảnh xám đã nắn phẳng). */
    public readonly photo: PhotoScan,
    /**
     * false = phiếu bị BỎ CHẤM (không có key phù hợp) — [result] chỉ là giá
     * trị rỗng (tất cả cờ null, điểm 0), KHÔNG chạy bộ chấm.
     */
    public readonly graded = true,
    /** Lý do bỏ chấm — non-null khi [graded] == false. */
    public readonly ungradedReason: UngradedReason | null = null,
    /**
     * R4: số câu tô ≥2 ô thật sự (cảnh báo "Nhiều đáp án" — decode vẫn chọn
     * ô đậm nhất, KHÔNG chặn chấm).
     */
    public readonly multiAnswerCount = 0
  ) {}
}

export interface GradeScanParams {
  contest: Contest;
  keys: AnswerKey[];
  candidateStudents: Student[];
  chosen: (string | null)[];
  studentCodeRaw: string;
  examCodeRaw: string;
  photo: PhotoScan;
}

/**
 * Chấm một phiếu từ dữ liệu đã giải mã (thuần, không IO).
 *
 * R24 — CHẤM ĐÁP ÁN TÁCH KHỎI NHẬN DIỆN HỌC SINH:
 * - SBD trống / sai / không khớp danh sách lớp KHÔNG BAO GIỜ chặn chấm:
 *   vẫn chấm đủ câu, chỉ trả `student = null` để UI cảnh báo.
 * - Kỳ thi NGOÀI LỚP (`classRoomId == null`): không cần SBD lẫn mã đề, chỉ
 *   cần đáp án; chọn key theo mã đề nếu có, không thì bộ đáp án chung, cuối
 *   cùng là key khớp điểm cao nhất (không cảnh báo "đoán key").
 * - Kỳ thi TRONG LỚP: mã đề trống + không có bộ đáp án chung → bỏ chấm
 *   (`UngradedReason.examCode`, UI hiện "NULL").
 * - Chọn key: [Grader.selectKey] theo mã đề (chuẩn hoá, xoá số 0 vô nghĩa);
 *   mã đề đọc không ra (một phần, còn '?') → [Grader.bestScoringKey] đoán
 *   theo điểm khớp cao nhất (cảnh báo best-key giữ nguyên như M3).
 * - Không có key nào: kết quả toàn câu null (không trừ điểm, không ném lỗi).
 */
export function gradeScan({
  contest,
  keys,
  candidateStudents,
  chosen,
  studentCodeRaw,
  examCodeRaw,
  photo
}: GradeScanParams): GradedScan {
  const totalQuestions = contestSheetSpec(contest).questionCount;
  const inClass = contest.classRoomId != null;

  // R22 — KỲ THI KHÔNG DÙNG MÃ ĐỀ: key "mặc định" (examCode rỗng) khiến mã
  // đề trống KHÔNG còn là lý do bỏ chấm.
  const defaultKey = keys.find((k) => k.examCode.trim().length === 0) ?? null;
  const blankExam = OmrDecoder.isBlankCode(examCodeRaw);

  // R24 — SBD KHÔNG CHẶN CHẤM. Chỉ kỳ thi TRONG LỚP bắt buộc mã đề (khi
  // không có bộ đáp án chung) mới không có key để chấm → phiếu "NULL".
  if (inClass && blankExam && defaultKey == null) {
    const emptyResult = new GradingResult(
      new Array<boolean | null>(totalQuestions).fill(null),
      0
    );
    // SBD đọc được vẫn gắn học sinh (nhận diện tách khỏi chấm).
    const normalizedStudent = OmrDecoder.normalizeStudentCode(studentCodeRaw);
    const student =
      candidateStudents.find((candidate) =>
        OmrDecoder.sameStudentCode(candidate.code, normalizedStudent)
      ) ?? null;
    return new GradedScan(
      emptyResult,
      '',
      null,
      false,
      student,
      photo,
      false,
      'examCode'
    );
  }

  const directKey =
    Grader.selectKey(keys, examCodeRaw) ?? (blankExam ? defaultKey : null);
  const key = directKey ?? Grader.bestScoringKey(keys, chosen);

  // "Đoán key" chỉ chấp nhận khi mã đề không đọc được (rỗng hoặc có '?').
  // Kỳ thi ngoài lớp không cần mã đề → không cảnh báo đoán key.
  const normalizedExam = OmrDecoder.normalizeCode(examCodeRaw);
  const usedBestGuessKey =
    inClass &&
    directKey == null &&
    key != null &&
    key !== defaultKey &&
    (normalizedExam.length === 0 || normalizedExam.includes('?'));

  // Không key nào: gradeForContest với dãy đáp án rỗng → mọi cờ null, điểm 0.
  const result = new Grader().gradeForContest(
    contest,
    key?.answerSequence ?? '',
    chosen
  );

  // R24: nhận diện học sinh là bước RIÊNG — SBD trống/sai chỉ làm student
  // null, không ảnh hưởng điểm.
  const normalizedStudent = OmrDecoder.normalizeStudentCode(studentCodeRaw);
  let student: Student | null = null;
  if (inClass && normalizedStudent.length > 0) {
    student =
      candidateStudents.find((candidate) =>
        OmrDecoder.sameStudentCode(candidate.code, normalizedStudent)
      ) ?? null;
  }

  return new GradedScan(
    result,
    key?.examCode ?? normalizedExam,
    key,
    usedBestGuessKey,
    student,
    photo,
    true,
    null,
    // R4: cảnh báo "Nhiều đáp án" — đếm câu có ≥2 ô đậm.
    OmrDecoder.countMultiMarkAnswers(photo.scan.answerBlocks, totalQuestions)
  );
}

export interface ScanAndGradeParams extends Omit<GradeScanParams, 'chosen' | 'studentCodeRaw' | 'examCodeRaw' | 'photo'> {
  image: RgbaScanImage;
  tuning?: OmrTuning;
  overlayRects?: Rect[] | null;
  overlayQuad?: AlignmentQuad | null;
  frameSize?: Size;
  knownQuad?: AlignmentQuad | null;
}

/**
 * Quét RGBA đã decode → chấm. Tương ứng `_scanAndGrade` bên Dart; khác biệt
 * duy nhất theo R19b: `requireVerifiedWarp: false` (verify chỉ còn quyền thử
 * biến thể hướng, không chặn kết quả).
 *
 * Trả null khi không dựng nổi khung phiếu (quad null) — UI gợi ý chụp lại.
 */
export function scanAndGrade({
  image,
  contest,
  keys,
  candidateStudents,
  tuning,
  overlayRects,
  overlayQuad,
  frameSize,
  knownQuad
}: ScanAndGradeParams): GradedScan | null {
  const photo = new OmrScanService().scanPhoto(image, {
    spec: contestSheetSpec(contest),
    tuning,
    overlayRects,
    overlayQuad,
    frameSize,
    knownQuad,
    skipVerification: false,
    // R19b — LUÔN BEST-EFFORT: verify không chặn kết quả.
    requireVerifiedWarp: false
  });
  if (photo == null) return null;
  return gradeScan({
    contest,
    keys,
    candidateStudents,
    chosen: photo.scan.answers,
    studentCodeRaw: photo.scan.studentCodeRaw,
    examCodeRaw: photo.scan.examCodeRaw,
    photo
  });
}
