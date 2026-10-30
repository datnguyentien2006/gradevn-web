// Giao thức giữa UI và Web Worker xử lý ảnh.
// Toàn bộ DTO ở đây là dữ liệu thuần (structured clone) — ảnh truyền bằng
// ArrayBuffer + transfer để không copy.

import type { AnswerKey, Contest, Student } from '../core/types';

export interface PointDto {
  x: number;
  y: number;
}

export interface QuadDto {
  tl: PointDto;
  tr: PointDto;
  br: PointDto;
  bl: PointDto;
}

/** Hình chữ nhật theo tỉ lệ 0..1 của khung ảnh (giống Dart Rect chuẩn hoá). */
export interface RectDto {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ImageBufferDto {
  data: ArrayBuffer;
  width: number;
  height: number;
}

export interface FrameSizeDto {
  width: number;
  height: number;
}

export interface ProbeRequest {
  type: 'probe';
  id: number;
  image: ImageBufferDto;
  /** 4 ô ghim (tỉ lệ khung) — nơi kỳ vọng thấy 4 mốc góc. */
  rects: RectDto[];
  frameSize: FrameSizeDto;
}

export interface GradeRequest {
  type: 'grade';
  id: number;
  image: ImageBufferDto;
  contest: Contest;
  keys: AnswerKey[];
  students: Student[];
  overlayRects: RectDto[] | null;
  frameSize: FrameSizeDto | null;
}

export type WorkerRequest = ProbeRequest | GradeRequest;

export interface SquareProbeDto {
  ok: boolean;
  center: PointDto | null;
  fill: number;
}

export interface ProbeResponse {
  type: 'probe-result';
  id: number;
  quad: QuadDto | null;
  squares: SquareProbeDto[];
  candidates: PointDto[];
  totalMs: number;
}

export interface DensityGridsDto {
  answerBlocks: number[][][];
  studentCodeGrid: number[][];
  examCodeGrid: number[][];
}

export interface ScanDto {
  answers: (string | null)[];
  studentCodeRaw: string;
  examCodeRaw: string;
  grids: DensityGridsDto;
  processingTimeMs: number;
}

export interface VerificationDto {
  offsets: number[];
  tolerance: number;
  passed: boolean;
  maxOffset: number;
}

export interface TimingDto {
  grayMs: number;
  overlayMs: number;
  warpMs: number;
  scanMs: number;
  pageScale: number;
  quadFromDetector: boolean;
}

export interface WarpedDto {
  data: ArrayBuffer;
  width: number;
  height: number;
}

export interface GradeResultDto {
  flags: (boolean | null)[];
  score: number;
  partScores: Record<string, number>;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
}

export interface GradeSuccessResponse {
  type: 'grade-result';
  id: number;
  scan: ScanDto;
  quad: QuadDto;
  candidates: PointDto[];
  verification: VerificationDto | null;
  timing: TimingDto | null;
  warped: WarpedDto;
  result: GradeResultDto;
  usedExamCode: string;
  usedKeyId: number | null;
  usedKeyExamCode: string | null;
  usedBestGuessKey: boolean;
  studentId: number | null;
  graded: boolean;
  ungradedReason: string | null;
  multiAnswerCount: number;
  totalMs: number;
}

export interface GradeNullResponse {
  type: 'grade-null';
  id: number;
  totalMs: number;
}

export interface WorkerErrorResponse {
  type: 'error';
  id: number;
  message: string;
}

export type GradeResponse = GradeSuccessResponse | GradeNullResponse;
export type WorkerResponse = ProbeResponse | GradeResponse | WorkerErrorResponse;
