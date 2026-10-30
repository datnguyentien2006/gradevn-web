// Nguồn Dart: lib/domain/services/omr_decoder.dart (dòng 5–213).

import { SheetSpec } from './types';

/** Ma trận mật độ mực (0..1). `values[row][col]`. */
export class DensityBlock {
  constructor(public readonly values: number[][]) {
    if (values.length === 0 || values.some((row) => row.length === 0)) {
      throw new Error('Khối mật độ phải có ít nhất 1 hàng và không có hàng rỗng.');
    }
  }

  get rows(): number {
    return this.values.length;
  }

  get columns(): number {
    return this.values[0].length;
  }

  at(row: number, col: number): number {
    return this.values[row][col];
  }
}

export class DecodedBlock {
  constructor(
    public readonly answers: (string | null)[],
    public readonly confidences: number[]
  ) {}
}

const LETTERS = 'ABCDEFGHIJ';

export class OmrDecoder {
  constructor(public readonly markThreshold = 0.3) {}

  /**
   * [spec] giữ trong chữ ký để tương ứng Dart; hiện decoder không dùng
   * (số lựa chọn nằm ở số cột của từng block).
   */
  decodeAnswers(
    blocks: DensityBlock[],
    spec: SheetSpec,
    totalQuestions: number,
    rowsPerAnswerBlock = 10
  ): (string | null)[] {
    void spec;
    const result: (string | null)[] = Array.from({ length: totalQuestions }, () => null);
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      for (let row = 0; row < block.rows; row++) {
        const questionIndex = b * rowsPerAnswerBlock + row;
        if (questionIndex >= totalQuestions) break;
        result[questionIndex] = this.decodeChoiceRow(block, row);
      }
    }
    return result;
  }

  decodeBlock(block: DensityBlock): DecodedBlock {
    const answers: (string | null)[] = [];
    const confidences: number[] = [];
    for (let row = 0; row < block.rows; row++) {
      answers.push(this.decodeChoiceRow(block, row));
      confidences.push(this.maxOfRow(block, row));
    }
    return new DecodedBlock(answers, confidences);
  }

  decodeChoiceRow(block: DensityBlock, row: number): string | null {
    let bestCol = -1;
    let bestDensity = -1;
    for (let col = 0; col < block.columns; col++) {
      const d = block.at(row, col);
      if (d > bestDensity) {
        bestDensity = d;
        bestCol = col;
      }
    }
    if (bestCol < 0 || bestDensity < this.markThreshold) return null;
    return bestCol < LETTERS.length ? LETTERS[bestCol] : null;
  }

  private maxOfRow(block: DensityBlock, row: number): number {
    let best = 0;
    for (let col = 0; col < block.columns; col++) {
      if (block.at(row, col) > best) best = block.at(row, col);
    }
    return best;
  }

  /**
   * Giải mã một lưới chữ số: hàng = vị trí chữ số, cột = giá trị 0..9.
   * Cần đồng thời ≥ markThreshold và ≥ 2× trung bình các cột còn lại.
   */
  decodeDigits(grid: DensityBlock): string {
    let out = '';
    for (let row = 0; row < grid.rows; row++) {
      let bestCol = -1;
      let bestDensity = -1;
      let restSum = 0;
      for (let col = 0; col < grid.columns; col++) {
        const d = grid.at(row, col);
        if (d > bestDensity) {
          if (bestCol >= 0) restSum += bestDensity;
          bestDensity = d;
          bestCol = col;
        } else {
          restSum += d;
        }
      }
      const restMean = grid.columns > 1 ? restSum / (grid.columns - 1) : 0;
      const confident = bestDensity >= this.markThreshold && bestDensity >= 2 * restMean;
      out += confident ? String(bestCol) : '?';
    }
    return out;
  }

  static countMultiMarkAnswers(
    blocks: DensityBlock[],
    totalQuestions: number,
    rowsPerAnswerBlock = 10,
    doubleMarkThreshold = 0.55
  ): number {
    let count = 0;
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      for (let row = 0; row < block.rows; row++) {
        const questionIndex = b * rowsPerAnswerBlock + row;
        if (questionIndex >= totalQuestions) break;
        const densities: number[] = [];
        for (let c = 0; c < block.columns; c++) densities.push(block.at(row, c));
        densities.sort((a, b2) => b2 - a);
        const dark = densities.filter((d) => d >= doubleMarkThreshold).length;
        if (dark >= 2) count++;
      }
    }
    return count;
  }

  static normalizeCode(raw: string): string {
    const cleaned = raw.trim().toUpperCase();
    if (cleaned.length === 0) return '';
    if (/^\d+$/.test(cleaned)) {
      const stripped = cleaned.replace(/^0+/, '');
      return stripped.length === 0 ? '0' : stripped;
    }
    return cleaned;
  }

  static isBlankCode(raw: string): boolean {
    return !/[0-9]/.test(raw);
  }

  /** R23 — SBD phải giữ số 0 đầu. */
  static normalizeStudentCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, '');
  }

  static studentCodeKey(raw: string): string {
    const cleaned = OmrDecoder.normalizeStudentCode(raw);
    if (cleaned.length === 0) return '';
    if (/^\d+$/.test(cleaned)) {
      const stripped = cleaned.replace(/^0+/, '');
      return stripped.length === 0 ? '0' : stripped;
    }
    return cleaned;
  }

  static sameStudentCode(a: string, b: string): boolean {
    if (a.trim().length === 0 || b.trim().length === 0) return false;
    return OmrDecoder.studentCodeKey(a) === OmrDecoder.studentCodeKey(b);
  }
}
