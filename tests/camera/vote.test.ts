// Bỏ phiếu đa số giữa các khung hình khi chấm live.
// Không có tương ứng Dart (Flutter chấm 1 ảnh); xem src/camera/vote.ts.

import { describe, expect, it } from 'vitest';

import { voteBest } from '../../src/camera/vote';

interface Frame {
  id: number;
  sig: string;
  verified: boolean;
}

function frames(...specs: [number, string, boolean][]): Frame[] {
  return specs.map(([id, sig, verified]) => ({ id, sig, verified }));
}

const bySignature = (frame: Frame): string => frame.sig;
const isVerified = (frame: Frame): boolean => frame.verified;

describe('voteBest', () => {
  it('trả null khi không có khung', () => {
    expect(voteBest([], bySignature, isVerified)).toBeNull();
  });

  it('chọn nhóm có nhiều khung trùng nhất', () => {
    const result = voteBest(
      frames([1, 'A', false], [2, 'B', true], [3, 'B', false]),
      bySignature,
      isVerified
    );
    expect(result?.chosen.id).toBe(2);
    expect(result?.signature).toBe('B');
    expect(result?.agreement).toBeCloseTo(2 / 3, 8);
  });

  it('hòa phiếu thì ưu tiên nhóm có khung đã kiểm chứng mốc', () => {
    const result = voteBest(
      frames([1, 'A', false], [2, 'B', true]),
      bySignature,
      isVerified
    );
    expect(result?.chosen.id).toBe(2);
    expect(result?.agreement).toBe(0.5);
  });

  it('hòa cả phiếu lẫn kiểm chứng thì giữ khung xuất hiện sớm nhất', () => {
    const result = voteBest(
      frames([1, 'A', false], [2, 'B', false]),
      bySignature,
      isVerified
    );
    expect(result?.chosen.id).toBe(1);
  });

  it('chữ ký lấy từ signatureOf, không dùng thuộc tính khác của item', () => {
    const result = voteBest(
      frames([1, 'X', false], [2, 'Y', false]),
      (frame) => `sig-${frame.id}`,
      isVerified
    );
    expect(result?.chosen.id).toBe(1);
    expect(result?.agreement).toBe(0.5);
  });
});
