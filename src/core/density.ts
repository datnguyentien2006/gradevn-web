// Đo mật độ mực theo từng ô. Nguồn Dart:
// lib/data/cv/omr_image_pipeline.dart (dòng 14–264).

import { clamp, Offset, Rect } from './geometry';
import { DensityBlock } from './omrDecoder';
import { SheetLayout } from './sheetLayout';

export class OmrTuning {
  constructor(
    public readonly inkDelta = 45,
    public readonly insetRatio = 0.28,
    public readonly borderRatio = 0.08,
    public readonly sampleStep = 1
  ) {}
}

export const DEFAULT_OMR_TUNING = new OmrTuning();

export class SheetDensities {
  constructor(
    public readonly answerBlocks: DensityBlock[],
    public readonly studentCodeGrid: DensityBlock,
    public readonly examCodeGrid: DensityBlock
  ) {}
}

export type ByteArray = Uint8Array | Uint8ClampedArray;

export interface GrayPlanar {
  data: ByteArray;
  width: number;
  height: number;
}

export interface RgbaImage {
  data: ByteArray;
  width: number;
  height: number;
}

/**
 * Ảnh xám từ RGBA. Đường chụp thật dùng KÊNH 0 (R) như Dart `srcGray`;
 * hàm này mô phỏng `img.grayscale` cho đường fixture/test.
 */
export function rgbaToLumaGray(rgba: ByteArray, width: number, height: number): GrayPlanar {
  const gray = new Uint8Array(width * height);
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    gray[i] = Math.floor((rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000);
  }
  return { data: gray, width, height };
}

/** Kênh 0 của RGBA — giống `srcBytes[i * srcCh]` trong Dart. */
export function rgbaChannel0Gray(rgba: ByteArray, width: number, height: number): GrayPlanar {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) gray[i] = rgba[i * 4];
  return { data: gray, width, height };
}

export function measureRgba(
  rgba: ByteArray,
  width: number,
  height: number,
  layout: SheetLayout,
  tuning: OmrTuning = DEFAULT_OMR_TUNING
): SheetDensities {
  const gray = rgbaToLumaGray(rgba, width, height);
  return measureGrayPlanar(gray, layout, tuning);
}

export function measureGrayPlanar(
  gray: GrayPlanar,
  layout: SheetLayout,
  tuning: OmrTuning = DEFAULT_OMR_TUNING
): SheetDensities {
  const { data, width, height } = gray;
  const scaleX = width / layout.page.width;
  const scaleY = height / layout.page.height;
  const scaleRect = (r: Rect): Rect =>
    new Rect(r.left * scaleX, r.top * scaleY, r.right * scaleX, r.bottom * scaleY);

  const measureRect = (rect: Rect): number =>
    cellInkDensity(data, width, height, scaleRect(rect), tuning);

  const blocks: DensityBlock[] = layout.answerBlocks.map((block) => {
    const values: number[][] = [];
    for (let row = 0; row < block.rows; row++) {
      const line: number[] = [];
      for (let col = 0; col < block.columns; col++) {
        line.push(measureRect(block.cellRect(row, col)));
      }
      values.push(line);
    }
    return new DensityBlock(values);
  });

  const digitGrid = (slotCenters: readonly number[], rowCenters: readonly number[], cellSize: number) => {
    const values: number[][] = [];
    for (let slot = 0; slot < slotCenters.length; slot++) {
      const line: number[] = [];
      for (let value = 0; value < rowCenters.length; value++) {
        line.push(
          measureRect(
            Rect.fromCenter(new Offset(slotCenters[slot], rowCenters[value]), cellSize, cellSize)
          )
        );
      }
      values.push(line);
    }
    return new DensityBlock(values);
  };

  return new SheetDensities(
    blocks,
    digitGrid(
      layout.studentCodeGrid.slotCenters,
      layout.studentCodeGrid.valueRowCenters,
      layout.studentCodeGrid.cellSize
    ),
    digitGrid(
      layout.examCodeGrid.slotCenters,
      layout.examCodeGrid.valueRowCenters,
      layout.examCodeGrid.cellSize
    )
  );
}

function cellInkDensity(
  bytes: ByteArray,
  imageWidth: number,
  imageHeight: number,
  cell: Rect,
  tuning: OmrTuning
): number {
  const x1 = clamp(Math.floor(cell.left), 0, imageWidth - 1);
  const y1 = clamp(Math.floor(cell.top), 0, imageHeight - 1);
  const x2 = clamp(Math.ceil(cell.right), x1 + 1, imageWidth);
  const y2 = clamp(Math.ceil(cell.bottom), y1 + 1, imageHeight);
  const cw = x2 - x1;
  const ch = y2 - y1;
  if (cw < 4 || ch < 4) return 0;

  const border = Math.max(1, Math.round(Math.min(cw, ch) * tuning.borderRatio));

  let sum = 0;
  let count = 0;
  const step = tuning.sampleStep;
  for (let y = y1; y < y2; y += step) {
    for (let dx = 0; dx < border; dx += step) {
      sum += grayAt(bytes, imageWidth, x1 + dx, y);
      sum += grayAt(bytes, imageWidth, x2 - 1 - dx, y);
      count += 2;
    }
  }
  for (let x = x1; x < x2; x += step) {
    for (let dy = 0; dy < border; dy += step) {
      sum += grayAt(bytes, imageWidth, x, y1 + dy);
      sum += grayAt(bytes, imageWidth, x, y2 - 1 - dy);
      count += 2;
    }
  }
  if (count === 0) return 0;
  const background = sum / count;
  const darkBelow = background - tuning.inkDelta;

  const inset = Math.round(Math.min(cw, ch) * tuning.insetRatio);
  const ix1 = x1 + inset;
  const ix2 = x2 - inset;
  const iy1 = y1 + inset;
  const iy2 = y2 - inset;
  if (ix2 <= ix1 || iy2 <= iy1) return 0;

  let dark = 0;
  let total = 0;
  for (let y = iy1; y < iy2; y += step) {
    for (let x = ix1; x < ix2; x += step) {
      if (grayAt(bytes, imageWidth, x, y) < darkBelow) dark++;
      total++;
    }
  }
  return total === 0 ? 0 : dark / total;
}

function grayAt(bytes: ByteArray, imageWidth: number, x: number, y: number): number {
  const idx = y * imageWidth + x;
  return idx < bytes.length ? bytes[idx] : 255;
}
