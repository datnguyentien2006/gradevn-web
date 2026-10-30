// Nguồn Dart: lib/domain/services/sheet_layout.dart (dòng 11–238).

import { Offset, Rect, Size } from './geometry';
import { SheetSpec } from './types';
import { SheetTemplate } from './sheetTemplate';

export class AnswerBlockGeometry {
  constructor(
    public readonly firstQuestionIndex: number,
    public readonly rows: number,
    public readonly columns: number,
    public readonly firstColCenterX: number,
    public readonly colPitch: number,
    public readonly row0CenterY: number,
    public readonly rowPitch: number,
    public readonly cellSize: number
  ) {}

  center(row: number, col: number): Offset {
    return new Offset(
      this.firstColCenterX + col * this.colPitch,
      this.row0CenterY + row * this.rowPitch
    );
  }

  cellRect(row: number, col: number): Rect {
    return Rect.fromCenter(this.center(row, col), this.cellSize, this.cellSize);
  }
}

export class DigitGridGeometry {
  constructor(
    public readonly slotCenters: readonly number[],
    public readonly valueRowCenters: readonly number[],
    public readonly cellSize: number
  ) {}

  get slots(): number {
    return this.slotCenters.length;
  }

  get rows(): number {
    return this.valueRowCenters.length;
  }

  center(slot: number, value: number): Offset {
    return new Offset(this.slotCenters[slot], this.valueRowCenters[value]);
  }

  cellRect(slot: number, value: number): Rect {
    return Rect.fromCenter(this.center(slot, value), this.cellSize, this.cellSize);
  }
}

export class SheetLayout {
  private constructor(
    public readonly template: SheetTemplate,
    public readonly page: Size,
    public readonly spec: SheetSpec | null,
    public readonly answerBlocks: readonly AnswerBlockGeometry[],
    public readonly studentCodeGrid: DigitGridGeometry,
    public readonly examCodeGrid: DigitGridGeometry,
    public readonly totalQuestions: number
  ) {}

  static forSpec(spec: SheetSpec, page: Size): SheetLayout {
    return SheetLayout.forTemplate(SheetTemplate.tn40Standard, page, spec);
  }

  static forTemplate(template: SheetTemplate, page: Size, spec: SheetSpec | null = null): SheetLayout {
    if (template.answerGroups.length === 0) {
      throw new Error('Template phải có ít nhất một nhóm đáp án.');
    }
    const sx = page.width / template.pageWidthUnits;
    const sy = page.height / template.pageHeightUnits;

    const pagePoint = (relX: number, relY: number): Offset =>
      new Offset(
        (SheetTemplate.pageMarginX + relX) * sx,
        (SheetTemplate.pageMarginY + relY) * sy
      );

    const choices = spec?.answerChoices ?? template.answerGroups[0].columns;
    const blocks = template.answerGroups.map(
      (group) =>
        new AnswerBlockGeometry(
          group.firstQuestion,
          group.rows,
          Math.min(choices, group.columns),
          pagePoint(group.colX[0], 0).dx,
          pitch(group.colX) * sx,
          pagePoint(0, group.row0Y).dy,
          group.rowPitch * sy,
          template.bubbleDiameter * sx
        )
    );

    const digitGrid = (slotCols: readonly number[]): DigitGridGeometry =>
      new DigitGridGeometry(
        slotCols.map((relX) => pagePoint(relX, 0).dx),
        Array.from({ length: template.digitValueRows }, (_, v) =>
          pagePoint(0, template.digitValueRowY(v)).dy
        ),
        template.bubbleDiameter * sx
      );

    const total = spec == null ? template.totalQuestions : SheetLayout.totalQuestionsFor(spec);

    return new SheetLayout(
      template,
      page,
      spec,
      blocks,
      digitGrid(template.sbdSlotCols),
      digitGrid(template.examSlotCols),
      total
    );
  }

  static totalQuestionsFor(spec: SheetSpec): number {
    if (spec.formType === 'ministry') {
      return (spec.partOneCount ?? 0) + (spec.partTwoCount ?? 0) + (spec.partThreeCount ?? 0);
    }
    return spec.questionCount;
  }

  /** Trang chuẩn của pipeline: 1576 × 2205. */
  static get standardPage(): Size {
    return new Size(1576, 2205);
  }

  get specOrDefault(): SheetSpec {
    return (
      this.spec ?? {
        formType: 'standard',
        orientation: 'portrait',
        questionCount: 40,
        answerChoices: 4,
        maxScore: 10
      }
    );
  }

  /** Hệ số quy đổi template → trang chuẩn (theo chiều rộng). */
  get scale(): number {
    return this.page.width / this.template.pageWidthUnits;
  }

  get rowsPerAnswerBlock(): number {
    return this.answerBlocks[0].rows;
  }

  toPage(relX: number, relY: number): Offset {
    return new Offset(
      (SheetTemplate.pageMarginX + relX) * (this.page.width / this.template.pageWidthUnits),
      (SheetTemplate.pageMarginY + relY) * (this.page.height / this.template.pageHeightUnits)
    );
  }

  get cornerMarkerCenters(): Offset[] {
    return [
      this.toPage(0, 0),
      this.toPage(this.template.frameWidth, 0),
      this.toPage(this.template.frameWidth, this.template.frameHeight),
      this.toPage(0, this.template.frameHeight)
    ];
  }

  answerCellRect(questionIndex: number, choiceIndex: number): Rect {
    for (const block of this.answerBlocks) {
      const row = questionIndex - block.firstQuestionIndex;
      if (row >= 0 && row < block.rows) {
        return block.cellRect(row, choiceIndex);
      }
    }
    throw new RangeError(`Câu ${questionIndex} nằm ngoài bố cục phiếu.`);
  }
}

function pitch(centers: readonly number[]): number {
  return centers.length < 2 ? 0 : (centers[centers.length - 1] - centers[0]) / (centers.length - 1);
}
