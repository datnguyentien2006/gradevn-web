// Hình học cơ bản tương ứng `dart:ui` Offset / Size / Rect.
// Nguồn Dart: lib/domain/services/sheet_layout.dart, lib/data/cv/sheet_alignment.dart.

export class Offset {
  constructor(
    public readonly dx: number,
    public readonly dy: number
  ) {}

  distanceTo(other: Offset): number {
    return Math.hypot(this.dx - other.dx, this.dy - other.dy);
  }

  add(other: Offset): Offset {
    return new Offset(this.dx + other.dx, this.dy + other.dy);
  }

  subtract(other: Offset): Offset {
    return new Offset(this.dx - other.dx, this.dy - other.dy);
  }
}

export class Size {
  constructor(
    public readonly width: number,
    public readonly height: number
  ) {}
}

export class Rect {
  constructor(
    public readonly left: number,
    public readonly top: number,
    public readonly right: number,
    public readonly bottom: number
  ) {}

  static fromLTRB(left: number, top: number, right: number, bottom: number): Rect {
    return new Rect(left, top, right, bottom);
  }

  static fromCenter(center: Offset, width: number, height: number): Rect {
    const hw = width / 2;
    const hh = height / 2;
    return new Rect(center.dx - hw, center.dy - hh, center.dx + hw, center.dy + hh);
  }

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }

  get center(): Offset {
    return new Offset((this.left + this.right) / 2, (this.top + this.bottom) / 2);
  }

  get topLeft(): Offset {
    return new Offset(this.left, this.top);
  }

  get bottomRight(): Offset {
    return new Offset(this.right, this.bottom);
  }

  /** Flutter Rect.contains: nửa khoảng [left,right) × [top,bottom). */
  contains(p: Offset): boolean {
    return p.dx >= this.left && p.dx < this.right && p.dy >= this.top && p.dy < this.bottom;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Phóng chữ nhật TỈ LỆ quanh tâm, kẹp [0..1] — port `expandFractionRect`. */
export function expandFractionRect(r: Rect, factor: number): Rect {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hw = (r.width / 2) * factor;
  const hh = (r.height / 2) * factor;
  return new Rect(
    clamp(cx - hw, 0, 1),
    clamp(cy - hh, 0, 1),
    clamp(cx + hw, 0, 1),
    clamp(cy + hh, 0, 1)
  );
}

/** 4 tâm mốc [tl, tr, br, bl]. */
export class AlignmentQuad {
  constructor(
    public readonly tl: Offset,
    public readonly tr: Offset,
    public readonly br: Offset,
    public readonly bl: Offset
  ) {}

  get corners(): Offset[] {
    return [this.tl, this.tr, this.br, this.bl];
  }
}
