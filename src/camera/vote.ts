// Bỏ phiếu đa số trên kết quả nhiều khung hình (yêu cầu bước 4).
// Không thuộc Dart: Flutter chụp 1 ảnh/lần; web chụp N khung rồi chọn kết quả
// trùng nhau nhiều nhất để giảm nhiễu rung tay.
//
// Chữ ký gồm SBD + mã đề + dãy đáp án. Hòa phiếu → ưu tiên khung qua kiểm
// chứng mốc (verification.passed), sau đó giữ khung xuất hiện sớm nhất.

export interface VoteResult<T> {
  chosen: T;
  /** Số khung cùng chữ ký với khung được chọn / tổng số khung. */
  agreement: number;
  /** Chữ ký của khung được chọn. */
  signature: string;
}

export function voteBest<T>(
  items: T[],
  signatureOf: (item: T) => string,
  verifiedOf: (item: T) => boolean = () => false
): VoteResult<T> | null {
  if (items.length === 0) return null;

  const groups = new Map<
    string,
    { count: number; verifiedCount: number; firstIndex: number; item: T }
  >();
  items.forEach((item, index) => {
    const signature = signatureOf(item);
    const group = groups.get(signature);
    if (group) {
      group.count += 1;
      if (verifiedOf(item)) group.verifiedCount += 1;
    } else {
      groups.set(signature, {
        count: 1,
        verifiedCount: verifiedOf(item) ? 1 : 0,
        firstIndex: index,
        item
      });
    }
  });

  let best: {
    signature: string;
    count: number;
    verifiedCount: number;
    firstIndex: number;
    item: T;
  } | null = null;
  for (const [signature, group] of groups) {
    if (
      best === null ||
      group.count > best.count ||
      (group.count === best.count && group.verifiedCount > best.verifiedCount) ||
      (group.count === best.count &&
        group.verifiedCount === best.verifiedCount &&
        group.firstIndex < best.firstIndex)
    ) {
      best = { signature, ...group };
    }
  }
  if (!best) return null;
  return {
    chosen: best.item,
    agreement: best.count / items.length,
    signature: best.signature
  };
}
