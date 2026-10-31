// Web Worker: phát hiện mốc live (probe) + quét/chấm ảnh đầy đủ (grade).
// Mọi phép toán ảnh nặng chạy ở đây; UI chỉ vẽ khung hình và gửi RGBA.
//
// Nguồn Dart: lib/data/cv/scan_flow.dart (_scanAndGrade trong isolate),
// lib/presentation/screens/scan_screen.dart (_analyzeMarkerFrameInIsolate).

import { AlignmentQuad, Offset, Rect, Size } from '../core/geometry';
import {
  scanLiveMarkerBoxesDetailed,
  type LiveMarkerBoxDetail
} from '../camera/liveMarkerScan';
import type { BlobScanDiagnostics } from '../core/markerBlobScan';
import { scanAndGrade } from '../core/scanFlow';
import { LIGHT_INK_TUNING } from '../core/density';
import type {
  BlobCandidateDto,
  BlobDiagnosticsDto,
  GradeRequest,
  GradeResponse,
  GradeSuccessResponse,
  ImageBufferDto,
  PointDto,
  ProbeRequest,
  ProbeResponse,
  QuadDto,
  RectDto,
  RectProbeDetailDto,
  RectPxDto,
  VerificationDto,
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
    assertImageBuffer(request.image);
    const rgba = new Uint8ClampedArray(request.image.data);
    const grayAt = rgbaLuma(rgba, width, height);
    const rects = request.rects.map(toRect);
    const includeDiagnostics = request.diagnostics === true;

    // Đèn xanh từng ô = đúng phép quét đường chụp (port R8/R9/R11 của
    // scan_screen.dart), KHÔNG dùng detector toàn trang.
    const detailed = scanLiveMarkerBoxesDetailed(
      { width, height, grayAt },
      rects,
      {
        thresholdFactor: request.thresholdFactor ?? 0.5,
        allowFallback: true,
        includeDiagnostics
      }
    );
    const transfer: Transferable[] = [];
    const details = includeDiagnostics
      ? detailed.map((detail) => {
          const dto = toRectProbeDetailDto(detail);
          if (dto.diagnostics?.mask) transfer.push(dto.diagnostics.mask.data);
          return dto;
        })
      : null;
    const response: ProbeResponse = {
      type: 'probe-result',
      id: request.id,
      squares: detailed.map((detail) => ({
        ok: detail.box.ok,
        fill: detail.box.fill,
        side: detail.box.side
      })),
      details,
      totalMs: now() - started
    };
    scope.postMessage(response, transfer);
  } catch (error) {
    postError(request.id, error);
  }
}

function handleGrade(request: GradeRequest): void {
  const started = now();
  try {
    const width = request.image.width;
    const height = request.image.height;
    assertImageBuffer(request.image);
    const rgba = new Uint8ClampedArray(request.image.data);
    const graded = scanAndGrade({
      image: { data: rgba, width, height },
      contest: request.contest,
      keys: request.keys,
      candidateStudents: request.students,
      overlayRects: request.overlayRects ? request.overlayRects.map(toRect) : null,
      frameSize: request.frameSize
        ? new Size(request.frameSize.width, request.frameSize.height)
        : undefined,
      diagnoseAlignment: request.diagnostics === true,
      thresholdFactor: request.thresholdFactor ?? 0.5,
      tuning: request.lightInk === true ? LIGHT_INK_TUNING : undefined
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
      verification: photo.verification ? toVerificationDto(photo.verification) : null,
      diagnostics: photo.diagnostics
        ? {
            quadSource: photo.diagnostics.quadSource,
            quad: toQuadDto(photo.quad),
            pinnedQuad: photo.diagnostics.pinnedQuad
              ? toQuadDto(photo.diagnostics.pinnedQuad)
              : null,
            pinnedThresholdFactor: photo.diagnostics.pinnedThresholdFactor,
            detectorQuad: photo.diagnostics.detectorQuad
              ? toQuadDto(photo.diagnostics.detectorQuad)
              : null,
            targetQuad: toQuadDto(photo.diagnostics.targetQuad),
            alignmentCheck: photo.diagnostics.alignmentCheck
              ? toVerificationDto(photo.diagnostics.alignmentCheck)
              : null,
            alignmentWarning: photo.diagnostics.alignmentWarning,
            rescuedQuad: photo.diagnostics.rescuedQuad,
            homography: photo.diagnostics.homography,
            pageScale: photo.diagnostics.pageScale,
            src: {
              width: photo.diagnostics.srcWidth,
              height: photo.diagnostics.srcHeight,
              dataLength: photo.diagnostics.srcDataLength
            },
            warped: {
              width: photo.diagnostics.warpedWidth,
              height: photo.diagnostics.warpedHeight
            },
            verificationSkipped: photo.diagnostics.verificationSkipped,
            thresholdFactor: photo.diagnostics.thresholdFactor
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
      lightInk: request.lightInk === true,
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

function toVerificationDto(check: {
  offsets: number[];
  tolerance: number;
  passed: boolean;
  maxOffset: number;
}): VerificationDto {
  return {
    offsets: [...check.offsets],
    tolerance: check.tolerance,
    passed: check.passed,
    maxOffset: check.maxOffset
  };
}

function toRectPxDto(rect: Rect): RectPxDto {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function toBlobDiagnosticsDto(diagnostics: BlobScanDiagnostics): BlobDiagnosticsDto {
  let closest: BlobCandidateDto | null = null;
  if (diagnostics.closest) {
    const c = diagnostics.closest;
    closest = {
      bbox: c.bbox,
      centroid: toPoint(c.centroid),
      side: c.side,
      fill: c.fill,
      aspect: c.aspect,
      areaRatio: c.areaRatio,
      distance: c.distance,
      touchesRegionEdge: c.touchesRegionEdge,
      accepted: c.accepted,
      reason: c.reason
    };
  }
  return {
    region: diagnostics.region,
    step: diagnostics.step,
    pageLevel: diagnostics.pageLevel,
    threshold: diagnostics.threshold,
    thresholdFactor: diagnostics.thresholdFactor,
    sampledPixels: diagnostics.sampledPixels,
    darkPixels: diagnostics.darkPixels,
    componentCount: diagnostics.componentCount,
    rejectionCounts: { ...diagnostics.rejectionCounts },
    closest,
    mask: diagnostics.mask
      ? {
          data: diagnostics.mask.data.buffer as ArrayBuffer,
          width: diagnostics.mask.width,
          height: diagnostics.mask.height
        }
      : null
  };
}

function toRectProbeDetailDto(detail: LiveMarkerBoxDetail): RectProbeDetailDto {
  return {
    ok: detail.box.ok,
    fill: detail.box.fill,
    side: detail.box.side,
    centroid: detail.box.centroid ? toPoint(detail.box.centroid) : null,
    guidePx: toRectPxDto(detail.guidePx),
    scanPx: toRectPxDto(detail.scanPx),
    reason: detail.reason,
    diagnostics: detail.diagnostics
      ? toBlobDiagnosticsDto(detail.diagnostics)
      : null,
    thresholdFactor: detail.thresholdFactor,
    usedFallback: detail.usedFallback,
    strictReason: detail.strictReason
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function assertImageBuffer(image: ImageBufferDto): void {
  const expected = image.width * image.height * 4;
  if (image.data.byteLength !== expected) {
    throw new Error(
      `Khung ảnh hỏng: ${image.width}×${image.height} cần ${expected} byte RGBA nhưng nhận ${image.data.byteLength} byte.`
    );
  }
}
