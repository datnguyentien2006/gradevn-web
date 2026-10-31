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
  /** 4 ô ghim (tỉ lệ khung ảnh) — nơi kỳ vọng thấy 4 mốc góc. */
  rects: RectDto[];
  /** Trả kèm số liệu + mask từng ô (màn chẩn đoán). */
  diagnostics?: boolean;
  /** Hệ số ngưỡng p75 — mặc định 0.5 (Dart); chế độ dễ tính dùng 0.8. */
  thresholdFactor?: number;
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
  /** Tính quad/verify/homography cho chẩn đoán (không đổi cách chấm). */
  diagnostics?: boolean;
  /** Hệ số ngưỡng cho bước quét blob trong 4 ô ghim. */
  thresholdFactor?: number;
}

export type WorkerRequest = ProbeRequest | GradeRequest;

export interface SquareProbeDto {
  ok: boolean;
  fill: number;
  /** Cạnh blob tìm được (px khung quét), 0 khi không có. */
  side: number;
}

export interface RectPxDto {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BlobCandidateDto {
  bbox: RectPxDto;
  centroid: PointDto;
  side: number;
  fill: number;
  aspect: number;
  areaRatio: number;
  distance: number;
  touchesRegionEdge: boolean;
  accepted: boolean;
  reason: string | null;
}

export interface BlobMaskDto {
  data: ArrayBuffer;
  width: number;
  height: number;
}

export interface BlobDiagnosticsDto {
  region: RectPxDto;
  step: number;
  pageLevel: number;
  threshold: number;
  thresholdFactor: number;
  sampledPixels: number;
  darkPixels: number;
  componentCount: number;
  rejectionCounts: Record<string, number>;
  closest: BlobCandidateDto | null;
  mask: BlobMaskDto | null;
}

export interface RectProbeDetailDto extends SquareProbeDto {
  centroid: PointDto | null;
  guidePx: RectPxDto;
  scanPx: RectPxDto;
  reason: string;
  diagnostics: BlobDiagnosticsDto | null;
}

export interface ProbeResponse {
  type: 'probe-result';
  id: number;
  squares: SquareProbeDto[];
  details: RectProbeDetailDto[] | null;
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

export type QuadSourceDto = 'known' | 'overlayRects' | 'detector' | 'overlayQuad';

export interface GradeDiagnosticsDto {
  quadSource: QuadSourceDto;
  quad: QuadDto;
  pinnedQuad: QuadDto | null;
  detectorQuad: QuadDto | null;
  targetQuad: QuadDto;
  /** Kiểm chứng round-trip tính cho chẩn đoán (kể cả nhánh ghim). */
  alignmentCheck: VerificationDto | null;
  alignmentWarning: boolean;
  /** true khi quad ghim rớt kiểm chứng và đã thay bằng quad khác đạt. */
  rescuedQuad: boolean;
  homography: number[] | null;
  pageScale: number;
  src: { width: number; height: number; dataLength: number };
  warped: { width: number; height: number };
  verificationSkipped: boolean;
  thresholdFactor: number;
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
  diagnostics: GradeDiagnosticsDto | null;
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
