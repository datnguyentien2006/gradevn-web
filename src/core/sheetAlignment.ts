// Nắn phẳng + phát hiện 4 mốc góc — port 1:1 từ Dart.
// Nguồn Dart: lib/data/cv/sheet_alignment.dart.
//
// Khác biệt web: không decode PNG trong core. Ảnh đã decode thành mảng xám
// planar (1 byte/pixel) hoặc RGBA do worker cung cấp; mọi phép toán còn lại
// giữ nguyên công thức và thứ tự float của Dart.

import { Offset, Size, AlignmentQuad } from './geometry';
import { SheetTemplate } from './sheetTemplate';

export type Homography3x3 = number[];

/** Giải homography đưa 4 điểm `from` (tl,tr,br,bl) về 4 điểm `to`. */
export function solveHomography(from: readonly Offset[], to: readonly Offset[]): Homography3x3 {
  if (from.length !== 4 || to.length !== 4) {
    throw new Error('Cần đúng 4 cặp điểm (tl,tr,br,bl).');
  }
  const a: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const b: number[] = new Array<number>(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const sx = from[i].dx;
    const sy = from[i].dy;
    const dx = to[i].dx;
    const dy = to[i].dy;
    const r1 = 2 * i;
    const r2 = r1 + 1;
    a[r1][0] = sx;
    a[r1][1] = sy;
    a[r1][2] = 1;
    a[r1][6] = -sx * dx;
    a[r1][7] = -sy * dx;
    b[r1] = dx;
    a[r2][3] = sx;
    a[r2][4] = sy;
    a[r2][5] = 1;
    a[r2][6] = -sx * dy;
    a[r2][7] = -sy * dy;
    b[r2] = dy;
  }
  const solution = solveLinear8(a, b);
  if (solution === null) {
    throw new Error('Hệ homography suy biến (4 điểm gần thẳng hàng).');
  }
  return [...solution, 1];
}

/** Áp homography cho điểm ảnh (u,v). */
export function applyHomography(h: Homography3x3, u: number, v: number): Offset {
  const w = h[6] * u + h[7] * v + 1;
  return new Offset(
    (h[0] * u + h[1] * v + h[2]) / w,
    (h[3] * u + h[4] * v + h[5]) / w
  );
}

function solveLinear8(a: number[][], b: number[]): number[] | null {
  const n = 8;
  const m = Array.from({ length: n }, (_, i) => [...a[i], b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const diag = m[col][col];
    for (let j = col; j <= n; j++) m[col][j] /= diag;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j];
    }
  }
  return Array.from({ length: n }, (_, i) => m[i][n]);
}

export class MarkerDetection {
  constructor(
    public readonly quad: AlignmentQuad | null,
    public readonly candidates: Offset[]
  ) {}

  get hasAllMarkers(): boolean {
    return this.quad !== null;
  }
}

class SquareCandidate {
  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly maxX: number,
    readonly maxY: number
  ) {}

  get cx(): number {
    return (this.minX + this.maxX) / 2;
  }
  get cy(): number {
    return (this.minY + this.maxY) / 2;
  }
  get bw(): number {
    return this.maxX - this.minX + 1;
  }
  get bh(): number {
    return this.maxY - this.minY + 1;
  }
}

export interface GrayDetectionImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export class SheetMarkerDetector {
  constructor(
    public readonly targetWidth = 640,
    public readonly debug = false
  ) {}

  /** Phát hiện mốc trên ảnh xám PLANAR (1 byte/pixel). */
  detectGray(gray: Uint8Array | Uint8ClampedArray, width: number, height: number, template?: SheetTemplate): MarkerDetection {
    const tpl = template ?? SheetTemplate.tn40Standard;
    if (width < 120 || height < 120) return new MarkerDetection(null, []);
    if (this.debug) console.log(`detectGray: ảnh ${width}×${height}`);
    const normalized = gray instanceof Uint8Array && gray.byteOffset === 0 && gray.buffer.byteLength === gray.length ? gray : new Uint8Array(gray.buffer, gray.byteOffset, gray.length);
    const grayAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return 255;
      const idx = y * width + x;
      return idx < normalized.length ? normalized[idx] : 255;
    };
    return this.detectFromGray(grayAt, width, height, tpl);
  }

  /** Phát hiện mốc trên ảnh RGBA — dùng đúng công thức luminance của Dart. */
  detectRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, template?: SheetTemplate): MarkerDetection {
    const tpl = template ?? SheetTemplate.tn40Standard;
    if (width < 120 || height < 120) return new MarkerDetection(null, []);
    if (this.debug) console.log(`detectRgba: ảnh ${width}×${height}`);
    const grayAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return 255;
      const idx = (y * width + x) * 4;
      if (idx + 2 >= rgba.length) return 255;
      return Math.trunc((rgba[idx] * 299 + rgba[idx + 1] * 587 + rgba[idx + 2] * 114) / 1000);
    };
    return this.detectFromGray(grayAt, width, height, tpl);
  }

  private detectFromGray(
    grayAt: (x: number, y: number) => number,
    w: number,
    h: number,
    tpl: SheetTemplate
  ): MarkerDetection {
    const f = Math.max(1, Math.floor(w / this.targetWidth));
    const dw = Math.floor(w / f);
    const dh = Math.floor(h / f);

    let sum = 0;
    let count = 0;
    for (let y = 0; y < h; y += f) {
      for (let x = 0; x < w; x += f) {
        sum += grayAt(x, y);
        count++;
      }
    }
    if (count === 0) return new MarkerDetection(null, []);
    const mean = sum / count;
    if (this.debug) {
      console.log(
        `detect: mean=${mean} f=${f} dst=${dw}×${dh} expectedSide=${(
          (tpl.markerSide / tpl.pageWidthUnits) * dw
        ).toFixed(1)} threshold=adaptive(local_mean×0.8)`
      );
    }

    const expectedSide = (tpl.markerSide / tpl.pageWidthUnits) * dw;
    const minSide = Math.max(5, expectedSide * 0.4);
    const maxSide = Math.max(minSide * 2, expectedSide * 3);

    const graySmall = new Uint8Array(dw * dh);
    for (let dy = 0; dy < dh; dy++) {
      for (let dx = 0; dx < dw; dx++) {
        graySmall[dy * dw + dx] = grayAt(dx * f, dy * f) & 0xff;
      }
    }

    const iw = dw + 1;
    const integral = new Int32Array(iw * (dh + 1));
    for (let y = 0; y < dh; y++) {
      let rowSum = 0;
      const out = (y + 1) * iw;
      const prev = y * iw;
      for (let x = 0; x < dw; x++) {
        rowSum += graySmall[y * dw + x];
        integral[out + x + 1] = integral[prev + x + 1] + rowSum;
      }
    }

    const winHalf = Math.max(8, Math.round(expectedSide));
    const mask = new Uint8Array(dw * dh);
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
        mask[dy * dw + dx] = graySmall[dy * dw + dx] < localMean * 0.8 ? 1 : 0;
      }
    }

    const candidateList = this.findSquareCandidates(mask, dw, dh, minSide, maxSide);
    const quad = this.pickCornerQuad(candidateList, f);
    if (this.debug) {
      console.log(`detect: candidates=${candidateList.length} quad=${quad ? 'ok' : 'null'}`);
    }
    return new MarkerDetection(
      quad,
      candidateList.map((c) => new Offset(c.cx * f, c.cy * f))
    );
  }

  private findSquareCandidates(
    mask: Uint8Array,
    dw: number,
    dh: number,
    minSide: number,
    maxSide: number
  ): SquareCandidate[] {
    const visited = new Uint8Array(dw * dh);
    const stack: number[] = [];
    const result: SquareCandidate[] = [];

    for (let start = 0; start < mask.length; start++) {
      if (mask[start] === 0 || visited[start] === 1) continue;
      visited[start] = 1;
      stack.push(start);
      let minX = start % dw;
      let maxX = minX;
      let minY = Math.floor(start / dw);
      let maxY = minY;
      let area = 0;

      while (stack.length > 0) {
        const i = stack.pop()!;
        const iy = Math.floor(i / dw);
        const ix = i % dw;
        area++;
        if (ix < minX) minX = ix;
        if (ix > maxX) maxX = ix;
        if (iy < minY) minY = iy;
        if (iy > maxY) maxY = iy;
        if (ix + 1 < dw && mask[i + 1] === 1 && visited[i + 1] === 0) {
          visited[i + 1] = 1;
          stack.push(i + 1);
        }
        if (ix > 0 && mask[i - 1] === 1 && visited[i - 1] === 0) {
          visited[i - 1] = 1;
          stack.push(i - 1);
        }
        if (iy + 1 < dh && mask[i + dw] === 1 && visited[i + dw] === 0) {
          visited[i + dw] = 1;
          stack.push(i + dw);
        }
        if (iy > 0 && mask[i - dw] === 1 && visited[i - dw] === 0) {
          visited[i - dw] = 1;
          stack.push(i - dw);
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const fill = area / (bw * bh);
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      const aspect = bw / bh;
      if (aspect < 0.7 || aspect > 1.4) continue;
      if (fill < 0.5) continue;
      result.push(new SquareCandidate(minX, minY, maxX, maxY));
    }
    return result;
  }

  private pickCornerQuad(candidates: SquareCandidate[], f: number): AlignmentQuad | null {
    if (candidates.length < 4) return null;
    const hull = convexHull(candidates.map((c) => new Offset(c.cx * f, c.cy * f)));
    if (hull.length < 4) return null;

    let tl: Offset | null = null;
    let tr: Offset | null = null;
    let br: Offset | null = null;
    let bl: Offset | null = null;
    let bestTl = -Infinity;
    let bestTr = -Infinity;
    let bestBr = -Infinity;
    let bestBl = -Infinity;
    for (const p of hull) {
      const tlScore = -p.dx - p.dy;
      const trScore = p.dx - p.dy;
      const brScore = p.dx + p.dy;
      const blScore = -p.dx + p.dy;
      if (tlScore > bestTl) {
        bestTl = tlScore;
        tl = p;
      }
      if (trScore > bestTr) {
        bestTr = trScore;
        tr = p;
      }
      if (brScore > bestBr) {
        bestBr = brScore;
        br = p;
      }
      if (blScore > bestBl) {
        bestBl = blScore;
        bl = p;
      }
    }
    if (!tl || !tr || !br || !bl) return null;
    const keys = new Set([tl, tr, br, bl].map((p) => `${p.dx},${p.dy}`));
    if (keys.size < 4) return null;

    const top = Math.abs(tr.dx - tl.dx);
    const bottom = Math.abs(br.dx - bl.dx);
    const left = Math.abs(bl.dy - tl.dy);
    const right = Math.abs(br.dy - tr.dy);
    const meanW = (top + bottom) / 2;
    const meanH = (left + right) / 2;
    if (meanW <= 0 || meanH <= 0) return null;
    const ratio = meanH / meanW;
    if (ratio < 0.8 || ratio > 2.4) return null;
    return new AlignmentQuad(tl, tr, br, bl);
  }
}

function convexHull(points: Offset[]): Offset[] {
  const sorted = [...points].sort((a, b) => {
    const dx = a.dx - b.dx;
    return dx !== 0 ? dx : a.dy - b.dy;
  });
  const lower: Offset[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Offset[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(o: Offset, a: Offset, b: Offset): number {
  return (a.dx - o.dx) * (b.dy - o.dy) - (a.dy - o.dy) * (b.dx - o.dx);
}

export interface WarpedGray {
  gray: Uint8ClampedArray;
  width: number;
  height: number;
}

export class PerspectiveWarper {
  /**
   * Nắn phẳng ảnh xám planar → mảng xám planar. Hệ số nguồn 1 (xám) hoặc 4
   * (RGBA, đọc kênh 0) — cùng đường float và bilinear của Dart.
   */
  warpGrayPlanar(options: {
    srcGray: Uint8Array | Uint8ClampedArray;
    srcWidth: number;
    srcHeight: number;
    quad: AlignmentQuad;
    targetQuad: AlignmentQuad;
    outputSize: Size;
    srcChannels?: number;
  }): WarpedGray {
    const { srcGray, srcWidth, srcHeight, quad, targetQuad, outputSize } = options;
    const sc = Math.max(1, options.srcChannels ?? 1);
    const ow = Math.trunc(outputSize.width);
    const oh = Math.trunc(outputSize.height);
    const out = new Uint8ClampedArray(ow * oh);
    const homo = solveHomography(targetQuad.corners, quad.corners);
    const h0 = homo[0];
    const h1 = homo[1];
    const h2 = homo[2];
    const h3 = homo[3];
    const h4 = homo[4];
    const h5 = homo[5];
    const h6 = homo[6];
    const h7 = homo[7];

    const srcW = srcWidth;
    const srcH = srcHeight;
    const wLast = srcW - 1;
    const hLast = srcH - 1;
    for (let y = 0; y < oh; y++) {
      const h1y = h1 * y;
      const h4y = h4 * y;
      const h7y = h7 * y;
      const rowBase = y * ow;
      for (let x = 0; x < ow; x++) {
        const den = h6 * x + h7y + 1.0;
        let u = (h0 * x + h1y + h2) / den;
        let v = (h3 * x + h4y + h5) / den;
        u = u < 0 ? 0 : u > wLast ? wLast : u;
        v = v < 0 ? 0 : v > hLast ? hLast : v;
        const x0 = Math.trunc(u);
        const y0 = Math.trunc(v);
        const x1 = x0 >= wLast ? wLast : x0 + 1;
        const y1 = y0 >= hLast ? hLast : y0 + 1;
        const fracX = u - x0;
        const fracY = v - y0;
        const idx = (y0 * srcW + x0) * sc;
        const stepX = (x1 - x0) * sc;
        const stepY = (y1 - y0) * srcW * sc;
        const g00 = srcGray[idx];
        const g10 = srcGray[idx + stepX];
        const g01 = srcGray[idx + stepY];
        const g11 = srcGray[idx + stepY + stepX];
        const top = g00 + (g10 - g00) * fracX;
        const bottom = g01 + (g11 - g01) * fracX;
        out[rowBase + x] = Math.round(top + (bottom - top) * fracY);
      }
    }
    return { gray: out, width: ow, height: oh };
  }
}
