<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type {
    DensityGridsDto,
    GradeDiagnosticsDto,
    GradeSuccessResponse,
    QuadDto,
    RectDto,
    RectProbeDetailDto
  } from '../workers/protocol';
  import { omrWorker } from '../workers/omrClient';
  import { OmrDecoder } from '../core/omrDecoder';
  import type { AnswerKey, Contest, Student } from '../core/types';
  import {
    getContest,
    listAnswerKeys,
    listGradedSheets,
    listStudents,
    saveGradedSheet
  } from '../storage/repositories';
  import {
    describeTrack,
    openCameraStream,
    stopCameraStream,
    WakeLockKeeper,
    type TrackDescription
  } from './camera';
  import {
    captureVideoFrame,
    cloneImage,
    decodeImageFile,
    downscaleImage,
    PROBE_MAX_WIDTH,
    type DecodedImage
  } from './imageInput';
  import {
    coverMapping,
    guideGeometry,
    overlayRectsForFrame,
    type Area
  } from './overlayGeometry';
  import {
    jsonBlob,
    rgbaToPng,
    shareDiagnosticFiles,
    timestampSlug,
    type DiagnosticFile
  } from './diagnostics';
  import {
    buildPracticeSession,
    loadPracticeSettings,
    normalizeAnswerSequence,
    normalizeExamCode,
    savePracticeSettings,
    SAMPLE_ANSWERS,
    SAMPLE_EXAM_CODE,
    type PracticeSettings
  } from './practice';
  import {
    buildThresholdPreview,
    type ThresholdPreview
  } from './thresholdPreview';
  import {
    drawCapturedDebug,
    drawFrame,
    drawLiveOverlay,
    drawThresholdPreview,
    drawWarpedScan,
    renderMarkedSheetPng,
    warpedPngBlob
  } from './render';
  import { playTone, unlockAudio } from './feedback';
  import { voteBest } from './vote';

  type Mode = 'live' | 'grading' | 'result';

  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
  const LIVE_CAPTURE_MAX_WIDTH = 1600;
  const FILE_MAX_WIDTH = 2000;
  const CAPTURE_FRAMES = 3;
  const AUTO_CAPTURE_STREAK = 2;
  const PROBE_INTERVAL_MS = 80;
  const TOLERANT_KEY = 'gradevn.scan.tolerant.v1';
  /** p75 × hệ số này thay cho ×0.5 của Dart khi bật chế độ iOS dễ tính. */
  const TOLERANT_THRESHOLD_FACTOR = 0.8;

  interface LiveTickSummary {
    at: string;
    ms: number;
    frame: string;
    readyState: number;
    currentTime: number;
    lights: string;
    reasons: string[];
  }

  interface FrameDiagnosticInfo {
    readyState: number;
    currentTime: number;
    videoWidth: number;
    videoHeight: number;
    displayWidth: number;
    displayHeight: number;
    dpr: number;
    orientation: string;
  }

  interface CaptureFrameInfo {
    width: number;
    height: number;
    byteLength: number;
    readyState: number;
    currentTime: number;
  }

  interface CaptureContext {
    trigger: 'auto' | 'manual';
    startedAt: string;
    videoWidth: number;
    videoHeight: number;
    areaWidth: number;
    areaHeight: number;
    mappingScale: number;
    mappingOffsetX: number;
    mappingOffsetY: number;
    guideCenters: { x: number; y: number }[];
    overlayRects: (RectDto & { centerX: number; centerY: number })[];
    frames: CaptureFrameInfo[];
    thresholdFactor: number;
  }

  interface CaptureDiagnosticBundle {
    context: CaptureContext;
    frameDiagnostics: (GradeDiagnosticsDto | null)[];
    chosenIndex: number;
  }

  let { contestId = null }: { contestId?: number | null } = $props();

  let mode = $state<Mode>('live');
  let stream = $state<MediaStream | null>(null);
  let starting = $state(false);
  let cameraError = $state<string | null>(null);
  let scanError = $state<string | null>(null);
  let statusOverride = $state<string | null>(null);

  let area = $state<Area>(readArea());
  let guide = $derived(guideGeometry(area));
  let settings = $state<PracticeSettings>(loadPracticeSettings());
  let session = $derived(buildPracticeSession(settings));

  let realContest = $state.raw<Contest | null>(null);
  let realKeys = $state.raw<AnswerKey[]>([]);
  let roster = $state.raw<Student[]>([]);
  // Router remounts this screen when the route changes, so the initial mode is fixed at mount.
  // svelte-ignore state_referenced_locally
  let loadState = $state<'practice' | 'loading' | 'ready' | 'missing'>(
    contestId == null ? 'practice' : 'loading'
  );
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let duplicateWarning = $state(false);

  let activeContest = $derived(realContest ?? session.contest);
  let activeKeys = $derived(realContest ? realKeys : session.keys);
  let isReal = $derived(realContest != null);
  let ready = $derived(loadState === 'practice' || loadState === 'ready');

  let lights = $state<boolean[]>([false, false, false, false]);
  let greenStreak = $state(0);
  let probeMs = $state(0);
  let probeCount = $state(0);
  let probeError = $state<string | null>(null);
  let probeStatus = $state<'idle' | 'alive' | 'error'>('idle');
  let liveDetails = $state.raw<RectProbeDetailDto[]>([]);
  let liveTicks = $state.raw<LiveTickSummary[]>([]);
  let liveTicksPerSec = $state(0);
  let frameInfo = $state.raw<FrameDiagnosticInfo | null>(null);
  let tolerantMode = $state(loadTolerantMode());
  let diagExporting = $state(false);
  let trackInfo = $state<TrackDescription | null>(null);

  let result = $state.raw<GradeSuccessResponse | null>(null);
  let matchedStudent = $derived(
    roster.find((student) => student.id === result?.studentId) ?? null
  );
  let agreement = $state(0);
  let framesGraded = $state(0);
  let framesCaptured = $state(0);
  let debugFrame = $state.raw<DecodedImage | null>(null);
  let debugThreshold = $state.raw<ThresholdPreview | null>(null);
  let capturedRects = $state.raw<RectDto[]>([]);
  let rawCapture = $state.raw<DecodedImage | null>(null);
  let captureDiagnostics = $state.raw<CaptureDiagnosticBundle | null>(null);
  let showPinCenters = $state(true);
  let rectCanvases = $state<HTMLCanvasElement[]>([]);
  let lastTickTimes: number[] = [];

  let showSettings = $state(false);
  let showDebugPanel = $state(false);
  let toast = $state<string | null>(null);

  let video = $state<HTMLVideoElement | null>(null);
  let overlayCanvas = $state<HTMLCanvasElement | null>(null);
  let freezeCanvas = $state<HTMLCanvasElement | null>(null);
  let warpedCanvas = $state<HTMLCanvasElement | null>(null);
  let capturedCanvas = $state<HTMLCanvasElement | null>(null);
  let thresholdCanvas = $state<HTMLCanvasElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  let wanted = false;
  let busy = false;
  let probeBusy = false;
  let probeTimer: number | null = null;
  let toastTimer: number | null = null;
  let autoArmed = true;
  const wakeKeeper = new WakeLockKeeper();

  let allGreen = $derived(lights.length === 4 && lights.every(Boolean));
  let litCount = $derived(lights.filter(Boolean).length);

  let statusText = $derived.by(() => {
    if (mode === 'grading') return statusOverride ?? 'Đang xử lý…';
    if (starting) return 'Đang mở camera…';
    if (cameraError) return 'Camera không khả dụng';
    if (!stream) return 'Camera đang tắt';
    if (allGreen) {
      return greenStreak >= AUTO_CAPTURE_STREAK
        ? 'Giữ yên — sẵn sàng chụp'
        : 'Đủ 4 mốc — giữ yên';
    }
    return `${litCount}/4 mốc`;
  });

  let trackText = $derived(
    trackInfo
      ? `${trackInfo.width}×${trackInfo.height} @ ${
          trackInfo.frameRate ? Math.round(trackInfo.frameRate) : '?'
        } fps · ${trackInfo.label}`
      : '—'
  );

  let keyLetters = $derived.by(() => {
    const graded = result;
    if (!graded) return '';
    const key =
      activeKeys.find((candidate) => candidate.id === graded.usedKeyId) ??
      activeKeys.find((candidate) => candidate.examCode === graded.usedKeyExamCode) ??
      null;
    return key?.answerSequence ?? '';
  });

  let warnings = $derived.by(() => {
    const graded = result;
    if (!graded) return [] as string[];
    const list: string[] = [];
    if (!graded.graded) {
      list.push('Phiếu không được chấm: thiếu mã đề và không có bộ đáp án chung.');
    }
    if (graded.usedBestGuessKey) {
      list.push('Mã đề đọc không rõ — đã chọn bộ đáp án khớp nhất.');
    }
    if (isReal && activeKeys.length === 0) {
      list.push('Kỳ thi chưa có đáp án — phiếu chỉ được quét, chưa có điểm.');
    }
    if (!isReal && session.keys.length === 0) {
      list.push('Chưa nhập đáp án trong “Đề thử” — phiếu chỉ được quét, chưa có điểm.');
    }
    if (duplicateWarning) {
      list.push('SBD này đã có phiếu trong kỳ thi — kiểm tra trước khi lưu.');
    }
    if (graded.multiAnswerCount > 0) {
      list.push(`${graded.multiAnswerCount} câu tô từ 2 ô trở lên.`);
    }
    if (!graded.scan.studentCodeRaw || graded.scan.studentCodeRaw.includes('?')) {
      list.push(
        `SBD đọc chưa đầy đủ: ${graded.scan.studentCodeRaw || 'trống'}.`
      );
    }
    if (framesGraded > 1 && agreement < 1) {
      list.push(
        'Các khung hình cho kết quả khác nhau — nên chụp lại nếu điểm bất thường.'
      );
    }
    if (framesCaptured > framesGraded) {
      list.push(
        `Chỉ đọc được ${framesGraded}/${framesCaptured} khung hình.`
      );
    }
    if (graded.diagnostics?.alignmentWarning) {
      list.push(
        'Phiếu có thể chưa được nắn đúng (mốc góc lệch sau khi nắn) — nên chụp lại.'
      );
    }
    return list;
  });

  let debugText = $derived.by(() => {
    const lines: string[] = [];
    lines.push(`Track: ${trackText}`);
    lines.push(`Probe: ${probeMs.toFixed(0)} ms · ${probeCount} lần`);
    const graded = result;
    if (graded) {
      lines.push(`Tổng xử lý: ${graded.totalMs.toFixed(0)} ms`);
      const timing = graded.timing;
      if (timing) {
        lines.push(
          `Xám ${timing.grayMs.toFixed(0)} · overlay ${timing.overlayMs.toFixed(
            0
          )} · warp ${timing.warpMs.toFixed(0)} · scan ${timing.scanMs.toFixed(0)} ms`
        );
        lines.push(
          `pageScale ${timing.pageScale.toFixed(3)} · quad: ${
            timing.quadFromDetector ? 'detector' : 'overlay'
          }`
        );
      }
      const verification = graded.verification;
      lines.push(
        verification
          ? `Verify ${verification.passed ? 'đạt' : 'không đạt'} · max ${verification.maxOffset.toFixed(
              1
            )} / ${verification.tolerance.toFixed(1)} px`
          : 'Verify: bỏ qua (quad ghim)'
      );
    }
    if (probeError) lines.push(`Lỗi probe: ${probeError}`);
    if (cameraError) lines.push(`Lỗi camera: ${cameraError}`);
    return lines.join('\n');
  });

  let captureDebugText = $derived.by(() => {
    const diagnostics = result?.diagnostics ?? null;
    if (!diagnostics) {
      return 'Chẩn đoán nắn phẳng: không có (worker không trả diagnostics).';
    }
    const lines: string[] = [];
    lines.push(
      `Nguồn quad: ${quadSourceLabel(diagnostics.quadSource)}${
        diagnostics.rescuedQuad ? ' (đã thay bằng quad khác đạt kiểm chứng)' : ''
      }`
    );
    lines.push(`Quad dùng: ${quadLine(diagnostics.quad)}`);
    lines.push(`Quad ghim: ${quadLine(diagnostics.pinnedQuad)}`);
    lines.push(`Quad detector: ${quadLine(diagnostics.detectorQuad)}`);
    lines.push(`Quad đích: ${quadLine(diagnostics.targetQuad)}`);
    const check = diagnostics.alignmentCheck;
    if (check) {
      lines.push(
        `Kiểm chứng: ${check.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'} · lệch ${check.maxOffset.toFixed(
          1
        )}/${check.tolerance.toFixed(1)} px · [${check.offsets
          .map((offset) => offset.toFixed(1))
          .join(', ')}]`
      );
    } else {
      lines.push('Kiểm chứng: chưa tính');
    }
    lines.push(
      `Nguồn ${diagnostics.src.width}×${diagnostics.src.height} (${diagnostics.src.dataLength} byte) → nắn ${diagnostics.warped.width}×${diagnostics.warped.height} · pageScale ${diagnostics.pageScale.toFixed(
        3
      )}`
    );
    if (diagnostics.homography) {
      lines.push(
        `H: ${diagnostics.homography.map((value) => value.toFixed(4)).join(' ')}`
      );
    }
    lines.push(
      `Ngưỡng p75×${diagnostics.thresholdFactor} · verify ${
        diagnostics.verificationSkipped ? 'bỏ qua (quad ghim)' : 'đã chạy'
      }`
    );
    return lines.join('\n');
  });

  function readArea(): Area {
    return {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight)
    };
  }

  function loadTolerantMode(): boolean {
    try {
      return localStorage.getItem(TOLERANT_KEY) === '1';
    } catch {
      return false;
    }
  }

  function thresholdFactor(): number {
    return tolerantMode ? TOLERANT_THRESHOLD_FACTOR : 0.5;
  }

  function toggleTolerant(): void {
    tolerantMode = !tolerantMode;
    try {
      localStorage.setItem(TOLERANT_KEY, tolerantMode ? '1' : '0');
    } catch {
      // Safari riêng tư có thể chặn localStorage.
    }
    showToast(
      tolerantMode
        ? 'Đã bật chế độ iOS dễ tính — chỉ dùng để so sánh.'
        : 'Đã tắt chế độ iOS dễ tính — quay về ngưỡng APK.'
    );
  }

  function frameSnapshot(element: HTMLVideoElement): FrameDiagnosticInfo {
    return {
      readyState: element.readyState,
      currentTime: element.currentTime,
      videoWidth: element.videoWidth,
      videoHeight: element.videoHeight,
      displayWidth: area.width,
      displayHeight: area.height,
      dpr: window.devicePixelRatio || 1,
      orientation:
        (screen.orientation && screen.orientation.type) ||
        (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait')
    };
  }

  function normalizedQuad(quad: QuadDto, width: number, height: number): QuadDto {
    const norm = (point: { x: number; y: number }) => ({
      x: point.x / width,
      y: point.y / height
    });
    return { tl: norm(quad.tl), tr: norm(quad.tr), br: norm(quad.br), bl: norm(quad.bl) };
  }

  function quadSourceLabel(source: string | undefined): string {
    switch (source) {
      case 'overlayRects':
        return 'quét trong 4 ô ghim';
      case 'detector':
        return 'detector toàn trang';
      case 'overlayQuad':
        return 'quad ghim (overlayQuad)';
      case 'known':
        return 'quad đã biết';
      default:
        return '—';
    }
  }

  function quadLine(quad: QuadDto | null | undefined): string {
    if (!quad) return '—';
    const pair = (point: { x: number; y: number }) =>
      `(${point.x.toFixed(0)},${point.y.toFixed(0)})`;
    return `tl${pair(quad.tl)} tr${pair(quad.tr)} br${pair(quad.br)} bl${pair(quad.bl)}`;
  }

  function trackSettings(): Record<string, unknown> | null {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return null;
    try {
      return { ...track.getSettings() };
    } catch {
      return null;
    }
  }

  /** Vẽ mask ngưỡng của 1 ROI (RGBA từ worker) vào canvas nhỏ trong panel. */
  function drawMask(
    canvas: HTMLCanvasElement,
    mask: { data: ArrayBuffer; width: number; height: number }
  ): void {
    const expected = mask.width * mask.height * 4;
    if (mask.data.byteLength !== expected) {
      throw new Error(
        `Mask hỏng: ${mask.width}×${mask.height} cần ${expected} byte nhưng có ${mask.data.byteLength}.`
      );
    }
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(mask.data), mask.width, mask.height),
      0,
      0
    );
  }

  function rectCenter(rect: RectDto): { x: number; y: number } {
    return {
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2
    };
  }

  function liveDiagnosticPayload(): Record<string, unknown> {
    const element = video;
    const frameNow: Area | null =
      element && element.videoWidth
        ? { width: element.videoWidth, height: element.videoHeight }
        : null;
    const mapping = frameNow ? coverMapping(frameNow, area) : null;
    return {
      kind: 'live',
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      debugFlag: DEBUG,
      tolerantMode,
      thresholdFactor: thresholdFactor(),
      probe: {
        status: probeStatus,
        error: probeError,
        lastMs: Math.round(probeMs),
        count: probeCount,
        ticksPerSec: Number(liveTicksPerSec.toFixed(2))
      },
      track: trackInfo,
      trackSettings: trackSettings(),
      frame: frameInfo,
      area,
      dpr: window.devicePixelRatio || 1,
      orientation:
        (screen.orientation && screen.orientation.type) ||
        (window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'),
      coverMapping: mapping
        ? {
            scale: mapping.scale,
            offsetX: mapping.offsetX,
            offsetY: mapping.offsetY
          }
        : null,
      guide: guideGeometry(area),
      overlayRects: frameNow
        ? overlayRectsForFrame(area, frameNow).rects.map((rect) => ({
            ...rect,
            center: rectCenter(rect)
          }))
        : null,
      squares: liveDetails.map((detail) => ({
        ok: detail.ok,
        reason: detail.reason,
        centroid: detail.centroid,
        guidePx: detail.guidePx,
        scanPx: detail.scanPx,
        diagnostics: detail.diagnostics
          ? {
              region: detail.diagnostics.region,
              step: detail.diagnostics.step,
              pageLevel: detail.diagnostics.pageLevel,
              threshold: detail.diagnostics.threshold,
              thresholdFactor: detail.diagnostics.thresholdFactor,
              sampledPixels: detail.diagnostics.sampledPixels,
              darkPixels: detail.diagnostics.darkPixels,
              componentCount: detail.diagnostics.componentCount,
              rejectionCounts: detail.diagnostics.rejectionCounts,
              closest: detail.diagnostics.closest,
              maskSize: detail.diagnostics.mask
                ? {
                    width: detail.diagnostics.mask.width,
                    height: detail.diagnostics.mask.height,
                    byteLength: detail.diagnostics.mask.data.byteLength
                  }
                : null
            }
          : null
      })),
      history: liveTicks
    };
  }

  function captureDiagnosticPayload(): Record<string, unknown> | null {
    const bundle = captureDiagnostics;
    if (!bundle) return null;
    const graded = result;
    const diagnostics = graded?.diagnostics ?? null;
    const usedRaw = rawCapture;
    return {
      kind: 'capture',
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      track: trackInfo,
      trackSettings: trackSettings(),
      dpr: window.devicePixelRatio || 1,
      frameInfo,
      context: bundle.context,
      chosenIndex: bundle.chosenIndex,
      frameDiagnostics: bundle.frameDiagnostics,
      rawFrame: usedRaw
        ? {
            width: usedRaw.width,
            height: usedRaw.height,
            byteLength: usedRaw.data.byteLength
          }
        : null,
      quadSource: diagnostics?.quadSource ?? null,
      quadSourceLabel: quadSourceLabel(diagnostics?.quadSource),
      quadUsed: graded?.quad ?? null,
      pinnedQuad: diagnostics?.pinnedQuad ?? null,
      detectorQuad: diagnostics?.detectorQuad ?? null,
      targetQuad: diagnostics?.targetQuad ?? null,
      homography: diagnostics?.homography ?? null,
      pageScale: diagnostics?.pageScale ?? null,
      alignmentCheck: diagnostics?.alignmentCheck ?? null,
      alignmentWarning: diagnostics?.alignmentWarning ?? null,
      rescuedQuad: diagnostics?.rescuedQuad ?? null,
      verificationSkipped: diagnostics?.verificationSkipped ?? null,
      verification: graded?.verification ?? null,
      thresholdFactor: diagnostics?.thresholdFactor ?? bundle.context.thresholdFactor,
      warped: graded
        ? { width: graded.warped.width, height: graded.warped.height }
        : null,
      scan: graded
        ? {
            studentCodeRaw: graded.scan.studentCodeRaw,
            examCodeRaw: graded.scan.examCodeRaw,
            answers: graded.scan.answers,
            graded: graded.graded,
            score: graded.result.score
          }
        : null
    };
  }

  async function exportLiveDiagnostics(): Promise<void> {
    if (diagExporting) return;
    diagExporting = true;
    try {
      const files: DiagnosticFile[] = [];
      const slug = timestampSlug();
      const element = video;
      if (element && element.videoWidth && element.readyState >= 2) {
        try {
          const frame = captureVideoFrame(element, LIVE_CAPTURE_MAX_WIDTH);
          files.push({
            name: `live-${slug}-frame.png`,
            blob: await rgbaToPng(frame.data, frame.width, frame.height)
          });
        } catch (error) {
          showToast(`Không chụp được khung hiện tại: ${messageOf(error)}`);
        }
      }
      for (let index = 0; index < liveDetails.length; index++) {
        const mask = liveDetails[index]?.diagnostics?.mask;
        if (!mask) continue;
        files.push({
          name: `live-${slug}-roi-${index + 1}.png`,
          blob: await rgbaToPng(mask.data, mask.width, mask.height, 160)
        });
      }
      files.push({
        name: `live-${slug}.json`,
        blob: jsonBlob(liveDiagnosticPayload())
      });
      await shareOutcome(files, 'Chẩn đoán quét live');
    } catch (error) {
      showToast(`Không tạo được gói chẩn đoán: ${messageOf(error)}`);
    } finally {
      diagExporting = false;
    }
  }

  async function exportCaptureDiagnostics(): Promise<void> {
    if (diagExporting) return;
    if (!captureDiagnostics) {
      showToast('Chưa có lần chụp nào để xuất.');
      return;
    }
    diagExporting = true;
    try {
      const files: DiagnosticFile[] = [];
      const slug = timestampSlug();
      if (rawCapture && rawCapture.data.byteLength > 0) {
        files.push({
          name: `capture-${slug}-raw.png`,
          blob: await rgbaToPng(
            rawCapture.data,
            rawCapture.width,
            rawCapture.height
          )
        });
      }
      if (result) {
        files.push({
          name: `capture-${slug}-warped.png`,
          blob: await warpedPngBlob(result.warped)
        });
      }
      files.push({
        name: `capture-${slug}.json`,
        blob: jsonBlob(captureDiagnosticPayload() ?? {})
      });
      await shareOutcome(files, 'Chẩn đoán lần chụp');
    } catch (error) {
      showToast(`Không tạo được gói chẩn đoán: ${messageOf(error)}`);
    } finally {
      diagExporting = false;
    }
  }

  async function shareOutcome(files: DiagnosticFile[], title: string): Promise<void> {
    const outcome = await shareDiagnosticFiles(
      files,
      title,
      'Gói chẩn đoán GradeVN — gửi kèm cho kỹ thuật.'
    );
    if (outcome.shared) {
      showToast('Đã mở bảng chia sẻ — chọn ứng dụng để gửi.');
    } else if (outcome.downloaded) {
      showToast(`Đã tải ${files.length} tệp chẩn đoán vào Tệp/Downloads.`);
    } else if (outcome.error === 'abort') {
      showToast('Đã huỷ chia sẻ.');
    } else if (outcome.error) {
      showToast(`Không chia sẻ được: ${outcome.error}`);
    }
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function showToast(text: string): void {
    toast = text;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3200);
  }

  function signatureOf(graded: GradeSuccessResponse): string {
    return `${graded.scan.studentCodeRaw}|${graded.scan.examCodeRaw}|${graded.scan.answers
      .map((answer) => answer ?? '-')
      .join('')}`;
  }

  function verifiedOf(graded: GradeSuccessResponse): boolean {
    return graded.verification?.passed === true;
  }

  async function loadContest(): Promise<void> {
    if (contestId == null) return;
    try {
      const contest = await getContest(contestId);
      if (!contest) {
        loadError = 'Không tìm thấy kỳ thi này.';
        loadState = 'missing';
        return;
      }
      const [keys, students] = await Promise.all([
        listAnswerKeys(contestId),
        contest.classRoomId != null
          ? listStudents(contest.classRoomId)
          : Promise.resolve([] as Student[])
      ]);
      realContest = contest;
      realKeys = keys;
      roster = students;
      loadError = null;
      loadState = 'ready';
    } catch (error) {
      loadError = messageOf(error);
      loadState = 'missing';
    }
  }

  async function isDuplicateStudent(graded: GradeSuccessResponse): Promise<boolean> {
    const contest = realContest;
    if (!contest || contest.classRoomId == null || !graded.graded) return false;
    const previous = await listGradedSheets(contest.id);
    if (graded.studentId != null) {
      return previous.some((sheet) => sheet.studentId === graded.studentId);
    }
    const code = OmrDecoder.studentCodeKey(graded.scan.studentCodeRaw);
    if (!code) return false;
    return previous.some(
      (sheet) =>
        sheet.studentCode.length > 0 &&
        OmrDecoder.studentCodeKey(sheet.studentCode) === code
    );
  }

  async function saveResult(): Promise<void> {
    const graded = result;
    const contest = realContest;
    if (!graded || !contest || saving) return;
    saving = true;
    try {
      const studentCode = OmrDecoder.isBlankCode(graded.scan.studentCodeRaw)
        ? ''
        : OmrDecoder.normalizeStudentCode(graded.scan.studentCodeRaw);
      const [original, marked] = await Promise.all([
        warpedPngBlob(graded.warped),
        renderMarkedSheetPng(
          graded.warped,
          contest,
          graded.result.flags,
          graded.scan.studentCodeRaw,
          graded.scan.examCodeRaw
        )
      ]);
      await saveGradedSheet(
        {
          contestId: contest.id,
          examCode: graded.usedExamCode,
          studentCode,
          chosen: graded.scan.answers
            .map((answer) => answer ?? '-')
            .join(''),
          correctFlags: graded.result.flags
            .map((flag) => (flag === true ? '1' : flag === false ? '0' : '?'))
            .join(''),
          score: graded.result.score,
          keyId: graded.usedKeyId,
          studentId: graded.studentId,
          partScores: graded.result.partScores,
          gradedAt: new Date().toISOString()
        },
        { original, marked }
      );
      showToast(
        !graded.graded
          ? 'Đã lưu phiếu chưa chấm được.'
          : studentCode === ''
            ? `Đã lưu phiếu không có SBD — ${formatScore(graded.result.score)} điểm.`
            : `Đã lưu phiếu ${studentCode} — ${formatScore(graded.result.score)} điểm.`
      );
      location.hash = `#/contests/${contest.id}`;
    } catch (error) {
      saving = false;
      showToast(`Không lưu được phiếu: ${messageOf(error)}`);
    }
  }

  async function startCamera(): Promise<void> {
    if (!ready || starting || stream || mode !== 'live') return;
    const element = video;
    if (!element) return;
    starting = true;
    cameraError = null;
    try {
      const media = await openCameraStream(element);
      stream = media;
      wanted = true;
      trackInfo = describeTrack(media);
      await wakeKeeper.acquire();
      scheduleProbe(120);
    } catch (error) {
      cameraError = messageOf(error);
    } finally {
      starting = false;
    }
  }

  function stopProbeTimer(): void {
    if (probeTimer != null) {
      window.clearTimeout(probeTimer);
      probeTimer = null;
    }
  }

  function stopStreamOnly(): void {
    stopProbeTimer();
    stopCameraStream(stream);
    stream = null;
    if (video) video.srcObject = null;
    void wakeKeeper.release();
    lights = [false, false, false, false];
    greenStreak = 0;
  }

  function scheduleProbe(delayMs = PROBE_INTERVAL_MS): void {
    if (probeTimer != null) return;
    probeTimer = window.setTimeout(() => {
      probeTimer = null;
      void probeOnce();
    }, delayMs);
  }

  async function probeOnce(): Promise<void> {
    if (mode !== 'live' || !stream) return;
    const element = video;
    if (!element || element.readyState < 2 || !element.videoWidth) {
      if (element) frameInfo = frameSnapshot(element);
      scheduleProbe(220);
      return;
    }
    if (probeBusy) {
      scheduleProbe(80);
      return;
    }
    probeBusy = true;
    const startedAt = performance.now();
    try {
      const frameNow: Area = {
        width: element.videoWidth,
        height: element.videoHeight
      };
      const overlay = overlayRectsForFrame(area, frameNow);
      const image = captureVideoFrame(element, PROBE_MAX_WIDTH);
      frameInfo = frameSnapshot(element);
      const response = await omrWorker.probe(image, overlay.rects, {
        diagnostics: DEBUG,
        thresholdFactor: thresholdFactor()
      });
      if (mode !== 'live' || !stream) return;
      lights = response.squares.map((square) => square.ok);
      liveDetails = response.details ?? [];
      probeMs = performance.now() - startedAt;
      probeCount += 1;
      probeStatus = 'alive';
      probeError = null;
      recordTick(startedAt, response.details, null);
      applyGreenLights();
    } catch (error) {
      probeStatus = 'error';
      probeError = messageOf(error);
      liveDetails = [];
      recordTick(startedAt, null, probeError);
    } finally {
      probeBusy = false;
      if (mode === 'live' && stream) scheduleProbe();
    }
  }

  function recordTick(
    startedAt: number,
    details: RectProbeDetailDto[] | null,
    error: string | null
  ): void {
    const at = performance.now();
    lastTickTimes.push(at);
    while (lastTickTimes.length > 0 && at - lastTickTimes[0] > 3000) {
      lastTickTimes.shift();
    }
    liveTicksPerSec = lastTickTimes.length / 3;
    const info = frameInfo;
    const summary: LiveTickSummary = {
      at: new Date().toISOString(),
      ms: Math.round(performance.now() - startedAt),
      frame: info ? `${info.videoWidth}×${info.videoHeight}` : '—',
      readyState: info?.readyState ?? 0,
      currentTime: info ? Number(info.currentTime.toFixed(3)) : 0,
      lights: lights.map((lit) => (lit ? '1' : '0')).join(''),
      reasons: error
        ? [`ERROR: ${error}`]
        : (details ?? []).map((detail) => detail.reason)
    };
    liveTicks = [summary, ...liveTicks].slice(0, 50);
  }

  /** Tự chụp y hệt APK: cả 4 ô xanh 2 nhịp liên tiếp (~160 ms ở 80 ms/nhịp). */
  function applyGreenLights(): void {
    const green = lights.length === 4 && lights.every(Boolean);
    if (!green) {
      greenStreak = 0;
      autoArmed = true;
      return;
    }
    if (greenStreak < AUTO_CAPTURE_STREAK) greenStreak += 1;
    if (
      greenStreak >= AUTO_CAPTURE_STREAK &&
      ready &&
      settings.autoCapture &&
      autoArmed &&
      !busy &&
      mode === 'live'
    ) {
      autoArmed = false;
      playTone('ready');
      void captureAndGradeFromCamera('auto');
    }
  }

  function manualCapture(): void {
    unlockAudio();
    if (!ready || mode !== 'live' || !stream || busy) return;
    void captureAndGradeFromCamera('manual');
  }

  async function captureAndGradeFromCamera(
    trigger: 'auto' | 'manual'
  ): Promise<void> {
    const element = video;
    if (mode !== 'live' || !stream || !element || busy) return;
    if (!element.videoWidth) {
      showToast('Camera chưa có khung hình — chờ một nhịp rồi thử lại.');
      return;
    }
    unlockAudio();
    playTone('capture');
    busy = true;
    mode = 'grading';
    autoArmed = false;
    greenStreak = 0;
    lights = [false, false, false, false];
    scanError = null;
    statusOverride = 'Đang chụp…';
    result = null;
    duplicateWarning = false;
    rawCapture = null;
    captureDiagnostics = null;
    liveDetails = [];
    lastTickTimes = [];
    liveTicks = [];
    liveTicksPerSec = 0;
    await tick();

    const frames: DecodedImage[] = [];
    let overlayRects: RectDto[] = [];
    let frameSize: Area | null = null;
    try {
      const frameNow: Area = {
        width: element.videoWidth,
        height: element.videoHeight
      };
      const mapping = coverMapping(frameNow, area);
      const guideCenters = guideGeometry(area).centers.map((center) => ({
        x: center.x,
        y: center.y
      }));
      const overlay = overlayRectsForFrame(area, frameNow);
      overlayRects = overlay.rects;
      frameSize = frameNow;
      const context: CaptureContext = {
        trigger,
        startedAt: new Date().toISOString(),
        videoWidth: frameNow.width,
        videoHeight: frameNow.height,
        areaWidth: area.width,
        areaHeight: area.height,
        mappingScale: mapping.scale,
        mappingOffsetX: mapping.offsetX,
        mappingOffsetY: mapping.offsetY,
        guideCenters,
        overlayRects: overlayRects.map((rect) => ({
          ...rect,
          centerX: (rect.left + rect.right) / 2,
          centerY: (rect.top + rect.bottom) / 2
        })),
        frames: [],
        thresholdFactor: thresholdFactor()
      };
      captureDiagnostics = { context, frameDiagnostics: [], chosenIndex: -1 };
      for (let index = 0; index < CAPTURE_FRAMES; index++) {
        const readyState = element.readyState;
        const currentTime = Number(element.currentTime.toFixed(3));
        const captured = captureVideoFrame(element, LIVE_CAPTURE_MAX_WIDTH);
        context.frames.push({
          width: captured.width,
          height: captured.height,
          byteLength: captured.data.byteLength,
          readyState,
          currentTime
        });
        if (index === 0) {
          // Bản sao: buffer của `captured` bị transfer sang worker khi chấm.
          const snapshot = cloneImage(captured);
          rawCapture = snapshot;
          const display = downscaleImage(snapshot, 900);
          debugFrame = display;
          try {
            debugThreshold = buildThresholdPreview(
              display.data,
              display.width,
              display.height
            );
          } catch {
            debugThreshold = null;
          }
          if (freezeCanvas) drawFrame(freezeCanvas, display);
        }
        frames.push(captured);
        statusOverride = `Đang chụp ${index + 1}/${CAPTURE_FRAMES}…`;
        if (index < CAPTURE_FRAMES - 1) await delay(120);
      }
      capturedRects = overlayRects;
      framesCaptured = frames.length;
    } catch (error) {
      await failScan(messageOf(error));
      return;
    }

    stopStreamOnly();
    await gradeFrames(frames, overlayRects, frameSize);
  }

  async function gradeFrames(
    frames: DecodedImage[],
    overlayRects: RectDto[] | null,
    frameSize: Area | null
  ): Promise<void> {
    mode = 'grading';
    busy = true;
    duplicateWarning = false;
    framesCaptured = frames.length;
    const contest = activeContest;
    const keys = activeKeys;
    const students = isReal ? roster : [];
    const graded: GradeSuccessResponse[] = [];
    try {
      for (let index = 0; index < frames.length; index++) {
        statusOverride =
          frames.length > 1
            ? `Đang chấm khung ${index + 1}/${frames.length}…`
            : 'Đang chấm…';
        const response = await omrWorker.grade({
          image: frames[index],
          contest,
          keys,
          students,
          overlayRects,
          frameSize,
          diagnostics: true,
          thresholdFactor: thresholdFactor()
        });
        if (response) graded.push(response);
      }
    } catch (error) {
      await failScan(`Lỗi xử lý ảnh: ${messageOf(error)}`);
      return;
    }

    if (graded.length === 0) {
      await failScan(
        'Không tìm thấy đủ 4 mốc trên phiếu. Giữ phiếu phẳng, đủ sáng và nằm trọn trong 4 ô.'
      );
      return;
    }

    const voted = voteBest(graded, signatureOf, verifiedOf);
    if (!voted) {
      await failScan('Không tổng hợp được kết quả. Thử chụp lại.');
      return;
    }

    const chosen = voted.chosen;
    result = chosen;
    agreement = voted.agreement;
    framesGraded = graded.length;
    const chosenIndex = graded.indexOf(chosen);
    if (captureDiagnostics) {
      captureDiagnostics = {
        ...captureDiagnostics,
        frameDiagnostics: graded.map((frame) => frame.diagnostics ?? null),
        chosenIndex
      };
    }
    mode = 'result';
    busy = false;
    statusOverride = null;
    playTone('success');
    if (isReal) {
      try {
        duplicateWarning = await isDuplicateStudent(chosen);
      } catch {
        duplicateWarning = false;
      }
    }
  }

  async function failScan(message: string): Promise<void> {
    stopStreamOnly();
    scanError = message;
    mode = 'live';
    busy = false;
    statusOverride = null;
    playTone('error');
    showToast(message);
    await tick();
    if (wanted) await startCamera();
  }

  function pickFile(): void {
    if (!ready) return;
    unlockAudio();
    fileInput?.click();
  }

  async function onFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    unlockAudio();
    mode = 'grading';
    busy = true;
    statusOverride = 'Đang đọc ảnh…';
    scanError = null;
    result = null;
    rawCapture = null;
    captureDiagnostics = null;
    stopStreamOnly();
    await tick();

    try {
      const decoded = await decodeImageFile(file, FILE_MAX_WIDTH);
      const snapshot = cloneImage(decoded);
      rawCapture = snapshot;
      const display = downscaleImage(snapshot, 900);
      debugFrame = display;
      try {
        debugThreshold = buildThresholdPreview(
          display.data,
          display.width,
          display.height
        );
      } catch {
        debugThreshold = null;
      }
      capturedRects = [];
      if (freezeCanvas) drawFrame(freezeCanvas, display);
      statusOverride = 'Đang chấm…';
      await gradeFrames([decoded], null, null);
    } catch (error) {
      await failScan(messageOf(error));
    }
  }

  async function rescan(): Promise<void> {
    result = null;
    debugFrame = null;
    debugThreshold = null;
    capturedRects = [];
    rawCapture = null;
    captureDiagnostics = null;
    liveDetails = [];
    liveTicks = [];
    liveTicksPerSec = 0;
    lastTickTimes = [];
    frameInfo = null;
    probeStatus = 'idle';
    probeError = null;
    agreement = 0;
    framesGraded = 0;
    framesCaptured = 0;
    duplicateWarning = false;
    saving = false;
    scanError = null;
    cameraError = null;
    showSettings = false;
    showDebugPanel = false;
    mode = 'live';
    busy = false;
    wanted = true;
    await tick();
    await startCamera();
  }

  function goHome(): void {
    mode = 'live';
    wanted = false;
    stopStreamOnly();
    result = null;
    location.hash =
      contestId != null ? `#/contests/${contestId}` : '#/';
  }

  function toggleAuto(): void {
    settings = { ...settings, autoCapture: !settings.autoCapture };
    savePracticeSettings(settings);
    if (!settings.autoCapture) autoArmed = true;
  }

  function openSettings(): void {
    showSettings = true;
    showDebugPanel = false;
  }

  function closeSettings(): void {
    settings = {
      ...settings,
      examCode: normalizeExamCode(settings.examCode),
      answers: normalizeAnswerSequence(settings.answers)
    };
    savePracticeSettings(settings);
    showSettings = false;
  }

  function useSample(): void {
    settings = {
      ...settings,
      examCode: SAMPLE_EXAM_CODE,
      answers: SAMPLE_ANSWERS
    };
    savePracticeSettings(settings);
  }

  function updateExamCode(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    settings = { ...settings, examCode: input.value };
  }

  function updateAnswers(event: Event): void {
    const input = event.currentTarget as HTMLTextAreaElement;
    settings = { ...settings, answers: input.value };
  }

  function formatScore(value: number): string {
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function handleVisibility(): void {
    if (document.visibilityState === 'hidden') {
      stopProbeTimer();
      if (mode === 'live') stopStreamOnly();
    } else if (mode === 'live' && wanted && !stream) {
      void startCamera();
    }
  }

  function handleResize(): void {
    area = readArea();
    if (mode === 'live') scheduleProbe(280);
  }

  $effect(() => {
    const canvas = overlayCanvas;
    if (!canvas) return;
    drawLiveOverlay(canvas, { area, guide, lights });
  });

  $effect(() => {
    if (mode !== 'result' || !result) return;
    const warped = warpedCanvas;
    if (warped) {
      try {
        drawWarpedScan(
          warped,
          result.warped,
          activeContest,
          result.scan.grids as DensityGridsDto
        );
      } catch {
        // Canvas lỗi chỉ ảnh hưởng phần hiển thị.
      }
    }
    if (!DEBUG) return;
    const captured = capturedCanvas;
    const debugImage = rawCapture ?? debugFrame;
    if (captured && debugImage) {
      try {
        drawCapturedDebug(
          captured,
          debugImage,
          result.quad
            ? normalizedQuad(result.quad, debugImage.width, debugImage.height)
            : null,
          capturedRects,
          700,
          {
            pinCenters: showPinCenters
              ? (captureDiagnostics?.context.overlayRects ?? []).map((rect) => ({
                  x: rect.centerX,
                  y: rect.centerY
                }))
              : []
          }
        );
      } catch {
        // bỏ qua
      }
    }
    const threshold = thresholdCanvas;
    if (threshold && debugThreshold) {
      try {
        drawThresholdPreview(threshold, debugThreshold);
      } catch {
        // bỏ qua
      }
    }
  });

  $effect(() => {
    if (!showDebugPanel) return;
    const details = liveDetails;
    if (!details.length) return;
    for (let index = 0; index < details.length; index++) {
      const mask = details[index]?.diagnostics?.mask;
      const canvas = rectCanvases[index];
      if (!mask || !canvas) continue;
      try {
        drawMask(canvas, mask);
      } catch (error) {
        probeError = messageOf(error);
      }
    }
  });

  onMount(() => {
    const onResize = (): void => handleResize();
    const onVisibility = (): void => handleVisibility();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    unlockAudio();
    wanted = true;
    if (contestId == null) {
      void startCamera();
    } else {
      void loadContest().then(async () => {
        if (loadState !== 'ready') return;
        await tick();
        await startCamera();
      });
    }
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      wanted = false;
      stopProbeTimer();
      stopStreamOnly();
      if (toastTimer != null) window.clearTimeout(toastTimer);
    };
  });
</script>

{#if loadState === 'loading'}
  <main class="state-screen">
    <div class="spinner dark"></div>
    <p>Đang tải kỳ thi…</p>
  </main>
{:else if loadState === 'missing'}
  <main class="state-screen">
    <h1>Không mở được kỳ thi</h1>
    <p>{loadError ?? 'Kỳ thi không tồn tại hoặc đã bị xoá.'}</p>
    <a class="btn primary" href="#/contests">Về danh sách kỳ thi</a>
  </main>
{:else if mode === 'result' && result}
  <main class="result-screen">
    <header class="result-head">
      <button class="icon-btn" onclick={rescan} aria-label="Chụp lại">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div class="result-title">
        <h1>{isReal ? activeContest.name : 'Kết quả'}</h1>
        <p>
          {framesGraded}/{framesCaptured || 1} khung · đồng thuận
          {Math.round(agreement * 100)}%
        </p>
      </div>
      <button
        class="icon-btn"
        onclick={goHome}
        aria-label={isReal ? 'Về kỳ thi' : 'Về trang chủ'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </header>

    <section class="score-card">
      {#if result.graded}
        <div class="score-line">
          <span class="score">{formatScore(result.result.score)}</span>
          <span class="score-max">/ {formatScore(activeContest.maxScore)}</span>
        </div>
        <div class="score-chips">
          <span class="chip ok">{result.result.correctCount} đúng</span>
          <span class="chip bad">{result.result.incorrectCount} sai</span>
          <span class="chip muted-chip">{result.result.unansweredCount} trống</span>
        </div>
      {:else}
        <h2 class="ungraded-title">Phiếu chưa chấm được</h2>
        <p class="muted">
          Thiếu mã đề và không có bộ đáp án chung. Chụp lại với mã đề rõ hơn.
        </p>
      {/if}
    </section>

    {#if warnings.length > 0}
      <section class="card warnings">
        <h3>Cần lưu ý</h3>
        <ul>
          {#each warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="card">
      <h3>Thông tin phiếu</h3>
      <dl class="meta-grid">
        <div>
          <dt>SBD đọc được</dt>
          <dd>{result.scan.studentCodeRaw || '—'}</dd>
        </div>
        <div>
          <dt>Mã đề đọc được</dt>
          <dd>{result.scan.examCodeRaw || '—'}</dd>
        </div>
        <div>
          <dt>Mã đề dùng để chấm</dt>
          <dd>{result.usedExamCode || '—'}</dd>
        </div>
        <div>
          <dt>Bộ đáp án</dt>
          <dd>{result.usedKeyExamCode != null ? `Mã ${result.usedKeyExamCode}` : '—'}</dd>
        </div>
        {#if isReal}
          <div>
            <dt>Học sinh</dt>
            <dd>
              {matchedStudent
                ? `${matchedStudent.code} · ${matchedStudent.fullName}`
                : activeContest.classRoomId != null
                  ? 'Không khớp SBD trong lớp'
                  : 'Kỳ thi ngoài lớp'}
            </dd>
          </div>
        {/if}
      </dl>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>Đáp án từng câu</h3>
        {#if result.usedBestGuessKey}
          <span class="tag warn">Khoá đoán</span>
        {/if}
      </div>
      <div class="answer-grid">
        {#each result.scan.answers as chosen, index}
          {@const keyLetter = keyLetters[index] ?? ''}
          <div
            class="answer-cell"
            class:ok={result.result.flags[index] === true}
            class:bad={result.result.flags[index] === false}
            class:blank={result.result.flags[index] == null}
          >
            <span class="q">{index + 1}</span>
            <span class="chosen">{chosen ?? '–'}</span>
            <span class="key">{keyLetter || ''}</span>
          </div>
        {/each}
      </div>
      <p class="answer-note muted">
        Số câu · đáp án đọc được · đáp án đúng (nếu có key).
      </p>
    </section>

    <section class="card warped-card">
      <h3>Ảnh phiếu đã nắn phẳng</h3>
      {#if result.diagnostics?.alignmentWarning}
        <p class="align-warn" role="alert">
          Phiếu có thể chưa được nắn đúng — nên chụp lại.
        </p>
      {/if}
      <canvas bind:this={warpedCanvas} class="warped-canvas"></canvas>
      <p class="muted small">Ô đỏ = mật độ mực cao (được chọn).</p>
      {#if result.diagnostics}
        <p class="muted small">
          Mốc dùng để nắn: {quadSourceLabel(result.diagnostics.quadSource)}
          {#if result.diagnostics.alignmentCheck}
            · kiểm chứng lệch
            {result.diagnostics.alignmentCheck.maxOffset.toFixed(1)} px
          {/if}
          {#if result.diagnostics.rescuedQuad}
            · đã thay bằng quad đạt kiểm chứng
          {/if}
        </p>
      {/if}
    </section>

    {#if DEBUG}
      <section class="card debug">
        <h3>Gỡ lỗi</h3>
        <pre class="debug-pre selectable">{debugText}</pre>
        {#if captureDiagnostics}
          <h4>Nắn phẳng: quad · kiểm chứng · homography</h4>
          <pre class="debug-pre selectable">{captureDebugText}</pre>
        {/if}
        {#if rawCapture ?? debugFrame}
          <h4>Ảnh chụp · xanh = mốc dùng nắn · vàng = 4 ô ghim · xanh lơ = tâm ô ghim</h4>
          <canvas bind:this={capturedCanvas} class="debug-canvas"></canvas>
          {#if captureDiagnostics}
            <label class="switch-row diag-toggle">
              <span>
                <b>Hiện tâm 4 ô ghim</b>
                <small class="muted">Chéo xanh lơ trên ảnh chụp</small>
              </span>
              <input type="checkbox" bind:checked={showPinCenters} />
            </label>
          {/if}
        {/if}
        {#if debugThreshold}
          <h4>Ngưỡng thích nghi (mô phỏng hiển thị)</h4>
          <canvas bind:this={thresholdCanvas} class="debug-canvas"></canvas>
        {/if}
        {#if captureDiagnostics}
          <button
            class="btn"
            onclick={exportCaptureDiagnostics}
            disabled={diagExporting}
          >
            {diagExporting ? 'Đang tạo…' : 'Lưu dữ liệu chẩn đoán lần chụp'}
          </button>
        {/if}
      </section>
    {/if}

    <div class="result-actions">
      {#if isReal}
        <button
          class="btn primary"
          onclick={saveResult}
          disabled={saving}
        >
          {saving ? 'Đang lưu…' : 'Lưu kết quả'}
        </button>
        <button class="btn" onclick={rescan}>Chụp phiếu khác</button>
        <button class="btn ghost" onclick={goHome}>Về kỳ thi</button>
      {:else}
        <button class="btn primary" onclick={rescan}>Chụp phiếu khác</button>
        <button class="btn ghost" onclick={goHome}>Về trang chủ</button>
      {/if}
    </div>
  </main>
{:else}
  <div class="scan" class:grading={mode === 'grading'}>
    <video
      bind:this={video}
      class="preview"
      playsinline
      muted
      autoplay
    ></video>

    {#if mode === 'grading'}
      <canvas bind:this={freezeCanvas} class="freeze"></canvas>
    {/if}

    <canvas bind:this={overlayCanvas} class="overlay"></canvas>

    <header class="scan-head">
      <button
        class="icon-btn light"
        onclick={goHome}
        aria-label="Về trang chủ"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div class="head-title">
        <h1>{isReal ? activeContest.name : 'Quét phiếu'}</h1>
        <p aria-live="polite">
          <span class="dot" class:ok={allGreen} class:on={stream != null}></span>
          {statusText}
        </p>
      </div>
      {#if DEBUG}
        <button
          class="icon-btn light"
          onclick={() => (showDebugPanel = !showDebugPanel)}
          aria-label="Bảng gỡ lỗi"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 3l1.5 2.2A6 6 0 0113.5 5L15 3M6 8h12a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2zM8 13h2M14 13h2M9 18l-2 2M15 18l2 2"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}
      {#if !isReal}
        <button
          class="icon-btn light"
          onclick={openSettings}
          aria-label="Cấu hình đề thử"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}
    </header>

    {#if scanError}
      <div class="banner" role="alert">
        <span>{scanError}</span>
        <button onclick={() => (scanError = null)} aria-label="Đóng">×</button>
      </div>
    {:else if probeStatus === 'error' && probeError}
      <div class="banner" role="alert">
        <span>Lỗi quét mốc: {probeError}</span>
        <button onclick={() => (probeError = null)} aria-label="Đóng">×</button>
      </div>
    {/if}

    {#if mode === 'grading'}
      <div class="processing" role="status" aria-live="polite">
        <div class="spinner"></div>
        <p>{statusOverride ?? 'Đang xử lý…'}</p>
      </div>
    {:else if starting}
      <div class="processing" role="status" aria-live="polite">
        <div class="spinner"></div>
        <p>Đang mở camera…</p>
      </div>
    {:else if cameraError}
      <div class="fallback">
        <h2>Không mở được camera</h2>
        <p>{cameraError}</p>
        <div class="fallback-actions">
          <button class="btn primary" onclick={startCamera}>Thử lại camera</button>
          <button class="btn" onclick={pickFile}>Chọn ảnh từ thư viện</button>
          <a class="btn ghost" href="#/camera-test">Kiểm tra camera</a>
        </div>
      </div>
    {/if}

    {#if !cameraError && !starting}
      <footer class="scan-foot">
        <div class="light-row">
          <span class="status-dot" class:ok={allGreen}></span>
          <span>{statusText}</span>
        </div>
        <div class="controls">
          <button class="round-btn" onclick={pickFile} aria-label="Chọn ảnh từ thư viện">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7" />
              <circle cx="8.5" cy="10" r="1.4" fill="currentColor" />
              <path d="M4 17l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
            </svg>
            <span>Thư viện</span>
          </button>

          <button
            class="shutter"
            onclick={manualCapture}
            disabled={!stream || mode !== 'live'}
            aria-label="Chụp phiếu"
          >
            <span class="shutter-inner">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                />
                <circle cx="12" cy="13.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8" />
              </svg>
            </span>
          </button>

          <button
            class="round-btn"
            class:active={settings.autoCapture}
            onclick={toggleAuto}
            aria-pressed={settings.autoCapture}
            aria-label="Bật hoặc tắt tự chụp"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M13 2L5 13h5l-1 9 8-11h-5z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
            </svg>
            <span>Tự động</span>
          </button>
        </div>
        <p class="hint">
          {#if settings.autoCapture}
            Đưa phiếu vào 4 ô — đèn xanh cả 4 và giữ yên để tự chụp.
          {:else}
            Đưa phiếu vào 4 ô, đèn xanh cả 4 rồi nhấn nút chụp.
          {/if}
        </p>
      </footer>
    {/if}

    {#if showSettings && !isReal}
      <div
        class="sheet-backdrop"
        role="presentation"
        onclick={(event) => {
          if (event.target === event.currentTarget) closeSettings();
        }}
      >
        <dialog open class="sheet" aria-label="Cấu hình đề thử">
          <header class="sheet-head">
            <div>
              <h2>Đề thử</h2>
              <p class="muted">
                Tạm thời cho bước 4 — bước 5 sẽ thay bằng kỳ thi thật.
              </p>
            </div>
            <button class="link-btn" onclick={closeSettings}>Xong</button>
          </header>

          <label class="field">
            <span>Mã đề</span>
            <input
              type="text"
              inputmode="numeric"
              maxlength="3"
              value={settings.examCode}
              oninput={updateExamCode}
              placeholder="001"
            />
          </label>

          <label class="field">
            <span>Đáp án (A–D, tối đa 40 câu)</span>
            <textarea
              rows="4"
              value={settings.answers}
              oninput={updateAnswers}
              placeholder="BADCBADC…"
            ></textarea>
            <small class="muted">
              {normalizeAnswerSequence(settings.answers).length}/40 câu
            </small>
          </label>

          <div class="sheet-row">
            <button class="btn ghost small" onclick={useSample}>Dùng đề mẫu</button>
            <span class="muted small">Đề mẫu khớp fixtures 37/40 → 9.25</span>
          </div>

          <label class="switch-row">
            <span>
              <b>Tự chụp khi đủ 4 mốc</b>
              <small class="muted">Cả 4 mốc xanh 2 nhịp liên tiếp</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoCapture}
              onchange={toggleAuto}
            />
          </label>

          <div class="track-box">
            <p><b>Camera:</b> {trackText}</p>
            <p class="muted small">
              Probe {probeMs.toFixed(0)} ms/lần · wake lock:
              {wakeKeeper.held ? 'đang giữ' : wakeKeeper.available ? 'chưa giữ' : 'không hỗ trợ'}
            </p>
          </div>

          <a class="btn ghost" href="#/camera-test">Mở trang kiểm tra camera</a>
          <button class="btn primary" onclick={closeSettings}>Lưu và quét tiếp</button>
        </dialog>
      </div>
    {/if}

    {#if DEBUG && showDebugPanel && !showSettings}
      <div
        class="sheet-backdrop"
        role="presentation"
        onclick={(event) => {
          if (event.target === event.currentTarget) showDebugPanel = false;
        }}
      >
        <dialog open class="sheet" aria-label="Bảng chẩn đoán">
          <header class="sheet-head">
            <div>
              <h2>Chẩn đoán trực tiếp</h2>
              <p class="muted small">
                Số liệu thật từ máy này. Ô không xanh → gửi lại gói chẩn đoán.
              </p>
            </div>
            <button class="link-btn" onclick={() => (showDebugPanel = false)}>
              Đóng
            </button>
          </header>

          <div class="diag-status">
            <span
              class="tag"
              class:tag-ok={probeStatus === 'alive'}
              class:tag-bad={probeStatus === 'error'}
            >
              Worker:
              {probeStatus === 'alive'
                ? 'đang trả kết quả'
                : probeStatus === 'error'
                  ? 'LỖI'
                  : 'chưa chạy'}
            </span>
            <span>{liveTicksPerSec.toFixed(1)} nhịp/s</span>
            <span>{probeMs.toFixed(0)} ms</span>
            <span>p75×{thresholdFactor()}</span>
          </div>
          {#if probeError}
            <p class="diag-error selectable">{probeError}</p>
          {/if}
          {#if cameraError}
            <p class="diag-error selectable">{cameraError}</p>
          {/if}

          {#if frameInfo}
            <pre class="debug-pre selectable">video {frameInfo.videoWidth}×{frameInfo.videoHeight} · readyState {frameInfo.readyState} · t={frameInfo.currentTime.toFixed(2)}s
màn hình {frameInfo.displayWidth}×{frameInfo.displayHeight} @{frameInfo.dpr}x · {frameInfo.orientation}
track: {trackText}
settings: {JSON.stringify(trackSettings() ?? {})}</pre>
          {:else}
            <p class="muted small">Chưa có khung hình camera.</p>
          {/if}

          <label class="switch-row">
            <span>
              <b>Chế độ iOS dễ tính (mốc tương phản thấp)</b>
              <small class="muted">
                Ngưỡng p75×0.8 thay vì ×0.5 của APK — chỉ để so sánh, mặc định tắt.
              </small>
            </span>
            <input
              type="checkbox"
              checked={tolerantMode}
              onchange={toggleTolerant}
            />
          </label>

          {#each liveDetails as detail, index}
            <section class="roi-card">
              <header class="roi-head">
                <b>Ô {index + 1}</b>
                <span class="tag" class:tag-ok={detail.ok} class:tag-bad={!detail.ok}>
                  {detail.ok ? 'FOUND' : detail.reason}
                </span>
              </header>
              {#if detail.diagnostics}
                <p class="diag-line">
                  ô ghim {detail.guidePx.left.toFixed(0)},{detail.guidePx.top.toFixed(0)} →
                  {detail.guidePx.right.toFixed(0)},{detail.guidePx.bottom.toFixed(0)} px ·
                  quét {detail.scanPx.left.toFixed(0)},{detail.scanPx.top.toFixed(0)} →
                  {detail.scanPx.right.toFixed(0)},{detail.scanPx.bottom.toFixed(0)} px
                </p>
                <p class="diag-line">
                  ngưỡng {detail.diagnostics.threshold.toFixed(1)} = p75
                  {detail.diagnostics.pageLevel.toFixed(1)} ×
                  {detail.diagnostics.thresholdFactor} · tối
                  {detail.diagnostics.darkPixels}/{detail.diagnostics.sampledPixels} px ·
                  {detail.diagnostics.componentCount} khối
                </p>
                {#if detail.diagnostics.closest}
                  {@const closest = detail.diagnostics.closest}
                  <p class="diag-line">
                    gần tâm: cạnh {closest.side.toFixed(0)} px · đặc
                    {closest.fill.toFixed(2)} · tỉ lệ {closest.aspect.toFixed(2)} ·
                    cách {closest.distance.toFixed(1)} px
                    {#if closest.touchesRegionEdge} · CHẠM MÉP{/if} ·
                    {closest.accepted ? 'nhận' : (closest.reason ?? 'loại')}
                  </p>
                {/if}
                {#if detail.diagnostics.mask}
                  <canvas bind:this={rectCanvases[index]} class="roi-mask"></canvas>
                {/if}
              {:else}
                <p class="diag-line">Không có số liệu chi tiết.</p>
              {/if}
            </section>
          {/each}

          {#if liveTicks.length > 0}
            <h4 class="diag-title">Nhịp gần nhất</h4>
            <pre class="debug-pre selectable">{liveTicks
                .slice(0, 20)
                .map(
                  (tick) =>
                    `${tick.at.slice(11, 23)} ${tick.frame} rs${tick.readyState} t${tick.currentTime} ${tick.lights} ${tick.reasons.join(' | ')}`
                )
                .join('\n')}</pre>
          {/if}

          <div class="diag-actions">
            <button
              class="btn primary"
              onclick={exportLiveDiagnostics}
              disabled={diagExporting}
            >
              {diagExporting ? 'Đang tạo…' : 'Lưu dữ liệu chẩn đoán'}
            </button>
            {#if captureDiagnostics}
              <button
                class="btn"
                onclick={exportCaptureDiagnostics}
                disabled={diagExporting}
              >
                Xuất lần chụp gần nhất ({captureDiagnostics.context.trigger === 'auto'
                  ? 'tự động'
                  : 'thủ công'})
              </button>
            {/if}
          </div>
          <p class="muted small">
            Gói gồm PNG khung gốc, 4 ảnh ROI ngưỡng và JSON (khung hình, mapping,
            ngưỡng, lý do loại, lịch sử nhịp). Trên iPhone bấm Chia sẻ để gửi
            lại.
          </p>
        </dialog>
      </div>
    {/if}

    {#if toast}
      <div class="toast" role="status">{toast}</div>
    {/if}
  </div>
{/if}

<input
  bind:this={fileInput}
  type="file"
  accept="image/*"
  capture="environment"
  class="hidden-input"
  onchange={onFile}
/>

<style>
  .scan {
    position: fixed;
    inset: 0;
    z-index: 30;
    height: 100dvh;
    overflow: hidden;
    background: #000;
    color: #f6f8f4;
    touch-action: manipulation;
    user-select: none;
  }

  .state-screen {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    text-align: center;
    background: var(--bg);
    color: var(--text);
  }

  .state-screen h1 {
    font-size: 21px;
    letter-spacing: -0.4px;
  }

  .state-screen p {
    max-width: 300px;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--muted);
  }

  .state-screen .btn {
    margin-top: 8px;
    width: min(280px, 100%);
    text-decoration: none;
  }

  .spinner.dark {
    border-color: color-mix(in srgb, var(--text) 16%, transparent);
    border-top-color: var(--neon-deep);
  }

  .preview,
  .freeze,
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .preview {
    object-fit: cover;
    background: #000;
  }

  .freeze {
    object-fit: cover;
    z-index: 2;
    background: #000;
  }

  .overlay {
    z-index: 3;
    pointer-events: none;
    transition: opacity 160ms ease;
  }

  .scan.grading .overlay {
    opacity: 0;
  }

  .scan-head {
    position: absolute;
    z-index: 6;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 18px;
    background: linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.72),
      rgba(0, 0, 0, 0.32) 70%,
      transparent
    );
  }

  .head-title {
    flex: 1;
    min-width: 0;
    padding-left: 4px;
  }

  .head-title h1 {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head-title p {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 12.5px;
    color: rgba(255, 255, 255, 0.82);
    font-variant-numeric: tabular-nums;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    flex: none;
  }

  .dot.on {
    background: var(--warn);
  }

  .dot.ok {
    background: var(--ok);
  }

  .icon-btn {
    width: 44px;
    height: 44px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .icon-btn svg {
    width: 22px;
    height: 22px;
  }

  .icon-btn.light {
    background: rgba(12, 18, 14, 0.5);
    border-color: rgba(255, 255, 255, 0.25);
    color: #fff;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .banner {
    position: absolute;
    z-index: 7;
    top: calc(72px + env(safe-area-inset-top, 0px));
    left: 12px;
    right: 12px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(120, 28, 28, 0.92);
    border: 1px solid rgba(255, 120, 120, 0.5);
    font-size: 13px;
    line-height: 1.4;
  }

  .banner span {
    flex: 1;
  }

  .banner button {
    width: 28px;
    height: 28px;
    flex: none;
    border: 0;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .processing {
    position: absolute;
    z-index: 5;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-size: 14.5px;
    pointer-events: none;
  }

  .spinner {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.22);
    border-top-color: var(--neon);
    animation: spin 780ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .fallback {
    position: absolute;
    z-index: 8;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(340px, calc(100% - 32px));
    padding: 20px;
    border-radius: 20px;
    background: rgba(14, 20, 25, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.16);
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }

  .fallback h2 {
    font-size: 18px;
  }

  .fallback p {
    font-size: 13.5px;
    color: rgba(255, 255, 255, 0.74);
    line-height: 1.45;
  }

  .fallback-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .scan-foot {
    position: absolute;
    z-index: 6;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 26px 16px calc(12px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.82),
      rgba(0, 0, 0, 0.34) 62%,
      transparent
    );
  }

  .light-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(10, 14, 12, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 12.5px;
    color: rgba(255, 255, 255, 0.9);
    font-variant-numeric: tabular-nums;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
  }

  .status-dot.ok {
    background: var(--ok);
    box-shadow: 0 0 10px color-mix(in srgb, var(--ok) 70%, transparent);
  }

  .controls {
    width: 100%;
    max-width: 420px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 0 8px;
  }

  .round-btn {
    width: 56px;
    height: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 18px;
    background: rgba(18, 24, 20, 0.6);
    color: rgba(255, 255, 255, 0.9);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2px;
    cursor: pointer;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    -webkit-tap-highlight-color: transparent;
  }

  .round-btn svg {
    width: 23px;
    height: 23px;
  }

  .round-btn.active {
    border-color: color-mix(in srgb, var(--neon) 60%, transparent);
    color: var(--neon);
    background: rgba(30, 46, 18, 0.72);
  }

  .shutter {
    width: 78px;
    height: 78px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.72);
    background: rgba(0, 0, 0, 0.18);
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .shutter:disabled {
    opacity: 0.45;
  }

  .shutter-inner {
    width: 60px;
    height: 60px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: #fff;
    color: #111;
  }

  .shutter-inner svg {
    width: 27px;
    height: 27px;
  }

  .hint {
    min-height: 32px;
    max-width: 360px;
    text-align: center;
    font-size: 12.5px;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.72);
  }

  .toast {
    position: absolute;
    z-index: 9;
    left: 50%;
    bottom: calc(160px + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    width: min(340px, calc(100% - 40px));
    padding: 12px 16px;
    border-radius: 14px;
    background: rgba(15, 22, 18, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.8);
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.55);
  }

  .sheet {
    width: 100%;
    max-width: none;
    margin: 0;
    max-height: 88dvh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px));
    border-radius: 22px 22px 0 0;
    background: var(--surface);
    color: var(--text);
    border: none;
    border-top: 1px solid var(--border);
    user-select: text;
    -webkit-user-select: text;
  }

  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .sheet-head h2 {
    font-size: 19px;
    letter-spacing: -0.3px;
  }

  .sheet-head p {
    margin-top: 3px;
    font-size: 12.5px;
    line-height: 1.4;
  }

  .link-btn {
    min-height: 44px;
    padding: 0 6px;
    border: 0;
    background: transparent;
    color: var(--neon-deep);
    font-weight: 650;
    font-size: 15px;
    cursor: pointer;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
  }

  .field input,
  .field textarea {
    width: 100%;
    padding: 11px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
    color: var(--text);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.6px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }

  .field textarea {
    resize: vertical;
    min-height: 76px;
    letter-spacing: 1.4px;
  }

  .sheet-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
    font-size: 13.5px;
  }

  .switch-row span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .switch-row input {
    width: 26px;
    height: 26px;
    accent-color: var(--neon-deep);
  }

  .track-box {
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px dashed var(--border);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }

  .track-box p + p {
    margin-top: 4px;
  }

  .hidden-input {
    display: none;
  }

  .small {
    font-size: 12px;
  }

  .selectable {
    user-select: text;
    -webkit-user-select: text;
  }

  /* ---------- Kết quả ---------- */

  .result-screen {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--bg);
    color: var(--text);
    padding: calc(10px + env(safe-area-inset-top, 0px)) 16px
      calc(26px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .result-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .result-title {
    flex: 1;
    min-width: 0;
  }

  .result-title h1 {
    font-size: 21px;
    letter-spacing: -0.4px;
  }

  .result-title p {
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .score-card {
    padding: 20px;
    border-radius: 22px;
    border: 1px solid var(--border);
    background:
      radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, var(--neon) 16%, transparent), transparent 58%),
      linear-gradient(160deg, var(--surface), var(--surface-alt));
  }

  .score-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .score {
    font-size: 54px;
    font-weight: 800;
    letter-spacing: -2.4px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .score-max {
    font-size: 17px;
    color: var(--muted);
    font-weight: 600;
  }

  .score-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .chip {
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 650;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .chip.ok {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: color-mix(in srgb, var(--ok) 12%, var(--surface));
  }

  .chip.bad {
    color: var(--bad);
    border-color: color-mix(in srgb, var(--bad) 45%, transparent);
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
  }

  .muted-chip {
    color: var(--muted);
  }

  .ungraded-title {
    font-size: 20px;
    margin-bottom: 6px;
  }

  .result-screen .card {
    padding: 16px;
  }

  .result-screen .card h3 {
    font-size: 14px;
    margin-bottom: 12px;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .card-head h3 {
    margin-bottom: 0;
  }

  .tag {
    font-size: 11px;
    font-weight: 700;
    padding: 4px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }

  .tag.warn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
  }

  .warnings ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13.5px;
    color: var(--text);
    line-height: 1.4;
  }

  .warnings h3 {
    color: var(--warn);
  }

  .meta-grid {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .meta-grid div {
    min-width: 0;
  }

  .meta-grid dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
  }

  .meta-grid dd {
    margin: 3px 0 0;
    font-size: 15px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .answer-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .answer-cell {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 4px 6px;
    border-radius: 9px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
    font-variant-numeric: tabular-nums;
  }

  .answer-cell .q {
    width: 17px;
    flex: none;
    font-size: 10.5px;
    color: var(--muted);
    text-align: right;
  }

  .answer-cell .chosen {
    flex: 1;
    font-size: 14px;
    font-weight: 700;
    text-align: center;
  }

  .answer-cell .key {
    width: 13px;
    flex: none;
    font-size: 10px;
    color: var(--muted);
    text-align: center;
  }

  .answer-cell.ok {
    border-color: color-mix(in srgb, var(--ok) 55%, transparent);
    background: color-mix(in srgb, var(--ok) 14%, var(--surface));
  }

  .answer-cell.ok .chosen {
    color: var(--ok);
  }

  .answer-cell.bad {
    border-color: color-mix(in srgb, var(--bad) 55%, transparent);
    background: color-mix(in srgb, var(--bad) 14%, var(--surface));
  }

  .answer-cell.bad .chosen {
    color: var(--bad);
  }

  .answer-cell.blank .chosen {
    color: var(--muted);
  }

  .answer-note {
    margin-top: 10px;
    font-size: 11.5px;
  }

  .warped-card canvas,
  .debug-canvas {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: #fff;
  }

  .warped-card p {
    margin-top: 8px;
  }

  .debug-pre {
    margin: 0;
    padding: 10px;
    border-radius: 12px;
    background: var(--surface-alt);
    border: 1px solid var(--border);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .debug h4 {
    margin: 14px 0 8px;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .tag.tag-ok {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
    background: color-mix(in srgb, var(--ok) 12%, var(--surface));
  }

  .tag.tag-bad {
    color: var(--bad);
    border-color: color-mix(in srgb, var(--bad) 45%, transparent);
    background: color-mix(in srgb, var(--bad) 12%, var(--surface));
  }

  .diag-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .diag-error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    background: color-mix(in srgb, var(--bad) 10%, var(--surface));
    color: var(--bad);
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .roi-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
  }

  .roi-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }

  .diag-line {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }

  .roi-mask {
    width: 100%;
    max-width: 180px;
    height: auto;
    image-rendering: pixelated;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #000;
  }

  .diag-title {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .diag-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .diag-toggle {
    margin-top: 10px;
  }

  .align-warn {
    margin: 0 0 10px;
    padding: 9px 11px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
    color: var(--warn);
    font-size: 12.5px;
    line-height: 1.4;
    font-weight: 600;
  }

  .result-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 4px;
  }

  @media (max-width: 359px) {
    .answer-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .score {
      font-size: 46px;
    }
  }
</style>
