// Ghép phát hiện/xác thực mốc + nắn phẳng + đo mật độ + giải mã.
// Nguồn Dart: lib/data/cv/scan_service.dart.
//
// Khác biệt web: core nhận RGBA đã decode (ImageData) thay vì bytes PNG;
// kết quả trả về mảng xám đã nắn (worker/Canvas sẽ encode PNG khi cần lưu).
// Mọi ngưỡng, tỉ lệ và thứ tự dự phòng giữ nguyên Dart.

import {
  AlignmentQuad,
  clamp,
  expandFractionRect,
  Offset,
  Rect,
  Size
} from './geometry';
import { DEFAULT_OMR_TUNING, measureGrayPlanar, measureRgba, OmrTuning, SheetDensities } from './density';
import { FALLBACK_THRESHOLD_FACTOR, locateDarkBlobInRegion } from './markerBlobScan';
import { DensityBlock, OmrDecoder } from './omrDecoder';
import { SheetLayout } from './sheetLayout';
import {
  PerspectiveWarper,
  SheetMarkerDetector,
  solveHomography,
  type WarpedGray
} from './sheetAlignment';
import type { SheetSpec } from './types';

/** Trang chuẩn của pipeline = toàn trang giấy (khung mốc + lề) 1576×2205. */
export const OMR_PAGE_SIZE = SheetLayout.standardPage;

export class SheetScan {
  constructor(
    public readonly answers: (string | null)[],
    public readonly studentCodeRaw: string,
    public readonly examCodeRaw: string,
    public readonly answerBlocks: DensityBlock[],
    public readonly studentCodeGrid: DensityBlock,
    public readonly examCodeGrid: DensityBlock,
    public readonly processingTimeMs: number
  ) {}

  get studentCode(): string {
    return OmrDecoder.normalizeStudentCode(this.studentCodeRaw);
  }

  get examCode(): string {
    return OmrDecoder.normalizeCode(this.examCodeRaw);
  }

  get examCodeEmpty(): boolean {
    return OmrDecoder.isBlankCode(this.examCodeRaw);
  }

  get studentCodeEmpty(): boolean {
    return OmrDecoder.isBlankCode(this.studentCodeRaw);
  }
}

export interface PhotoScanTiming {
  grayMs: number;
  overlayMs: number;
  warpMs: number;
  scanMs: number;
  pageScale: number;
  quadFromDetector: boolean;
}

export interface PhotoScan {
  scan: SheetScan;
  quad: AlignmentQuad;
  warpedGray: Uint8ClampedArray;
  warpedWidth: number;
  warpedHeight: number;
  detectedCandidates?: Offset[] | null;
  verification?: WarpedMarkerCheck | null;
  timing?: PhotoScanTiming;
  diagnostics?: PhotoScanDiagnostics | null;
}

export type QuadSource = 'known' | 'overlayRects' | 'detector' | 'overlayQuad';

export interface PhotoScanDiagnostics {
  quadSource: QuadSource;
  pinnedQuad: AlignmentQuad | null;
  /** Ngưỡng thực dùng cho quad ghim: 0.5 chuẩn, 0.8 dự phòng; null khi không có. */
  pinnedThresholdFactor: number | null;
  detectorQuad: AlignmentQuad | null;
  targetQuad: AlignmentQuad;
  /** Kiểm chứng tính cho chẩn đoán — kể cả quad ghim (Dart bỏ qua). */
  alignmentCheck: WarpedMarkerCheck | null;
  alignmentWarning: boolean;
  rescuedQuad: boolean;
  homography: number[] | null;
  pageScale: number;
  srcWidth: number;
  srcHeight: number;
  srcDataLength: number;
  warpedWidth: number;
  warpedHeight: number;
  verificationSkipped: boolean;
  thresholdFactor: number;
}

export const MARKER_VERIFICATION_TOLERANCE_PX = 6;

export class WarpedMarkerCheck {
  constructor(
    public readonly offsets: number[],
    public readonly tolerance = MARKER_VERIFICATION_TOLERANCE_PX
  ) {}

  get maxOffset(): number {
    return this.offsets.reduce((max, o) => (o > max ? o : max), 0);
  }

  get passed(): boolean {
    return this.offsets.length === 4 && this.offsets.every((o) => o <= this.tolerance);
  }
}

/** Kiểm chứng round-trip trên mảng xám đã nắn. */
export function verifyWarpedGrayPlanar(
  warpedGray: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  layout: SheetLayout,
  detector: SheetMarkerDetector = new SheetMarkerDetector(),
  tolerance = MARKER_VERIFICATION_TOLERANCE_PX
): WarpedMarkerCheck {
  const detection = detector.detectGray(warpedGray, width, height, layout.template);
  const offsets: number[] = [];
  for (const expected of layout.cornerMarkerCenters) {
    let best = Infinity;
    for (const c of detection.candidates) {
      const d = c.distanceTo(expected);
      if (d < best) best = d;
    }
    offsets.push(best);
  }
  return new WarpedMarkerCheck(offsets, tolerance);
}

export interface RgbaScanImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface OverlayRectResolution {
  quad: AlignmentQuad;
  /** 0.5 = ngưỡng chuẩn; 0.8 = quét lại dự phòng. */
  thresholdFactor: number;
}

export interface ScanPhotoOptions {
  spec: SheetSpec;
  tuning?: OmrTuning;
  overlayQuad?: AlignmentQuad | null;
  overlayRects?: Rect[] | null;
  frameSize?: Size;
  knownQuad?: AlignmentQuad | null;
  skipVerification?: boolean;
  overlayMinQuality?: number;
  requireVerifiedWarp?: boolean;
  /** Tính quad ghim/detector, verify và homography cho chẩn đoán. */
  diagnoseAlignment?: boolean;
  /** Hệ số ngưỡng quét blob trong ô ghim (Dart 0.5; dễ tính 0.8). */
  thresholdFactor?: number;
  /**
   * Ô ghim trượt ngưỡng chuẩn được quét lại một lần ở p75×0.8 (cùng mọi
   * luật), giống đường live. Mặc định bật cho ảnh chụp; tắt để so sánh
   * đúng hành vi Dart.
   */
  allowPinnedFallback?: boolean;
}

export class OmrScanService {
  constructor(
    public readonly decoder = new OmrDecoder(),
    public readonly detector = new SheetMarkerDetector(),
    public readonly warper = new PerspectiveWarper()
  ) {}

  /**
   * Quét một ảnh đã decode. Thứ tự dự phòng quad giống Dart:
   * knownQuad → overlayRects (rồi detector toàn ảnh) → detector (rồi overlayQuad).
   */
  scanPhoto(
    image: RgbaScanImage,
    options: ScanPhotoOptions
  ): PhotoScan | null {
    const tuning = options.tuning ?? DEFAULT_OMR_TUNING;
    const srcW = image.width;
    const srcH = image.height;
    const srcBytes = image.data;
    const srcCh = 4;
    const expectedBytes = srcW * srcH * srcCh;
    if (srcBytes.length !== expectedBytes) {
      throw new Error(
        `Kích thước pixel không khớp: ${srcBytes.length} byte, cần ${srcW}×${srcH}×4 = ${expectedBytes}.`
      );
    }
    const thresholdFactor = options.thresholdFactor ?? 0.5;

    let grayMs = 0;
    let grayCache: Uint8ClampedArray | null = null;
    const srcGray = (): Uint8ClampedArray => {
      if (grayCache) return grayCache;
      const sw = performance.now();
      const g = new Uint8ClampedArray(srcW * srcH);
      for (let i = 0; i < g.length; i++) g[i] = srcBytes[i * srcCh];
      grayMs = performance.now() - sw;
      return (grayCache = g);
    };

    const stdPage = SheetLayout.standardPage;
    const pageScale = Math.min(1, srcW / stdPage.width);
    const page =
      pageScale >= 0.999
        ? OMR_PAGE_SIZE
        : new Size(
            Math.round(stdPage.width * pageScale),
            Math.round(stdPage.height * pageScale)
          );
    const layout = SheetLayout.forSpec(options.spec, page);
    const targetQuad = new AlignmentQuad(
      layout.cornerMarkerCenters[0],
      layout.cornerMarkerCenters[1],
      layout.cornerMarkerCenters[2],
      layout.cornerMarkerCenters[3]
    );

    let overlayMs = 0;
    const swOverlay = performance.now();
    let quad: AlignmentQuad | null = null;
    let detectedCandidates: Offset[] | null = null;
    let quadFromDetector = false;
    let quadSource: QuadSource = 'detector';
    let pinnedQuad: AlignmentQuad | null = null;
    let pinnedThresholdFactor: number | null = null;
    let detectorQuad: AlignmentQuad | null = null;
    const allowPinnedFallback = options.allowPinnedFallback ?? true;

    if (options.knownQuad) {
      quad = options.knownQuad;
      quadSource = 'known';
    } else if (options.overlayRects) {
      const pinned = this.resolveOverlayRects(
        srcBytes,
        srcCh,
        srcW,
        srcH,
        options.overlayRects,
        options.frameSize ?? new Size(1, 1),
        null,
        thresholdFactor,
        allowPinnedFallback
      );
      pinnedQuad = pinned?.quad ?? null;
      pinnedThresholdFactor = pinned?.thresholdFactor ?? null;
      quad = pinnedQuad;
      if (pinnedQuad) {
        quadSource = 'overlayRects';
      } else {
        const detection = this.detector.detectGray(srcGray(), srcW, srcH);
        detectedCandidates = detection.candidates;
        detectorQuad = detection.quad;
        quad = detection.quad;
        quadFromDetector = quad !== null;
        quadSource = 'detector';
      }
    } else {
      const detection = this.detector.detectGray(srcGray(), srcW, srcH);
      detectedCandidates = detection.candidates;
      detectorQuad = detection.quad;
      quad = detection.quad;
      quadFromDetector = quad !== null;
      quadSource = 'detector';
      if (!quad && options.overlayQuad) {
        quad = this.resolveOverlayQuad(
          image,
          options.overlayQuad,
          options.frameSize ?? new Size(1, 1),
          layout,
          targetQuad,
          options.overlayMinQuality ?? 0.55
        );
        if (quad) quadSource = 'overlayQuad';
      }
    }
    overlayMs = performance.now() - swOverlay;
    if (!quad) return null;

    const swWarp = performance.now();
    const warpPage = (q: AlignmentQuad): WarpedGray =>
      this.warper.warpGrayPlanar({
        srcGray: srcBytes,
        srcWidth: srcW,
        srcHeight: srcH,
        srcChannels: srcCh,
        quad: q,
        targetQuad,
        outputSize: page
      });

    let warped = warpPage(quad);
    let verification: WarpedMarkerCheck | null = null;
    let alignmentCheck: WarpedMarkerCheck | null = null;
    let alignmentWarning = false;
    let rescuedQuad = false;
    let verificationSkipped = false;

    const verifyWarp = (w: WarpedGray): WarpedMarkerCheck =>
      verifyWarpedGrayPlanar(
        w.gray,
        w.width,
        w.height,
        layout,
        this.detector,
        MARKER_VERIFICATION_TOLERANCE_PX * pageScale
      );

    const collectAlts = (current: AlignmentQuad): { quad: AlignmentQuad; source: QuadSource }[] => {
      const alts: { quad: AlignmentQuad; source: QuadSource }[] = [];
      if (!quadFromDetector && options.overlayRects) {
        const det = this.detector.detectGray(srcGray(), srcW, srcH);
        detectedCandidates = det.candidates;
        if (det.quad) {
          detectorQuad = det.quad;
          alts.push({ quad: det.quad, source: 'detector' });
        }
        const altRects = this.resolveOverlayRects(
          srcBytes,
          srcCh,
          srcW,
          srcH,
          options.overlayRects,
          options.frameSize ?? new Size(1, 1),
          current,
          thresholdFactor,
          allowPinnedFallback
        );
        if (altRects) alts.push({ quad: altRects.quad, source: 'overlayRects' });
      } else if (quadFromDetector) {
        if (options.overlayRects) {
          const altRects = this.resolveOverlayRects(
            srcBytes,
            srcCh,
            srcW,
            srcH,
            options.overlayRects,
            options.frameSize ?? new Size(1, 1),
            current,
            thresholdFactor,
            allowPinnedFallback
          );
          if (altRects) alts.push({ quad: altRects.quad, source: 'overlayRects' });
        }
        if (options.overlayQuad) {
          const altQuad = this.resolveOverlayQuad(
            image,
            options.overlayQuad,
            options.frameSize ?? new Size(1, 1),
            layout,
            targetQuad,
            options.overlayMinQuality ?? 0.55
          );
          if (altQuad) alts.push({ quad: altQuad, source: 'overlayQuad' });
        }
      }
      return alts;
    };

    if (options.knownQuad) {
      verification = null;
    } else {
      const quadTrusted = !quadFromDetector && options.overlayRects != null;
      if ((options.skipVerification ?? false) || quadTrusted) {
        verification = null;
        verificationSkipped = true;
      } else {
        verification = verifyWarp(warped);
        if (!verification.passed) {
          for (const alt of collectAlts(quad)) {
            if (quadEqual(alt.quad, quad)) continue;
            const altPage = warpPage(alt.quad);
            const altVerification = verifyWarp(altPage);
            if (altVerification.passed) {
              quad = alt.quad;
              warped = altPage;
              verification = altVerification;
              quadSource = alt.source;
              break;
            }
          }
        }
        if (verification && !verification.passed && (options.requireVerifiedWarp ?? true)) {
          return null;
        }
      }
    }

    // Chẩn đoán căn chỉnh: luôn kiểm chứng round-trip (kể cả quad GHIM — Dart
    // R17 bỏ qua bước này). Không đổi kết quả chấm; nếu quad ghim rớt, thử
    // detector + biến thể hướng còn lại và chỉ nhận quad đạt kiểm chứng.
    if (options.diagnoseAlignment) {
      alignmentCheck = verification ?? verifyWarp(warped);
      if (!options.knownQuad && verificationSkipped && alignmentCheck && !alignmentCheck.passed) {
        for (const alt of collectAlts(quad)) {
          if (quadEqual(alt.quad, quad)) continue;
          const altPage = warpPage(alt.quad);
          const altCheck = verifyWarp(altPage);
          if (altCheck.passed) {
            quad = alt.quad;
            warped = altPage;
            verification = altCheck;
            alignmentCheck = altCheck;
            quadSource = alt.source;
            rescuedQuad = true;
            break;
          }
        }
      }
      alignmentWarning = alignmentCheck != null && !alignmentCheck.passed;
    }

    const warpMs = performance.now() - swWarp;
    const swScan = performance.now();
    const scan = this.scanGrayPlanar(
      warped.gray,
      warped.width,
      warped.height,
      layout,
      options.spec,
      tuning
    );
    const scanMs = performance.now() - swScan;

    let homography: number[] | null = null;
    if (options.diagnoseAlignment) {
      try {
        homography = [...solveHomography(targetQuad.corners, quad.corners)];
      } catch {
        homography = null;
      }
    }
    const diagnostics: PhotoScanDiagnostics | null = options.diagnoseAlignment
      ? {
          quadSource,
          pinnedQuad,
          pinnedThresholdFactor,
          detectorQuad,
          targetQuad,
          alignmentCheck,
          alignmentWarning,
          rescuedQuad,
          homography,
          pageScale,
          srcWidth: srcW,
          srcHeight: srcH,
          srcDataLength: srcBytes.length,
          warpedWidth: warped.width,
          warpedHeight: warped.height,
          verificationSkipped,
          thresholdFactor
        }
      : null;

    return {
      scan,
      quad,
      warpedGray: warped.gray,
      warpedWidth: warped.width,
      warpedHeight: warped.height,
      detectedCandidates,
      verification,
      diagnostics,
      timing: {
        grayMs,
        overlayMs,
        warpMs,
        scanMs,
        pageScale,
        quadFromDetector
      }
    };
  }

  /** Phân định hướng ảnh và trả quad theo hệ pixel ảnh từ quad ghim preview. */
  resolveOverlayQuad(
    image: RgbaScanImage,
    overlayQuad: AlignmentQuad,
    frameSize: Size,
    layout: SheetLayout,
    targetQuad: AlignmentQuad,
    minQuality = 0.55
  ): AlignmentQuad | null {
    const fw = frameSize.width;
    const fh = frameSize.height;
    if (fw <= 0 || fh <= 0) return null;
    const size = new Size(image.width, image.height);
    const fraction = (p: Offset): Offset => new Offset(p.dx / fw, p.dy / fh);
    const points = [
      fraction(overlayQuad.tl),
      fraction(overlayQuad.tr),
      fraction(overlayQuad.br),
      fraction(overlayQuad.bl)
    ];
    const mapTo = (map: (f: Offset) => Offset): Offset[] => points.map(map);

    const variants: Offset[][] = [];
    const imagePortrait = size.height >= size.width;
    const framePortrait = fh >= fw;
    if (imagePortrait === framePortrait) {
      variants.push(mapTo((f) => new Offset(f.dx * size.width, f.dy * size.height)));
      variants.push(
        mapTo((f) => new Offset((1 - f.dx) * size.width, (1 - f.dy) * size.height))
      );
    } else {
      variants.push(
        mapTo((f) => new Offset(f.dy * size.width, (1 - f.dx) * size.height))
      );
      variants.push(
        mapTo((f) => new Offset((1 - f.dy) * size.width, f.dx * size.height))
      );
    }

    let best: AlignmentQuad | null = null;
    let bestScore = -1;
    const sf = 320 / layout.page.width;
    const shr = 450 / layout.page.height;
    const scalePoint = (p: Offset): Offset => new Offset(p.dx * sf, p.dy * shr);
    const targetMini = new AlignmentQuad(
      scalePoint(targetQuad.tl),
      scalePoint(targetQuad.tr),
      scalePoint(targetQuad.br),
      scalePoint(targetQuad.bl)
    );

    for (const v of variants) {
      const quad = new AlignmentQuad(v[0], v[1], v[2], v[3]);
      if (!plausibleQuad(quad)) continue;
      const mini = this.warper.warpGrayPlanar({
        srcGray: image.data,
        srcWidth: image.width,
        srcHeight: image.height,
        srcChannels: 4,
        quad,
        targetQuad: targetMini,
        outputSize: new Size(320, 450)
      });
      const score = markerQuality(mini, layout, mini.width / layout.page.width);
      if (score > bestScore) {
        bestScore = score;
        best = quad;
      }
    }
    if (!best || bestScore < minQuality) return null;
    return best;
  }

  /**
   * Quét 4 ô ghim trên preview để lấy tâm blob đen trong từng ô.
   *
   * [allowThresholdFallback] — khác Dart: nếu TOÀN BỘ 4 ô trượt ngưỡng chuẩn
   * p75×[thresholdFactor] thì quét lại cả nhóm ở p75×0.8 trước khi bỏ cuộc.
   * Mốc in mờ (màn hình/giấy thiếu sáng) mà đường live đã nhận bằng 0.8 sẽ
   * không còn rơi xuống detector toàn ảnh — nguyên nhân hai góc dưới bị thay
   * bằng vật tối ngoài tờ giấy.
   */
  resolveOverlayRects(
    bytes: Uint8Array | Uint8ClampedArray,
    channels: number,
    imageWidth: number,
    imageHeight: number,
    overlayRects: Rect[],
    frameSize: Size,
    exclude: AlignmentQuad | null = null,
    thresholdFactor = 0.5,
    allowThresholdFallback = false
  ): OverlayRectResolution | null {
    if (overlayRects.length < 4) return null;
    const size = new Size(imageWidth, imageHeight);
    const fw = frameSize.width;
    const fh = frameSize.height;
    if (fw <= 0 || fh <= 0) return null;

    const sameAxis = (imageHeight >= imageWidth) === (fh >= fw);
    type Variant = { fwd: (p: Offset) => Offset; inv: (p: Offset) => Offset };
    const variants: Variant[] = sameAxis
      ? [
          { fwd: (f) => f, inv: (f) => f },
          {
            fwd: (f) => new Offset(1 - f.dx, 1 - f.dy),
            inv: (f) => new Offset(1 - f.dx, 1 - f.dy)
          }
        ]
      : [
          {
            fwd: (f) => new Offset(f.dy, 1 - f.dx),
            inv: (f) => new Offset(1 - f.dy, f.dx)
          },
          {
            fwd: (f) => new Offset(1 - f.dy, f.dx),
            inv: (f) => new Offset(f.dy, 1 - f.dx)
          }
        ];

    const factors =
      allowThresholdFallback && thresholdFactor < FALLBACK_THRESHOLD_FACTOR
        ? [thresholdFactor, FALLBACK_THRESHOLD_FACTOR]
        : [thresholdFactor];

    for (const factor of factors) {
      let best: AlignmentQuad | null = null;
      let bestScore = -1;
      for (const { fwd, inv } of variants) {
        const locates: { centroid: Offset; fill: number; side: number }[] = [];
        let worstFill = Infinity;
        let ok = true;
        for (const rect of overlayRects.slice(0, 4)) {
          const expanded = expandFractionRect(rect, 1.5);
          const c0 = fwd(expanded.topLeft);
          const c1 = fwd(expanded.bottomRight);
          const region = new Rect(
            Math.min(c0.dx, c1.dx) * size.width,
            Math.min(c0.dy, c1.dy) * size.height,
            Math.max(c0.dx, c1.dx) * size.width,
            Math.max(c0.dy, c1.dy) * size.height
          );
          const locate = locateDarkBlobInRect(
            bytes,
            channels,
            imageWidth,
            imageHeight,
            region,
            factor
          );
          if (!locate) {
            ok = false;
            break;
          }
          const cFrac = inv(
            new Offset(locate.centroid.dx / size.width, locate.centroid.dy / size.height)
          );
          if (!rect.contains(cFrac)) {
            ok = false;
            break;
          }
          locates.push(locate);
          worstFill = Math.min(worstFill, locate.fill);
        }
        if (!ok || worstFill < 0.04) continue;
        const sides = locates.map((l) => l.side);
        const sMin = Math.min(...sides);
        const sMax = Math.max(...sides);
        if (sMin <= 0 || sMax / sMin > 2.4) continue;
        const quad = new AlignmentQuad(
          locates[0].centroid,
          locates[1].centroid,
          locates[2].centroid,
          locates[3].centroid
        );
        if (!plausibleQuad(quad)) continue;
        if (exclude && quadNearlyEqual(quad, exclude)) continue;
        if (worstFill > bestScore) {
          bestScore = worstFill;
          best = quad;
        }
      }
      if (best) return { quad: best, thresholdFactor: factor };
    }
    return null;
  }

  scan(
    image: RgbaScanImage,
    layout: SheetLayout,
    spec?: SheetSpec,
    tuning: OmrTuning = DEFAULT_OMR_TUNING
  ): SheetScan {
    const sw = performance.now();
    const densities = measureRgba(image.data, image.width, image.height, layout, tuning);
    const scan = this.decodeDensities(densities, layout, spec);
    return new SheetScan(
      scan.answers,
      scan.studentCodeRaw,
      scan.examCodeRaw,
      scan.answerBlocks,
      scan.studentCodeGrid,
      scan.examCodeGrid,
      performance.now() - sw
    );
  }

  scanGrayPlanar(
    gray: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    layout: SheetLayout,
    spec?: SheetSpec,
    tuning: OmrTuning = DEFAULT_OMR_TUNING
  ): SheetScan {
    const sw = performance.now();
    const densities = measureGrayPlanar({ data: gray, width, height }, layout, tuning);
    const scan = this.decodeDensities(densities, layout, spec);
    return new SheetScan(
      scan.answers,
      scan.studentCodeRaw,
      scan.examCodeRaw,
      scan.answerBlocks,
      scan.studentCodeGrid,
      scan.examCodeGrid,
      performance.now() - sw
    );
  }

  private decodeDensities(
    densities: SheetDensities,
    layout: SheetLayout,
    spec?: SheetSpec
  ): {
    answers: (string | null)[];
    studentCodeRaw: string;
    examCodeRaw: string;
    answerBlocks: DensityBlock[];
    studentCodeGrid: DensityBlock;
    examCodeGrid: DensityBlock;
  } {
    const answers = this.decoder.decodeAnswers(
      densities.answerBlocks,
      spec ?? layout.specOrDefault,
      layout.totalQuestions,
      layout.rowsPerAnswerBlock
    );
    return {
      answers,
      studentCodeRaw: this.decoder.decodeDigits(densities.studentCodeGrid),
      examCodeRaw: this.decoder.decodeDigits(densities.examCodeGrid),
      answerBlocks: densities.answerBlocks,
      studentCodeGrid: densities.studentCodeGrid,
      examCodeGrid: densities.examCodeGrid
    };
  }
}

function locateDarkBlobInRect(
  bytes: Uint8Array | Uint8ClampedArray,
  channels: number,
  imageWidth: number,
  imageHeight: number,
  region: Rect,
  thresholdFactor = 0.5
) {
  const w = imageWidth;
  const h = imageHeight;
  const grayAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 255;
    const idx = (y * w + x) * channels;
    if (idx >= bytes.length) return 255;
    const r = bytes[idx];
    if (channels < 3 || idx + 2 >= bytes.length) return r;
    return Math.trunc((r * 299 + bytes[idx + 1] * 587 + bytes[idx + 2] * 114) / 1000);
  };
  return locateDarkBlobInRegion({
    width: w,
    height: h,
    region,
    grayAt,
    thresholdFactor
  });
}

function plausibleQuad(quad: AlignmentQuad): boolean {
  const xs = [quad.tl.dx, quad.tr.dx, quad.br.dx, quad.bl.dx];
  const ys = [quad.tl.dy, quad.tr.dy, quad.br.dy, quad.bl.dy];
  return Math.max(...xs) - Math.min(...xs) > 1 && Math.max(...ys) - Math.min(...ys) > 1;
}

function quadNearlyEqual(a: AlignmentQuad, b: AlignmentQuad): boolean {
  const pa = a.corners;
  const pb = b.corners;
  for (let i = 0; i < 4; i++) {
    if (pa[i].distanceTo(pb[i]) > 2) return false;
  }
  return true;
}

function quadEqual(a: AlignmentQuad, b: AlignmentQuad): boolean {
  return quadNearlyEqual(a, b);
}

function markerQuality(warped: WarpedGray, layout: SheetLayout, scale: number): number {
  const template = layout.template;
  const centers: Offset[] = [
    ...layout.cornerMarkerCenters,
    ...template.extraMarkers.map((m) => layout.toPage(m.dx, m.dy))
  ];
  const r = clamp(Math.trunc((template.markerSide * layout.scale * scale) / 2), 1, 12);
  const rOuter = r * 1.9;
  const rOuterInt = Math.trunc(rOuter);
  let coreDark = 0;
  let ringWhite = 0;
  let ringCount = 0;
  for (const c of centers) {
    const cx = Math.trunc(c.dx * scale);
    const cy = Math.trunc(c.dy * scale);
    for (let dy = -rOuterInt; dy <= rOuterInt; dy++) {
      for (let dx = -rOuterInt; dx <= rOuterInt; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        const x = clamp(cx + dx, 0, warped.width - 1);
        const y = clamp(cy + dy, 0, warped.height - 1);
        const v = warped.gray[y * warped.width + x];
        if (d <= r && v < 110) coreDark++;
        if (d >= r && d <= rOuter) {
          if (v > 190) ringWhite++;
          ringCount++;
        }
      }
    }
  }
  if (ringCount === 0) return 0;
  const coreCount = centers.length * (2 * Math.trunc(r) + 1) * (2 * Math.trunc(r) + 1);
  return 0.5 * (coreDark / coreCount) + 0.5 * (ringWhite / ringCount);
}
