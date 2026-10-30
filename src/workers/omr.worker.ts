// Web Worker: phát hiện mốc live (probe) + quét/chấm ảnh đầy đủ (grade).
// Mọi phép toán ảnh nặng chạy ở đây; UI chỉ vẽ khung hình và gửi RGBA.
//
// Nguồn Dart: lib/data/cv/scan_flow.dart (_scanAndGrade trong isolate),
// lib/presentation/screens/scan_screen.dart (_analyzeMarkerFrameInIsolate).

import {
  AlignmentQuad,
  expandFractionRect,
  Offset,
  Rect,
  Size
} from '../core/geometry';
import { locateDarkBlobInRegion } from '../core/markerBlobScan';
import { scanAndGrade } from '../core/scanFlow';
import { OmrScanService } from '../core/scanService';
import type {
  GradeRequest,
  GradeResponse,
  GradeSuccessResponse,
  PointDto,
  ProbeRequest,
  ProbeResponse,
  QuadDto,
  RectDto,
  WorkerRequest,
  WorkerResponse
} from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'probe') {
    handleProbe(request);
    return;
  }
  if (request.type === 'grade') {
    handleGrade(request);
    return;
  }
};

function handleProbe(request: ProbeRequest): void {
  const started = now();
  try {
    const width = request.image.width;
    const height = request.image.height;
    const rgba = new Uint8ClampedArray(request.image.data);
    const grayAt = rgbaLuma(rgba, width, height);
    const frameSize = new Size(request.frameSize.width, request.frameSize.height);
    const rects = request.rects.map(toRect);

    // Quad chuẩn của pipeline: dùng đúng resolveOverlayRects mà lúc chấm
    // sẽ dùng, để trạng thái "đủ 4 mốc" khớp với khung nắn thật.
    const service = new OmrScanService();
    const quad = service.resolveOverlayRects(
      rgba,
      4,
      width,
      height,
      rects,
      frameSize
    );

    const squares = rects.map((rect) => {
      const expanded = expandFractionRect(rect, 1.5);
      const region = new Rect(
        expanded.left * width,
        expanded.top * height,
        expanded.right * width,
        expanded.bottom * height
      );
      const locate = locateDarkBlobInRegion({ width, height, region, grayAt });
      const ok =
        locate != null &&
        rect.contains(
          new Offset(locate.centroid.dx / width, locate.centroid.dy / height)
        ) &&
        locate.fill >= 0.04;
      return {
        ok,
        center: locate ? toPoint(locate.centroid) : null,
        fill: locate?.fill ?? 0
      };
    });

    const response: ProbeResponse = {
      type: 'probe-result',
      id: request.id,
      quad: quad ? toQuadDto(quad) : null,
      squares,
      candidates: squares.flatMap((s) => (s.ok && s.center ? [s.center] : [])),
      totalMs: now() - started
    };
    scope.postMessage(response);
  } catch (error) {
    postError(request.id, error);
  }
}

function handleGrade(request: GradeRequest): void {
  const started = now();
  try {
    const width = request.image.width;
    const height = request.image.height;
    const rgba = new Uint8ClampedArray(request.image.data);
    const graded = scanAndGrade({
      image: { data: rgba, width, height },
      contest: request.contest,
      keys: request.keys,
      candidateStudents: request.students,
      overlayRects: request.overlayRects ? request.overlayRects.map(toRect) : null,
      frameSize: request.frameSize
        ? new Size(request.frameSize.width, request.frameSize.height)
        : undefined
    });

    if (graded == null) {
      const nullResponse: GradeResponse = {
        type: 'grade-null',
        id: request.id,
        totalMs: now() - started
      };
      scope.postMessage(nullResponse);
      return;
    }

    const photo = graded.photo;
    const warped = copyGrayBuffer(photo.warpedGray);
    const response: GradeSuccessResponse = {
      type: 'grade-result',
      id: request.id,
      scan: {
        answers: [...photo.scan.answers],
        studentCodeRaw: photo.scan.studentCodeRaw,
        examCodeRaw: photo.scan.examCodeRaw,
        grids: {
          answerBlocks: photo.scan.answerBlocks.map((block) =>
            block.values.map((row) => [...row])
          ),
          studentCodeGrid: photo.scan.studentCodeGrid.values.map((row) => [...row]),
          examCodeGrid: photo.scan.examCodeGrid.values.map((row) => [...row])
        },
        processingTimeMs: photo.scan.processingTimeMs
      },
      quad: toQuadDto(photo.quad),
      candidates: (photo.detectedCandidates ?? []).map(toPoint),
      verification: photo.verification
        ? {
            offsets: [...photo.verification.offsets],
            tolerance: photo.verification.tolerance,
            passed: photo.verification.passed,
            maxOffset: photo.verification.maxOffset
          }
        : null,
      timing: photo.timing ? { ...photo.timing } : null,
      warped: {
        data: warped.buffer,
        width: photo.warpedWidth,
        height: photo.warpedHeight
      },
      result: {
        flags: [...graded.result.correctFlags],
        score: graded.result.score,
        partScores: { ...graded.result.partScores },
        correctCount: graded.result.correctCount,
        incorrectCount: graded.result.incorrectCount,
        unansweredCount: graded.result.unansweredCount
      },
      usedExamCode: graded.usedExamCode,
      usedKeyId: graded.usedKey?.id ?? null,
      usedKeyExamCode: graded.usedKey?.examCode ?? null,
      usedBestGuessKey: graded.usedBestGuessKey,
      studentId: graded.student?.id ?? null,
      graded: graded.graded,
      ungradedReason: graded.ungradedReason,
      multiAnswerCount: graded.multiAnswerCount,
      totalMs: now() - started
    };
    scope.postMessage(response, [warped.buffer]);
  } catch (error) {
    postError(request.id, error);
  }
}

function postError(id: number, error: unknown): void {
  scope.postMessage({
    type: 'error',
    id,
    message: error instanceof Error ? error.message : String(error)
  });
}

function copyGrayBuffer(gray: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  if (gray.byteOffset === 0 && gray.byteLength === gray.buffer.byteLength) {
    return new Uint8ClampedArray(gray.buffer as ArrayBuffer);
  }
  return new Uint8ClampedArray(gray);
}

function rgbaLuma(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): (x: number, y: number) => number {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 255;
    const idx = (y * width + x) * 4;
    if (idx + 2 >= rgba.length) return 255;
    return Math.trunc(
      (rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000
    );
  };
}

function toRect(rect: RectDto): Rect {
  return new Rect(rect.left, rect.top, rect.right, rect.bottom);
}

function toPoint(offset: Offset): PointDto {
  return { x: offset.dx, y: offset.dy };
}

function toQuadDto(quad: AlignmentQuad): QuadDto {
  return {
    tl: toPoint(quad.tl),
    tr: toPoint(quad.tr),
    br: toPoint(quad.br),
    bl: toPoint(quad.bl)
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
