// Bản mô phỏng CHỈ ĐỂ HIỂN THỊ bước ngưỡng thích nghi của detector.
// Nguồn công thức Dart: lib/data/cv/sheet_alignment.dart (detectFromGray:
// downsample f=max(1,floor(w/640)), integral image, mask = gray <
// localMean×0.8, window half = max(8, round(expectedSide))).
//
// Ảnh này KHÔNG được dùng để chấm điểm — pipeline chấm nằm trong worker.

import { SheetTemplate } from '../core/sheetTemplate';

export interface ThresholdPreview {
  imageData: ImageData;
  width: number;
  height: number;
  factor: number;
}

export function buildThresholdPreview(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth = 640
): ThresholdPreview {
  const f = Math.max(1, Math.floor(width / targetWidth));
  const dw = Math.floor(width / f);
  const dh = Math.floor(height / f);
  const gray = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx = ((y * f) * width + x * f) * 4;
      gray[y * dw + x] = Math.trunc(
        (rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000
      );
    }
  }

  const iw = dw + 1;
  const integral = new Int32Array(iw * (dh + 1));
  for (let y = 0; y < dh; y++) {
    let rowSum = 0;
    const out = (y + 1) * iw;
    const prev = y * iw;
    for (let x = 0; x < dw; x++) {
      rowSum += gray[y * dw + x];
      integral[out + x + 1] = integral[prev + x + 1] + rowSum;
    }
  }

  const template = SheetTemplate.tn40Standard;
  const expectedSide = (template.markerSide / template.pageWidthUnits) * dw;
  const winHalf = Math.max(8, Math.round(expectedSide));

  const image = new ImageData(dw, dh);
  const out = image.data;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.max(0, dy - winHalf);
    const y1 = Math.min(dh - 1, dy + winHalf);
    const prevRow = y0 * iw;
    const outRow = (y1 + 1) * iw;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.max(0, dx - winHalf);
      const x1 = Math.min(dw - 1, dx + winHalf);
      const windowSum =
        integral[outRow + x1 + 1] -
        integral[prevRow + x1 + 1] -
        integral[outRow + x0] +
        integral[prevRow + x0];
      const localMean = windowSum / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const ink = gray[dy * dw + dx] < localMean * 0.8;
      const o = (dy * dw + dx) * 4;
      const v = ink ? 0 : 255;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { imageData: image, width: dw, height: dh, factor: f };
}
