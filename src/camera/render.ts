// Vẽ overlay camera + ảnh trung gian gỡ lỗi bằng Canvas 2D.
// Hình học overlay lấy từ overlayGeometry (port preview_overlay.dart).
// Ảnh nắn phẳng/bong bóng chỉ để HIỂN THỊ — không tham gia chấm điểm.

import { SheetLayout, type DigitGridGeometry } from '../core/sheetLayout';
import { SheetTemplate } from '../core/sheetTemplate';
import { Size } from '../core/geometry';
import { contestSheetSpec, type Contest } from '../core/types';
import type { DensityGridsDto, PointDto, QuadDto, RectDto } from '../workers/protocol';
import {
  coverMapping,
  type Area,
  type GuideGeometry
} from './overlayGeometry';
import type { ThresholdPreview } from './thresholdPreview';
import type { DecodedImage } from './imageInput';

const GREEN = '#3ddc97';
const AMBER = '#ffb020';
const RED = '#ff6b6b';

export interface LiveOverlayState {
  area: Area;
  guide: GuideGeometry;
  lights: boolean[];
  quad: QuadDto | null;
  candidates: PointDto[];
  frame: Area | null;
  debug: boolean;
}

export function drawLiveOverlay(
  canvas: HTMLCanvasElement,
  state: LiveOverlayState
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(state.area.width * dpr));
  const height = Math.max(1, Math.round(state.area.height * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, state.area.width, state.area.height);

  const boxes = state.guide.centers.map((center, index) => ({
    center,
    lit: state.lights[index] === true
  }));

  for (const box of boxes) {
    const left = box.center.x - state.guide.boxWidth / 2;
    const top = box.center.y - state.guide.boxHeight / 2;
    ctx.beginPath();
    ctx.roundRect(left, top, state.guide.boxWidth, state.guide.boxHeight, 14);
    if (box.lit) {
      ctx.fillStyle = 'rgba(61, 220, 151, 0.16)';
      ctx.fill();
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 2.5;
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(box.center.x, box.center.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = box.lit ? GREEN : 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
  }

  if (state.quad && state.frame) {
    const mapping = coverMapping(state.frame, state.area);
    const corners = [state.quad.tl, state.quad.tr, state.quad.br, state.quad.bl].map(
      (p) => mapping.toScreen({ x: p.x, y: p.y })
    );
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(61, 220, 151, 0.72)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (state.debug && state.frame) {
    const mapping = coverMapping(state.frame, state.area);
    for (const point of state.candidates) {
      const screen = mapping.toScreen({ x: point.x, y: point.y });
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = AMBER;
      ctx.fill();
    }
  }
}

/** Vẽ khung hình đã chụp (giữ nguyên tỉ lệ) — dùng làm ảnh đóng băng. */
export function drawFrame(canvas: HTMLCanvasElement, image: DecodedImage): void {
  if (canvas.width !== image.width) canvas.width = image.width;
  if (canvas.height !== image.height) canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pixels = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  ctx.putImageData(pixels, 0, 0);
}

/** Ảnh chụp + quad phát hiện + 4 ô ghim, thu về tối đa [maxWidth] px. */
export function drawCapturedDebug(
  canvas: HTMLCanvasElement,
  image: DecodedImage,
  quad: QuadDto | null,
  rects: RectDto[],
  maxWidth = 700
): void {
  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const source = document.createElement('canvas');
  source.width = image.width;
  source.height = image.height;
  source
    .getContext('2d')
    ?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(source, 0, 0, width, height);

  for (const rect of rects) {
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      rect.left * width,
      rect.top * height,
      (rect.right - rect.left) * width,
      (rect.bottom - rect.top) * height
    );
  }

  if (quad) {
    const points = [quad.tl, quad.tr, quad.br, quad.bl];
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * width, points[i].y * height);
    }
    ctx.closePath();
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = GREEN;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Ảnh xám đã nắn phẳng + chấm mật độ từng ô (đỏ = đậm, vàng = trung bình). */
export function drawWarpedScan(
  canvas: HTMLCanvasElement,
  warped: { data: ArrayBuffer; width: number; height: number },
  contest: Contest,
  grids: DensityGridsDto,
  maxWidth = 560
): void {
  const sourceWidth = warped.width;
  const sourceHeight = warped.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const gray = new Uint8Array(warped.data);
  const image = new ImageData(width, height);
  const out = image.data;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      const value = gray[sy * sourceWidth + sx];
      const o = (y * width + x) * 4;
      out[o] = value;
      out[o + 1] = value;
      out[o + 2] = value;
      out[o + 3] = 255;
    }
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(image, 0, 0);

  const layout = SheetLayout.forSpec(contestSheetSpec(contest), new Size(width, height));
  const circle = (
    cx: number,
    cy: number,
    radius: number,
    density: number,
    baseStroke: string
  ): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    if (density >= 0.3) {
      ctx.fillStyle = 'rgba(255, 64, 64, 0.5)';
      ctx.fill();
      ctx.strokeStyle = RED;
      ctx.lineWidth = 1.4;
    } else if (density >= 0.18) {
      ctx.fillStyle = 'rgba(255, 176, 32, 0.35)';
      ctx.fill();
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = baseStroke;
      ctx.lineWidth = 1;
    }
    ctx.stroke();
  };

  layout.answerBlocks.forEach((block, blockIndex) => {
    const density = grids.answerBlocks[blockIndex];
    if (!density) return;
    const radius = Math.max(2.2, block.cellSize * 0.42);
    for (let row = 0; row < block.rows; row++) {
      for (let col = 0; col < block.columns; col++) {
        const value = density[row]?.[col] ?? 0;
        const center = block.center(row, col);
        circle(center.dx, center.dy, radius, value, 'rgba(255, 255, 255, 0.28)');
      }
    }
  });

  const digitGrid = (
    slotCenters: readonly number[],
    valueRowCenters: readonly number[],
    cellSize: number,
    density: number[][]
  ): void => {
    const radius = Math.max(1.8, cellSize * 0.38);
    for (let slot = 0; slot < slotCenters.length; slot++) {
      for (let value = 0; value < valueRowCenters.length; value++) {
        const d = density[slot]?.[value] ?? 0;
        circle(
          slotCenters[slot],
          valueRowCenters[value],
          radius,
          d,
          'rgba(95, 215, 238, 0.32)'
        );
      }
    }
  };
  digitGrid(
    layout.studentCodeGrid.slotCenters,
    layout.studentCodeGrid.valueRowCenters,
    layout.studentCodeGrid.cellSize,
    grids.studentCodeGrid
  );
  digitGrid(
    layout.examCodeGrid.slotCenters,
    layout.examCodeGrid.valueRowCenters,
    layout.examCodeGrid.cellSize,
    grids.examCodeGrid
  );

  const markerRadius = Math.max(
    4,
    (SheetTemplate.tn40Standard.markerSide * layout.scale) / 2
  );
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 1.6;
  for (const center of layout.cornerMarkerCenters) {
    ctx.beginPath();
    ctx.arc(center.dx, center.dy, markerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawThresholdPreview(
  canvas: HTMLCanvasElement,
  preview: ThresholdPreview
): void {
  canvas.width = preview.width;
  canvas.height = preview.height;
  canvas.getContext('2d')?.putImageData(preview.imageData, 0, 0);
}

// ---------------------------------------------------------------- lưu phiếu

function grayImageData(
  source: ArrayBuffer,
  width: number,
  height: number
): ImageData {
  const gray = new Uint8Array(source);
  const image = new ImageData(width, height);
  const out = image.data;
  const count = Math.min(width * height, gray.length);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const value = gray[i];
    out[o] = value;
    out[o + 1] = value;
    out[o + 2] = value;
    out[o + 3] = 255;
  }
  return image;
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Không tạo được tệp PNG từ ảnh phiếu.'));
    }, 'image/png');
  });
}

/** Ảnh phiếu xám đã nắn phẳng → PNG (bản "gốc" lưu trong IndexedDB). */
export async function warpedPngBlob(warped: {
  data: ArrayBuffer;
  width: number;
  height: number;
}): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = warped.width;
  canvas.height = warped.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D không khả dụng.');
  ctx.putImageData(
    grayImageData(warped.data, warped.width, warped.height),
    0,
    0
  );
  return canvasPng(canvas);
}

const MARKED_CORRECT = 'rgb(56, 142, 60)';
const MARKED_WRONG = 'rgb(211, 47, 47)';
const MARKED_BLANK = 'rgb(176, 190, 197)';
const MARKED_DIGIT = 'rgb(48, 63, 159)';
const MARKED_DIGIT_WRONG = 'rgb(239, 108, 0)';

/**
 * Ảnh phiếu đã nắn + tô kết quả — port `renderMarkedSheet`
 * (lib/data/cv/sheet_painter.dart:397). Tô ô đầu mỗi hàng câu theo
 * đúng/ sai / trống, và ô chữ số SBD/mã đề đọc được.
 */
export async function renderMarkedSheetPng(
  warped: { data: ArrayBuffer; width: number; height: number },
  contest: Contest,
  correctFlags: readonly (boolean | null)[],
  studentCodeRaw: string,
  examCodeRaw: string
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = warped.width;
  canvas.height = warped.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D không khả dụng.');
  ctx.putImageData(
    grayImageData(warped.data, warped.width, warped.height),
    0,
    0
  );

  const layout = SheetLayout.forSpec(
    contestSheetSpec(contest),
    new Size(warped.width, warped.height)
  );
  const tint = (
    cell: { left: number; top: number; right: number; bottom: number },
    color: string,
    inset: number
  ): void => {
    const pad = Math.min(cell.right - cell.left, cell.bottom - cell.top) * inset / 100;
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(cell.left + pad),
      Math.round(cell.top + pad),
      Math.max(0, Math.round(cell.right - cell.left - pad * 2)),
      Math.max(0, Math.round(cell.bottom - cell.top - pad * 2))
    );
  };
  const tintGrid = (grid: DigitGridGeometry, raw: string): void => {
    for (let slot = 0; slot < grid.slots; slot++) {
      const char = raw[slot] ?? '';
      const unreadable = char === '?';
      const parsed = /[0-9]/.test(char) ? Number(char) : null;
      if (parsed == null && !unreadable) continue;
      for (let value = 0; value < grid.rows; value++) {
        const hit = parsed === value;
        if (parsed != null && !hit) continue;
        tint(
          grid.cellRect(slot, value),
          hit ? MARKED_DIGIT : MARKED_DIGIT_WRONG,
          hit ? 30 : 38
        );
        if (hit) break;
      }
    }
  };

  tintGrid(layout.studentCodeGrid, studentCodeRaw);
  tintGrid(layout.examCodeGrid, examCodeRaw);

  for (let q = 0; q < layout.totalQuestions && q < correctFlags.length; q++) {
    const block = layout.answerBlocks.find(
      (candidate) =>
        q >= candidate.firstQuestionIndex &&
        q < candidate.firstQuestionIndex + candidate.rows
    );
    if (!block) continue;
    const row = q - block.firstQuestionIndex;
    const flag = correctFlags[q];
    tint(
      block.cellRect(row, 0),
      flag == null ? MARKED_BLANK : flag ? MARKED_CORRECT : MARKED_WRONG,
      flag == null ? 34 : 40
    );
  }

  return canvasPng(canvas);
}
