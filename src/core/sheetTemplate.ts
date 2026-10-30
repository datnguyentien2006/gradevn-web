// Nguồn Dart: lib/domain/services/sheet_template.dart (dòng 11–168).
// Toạ độ đo từ phiếu TN40 tham chiếu; đơn vị = px ảnh scan 3125×4421.

import { Offset, Size } from './geometry';

export class AnswerGroupSpec {
  constructor(
    public readonly firstQuestion: number,
    public readonly colX: number[],
    public readonly row0Y: number,
    public readonly rowPitch: number
  ) {}

  get rows(): number {
    return 10;
  }

  get columns(): number {
    return this.colX.length;
  }
}

export interface SheetTemplateInit {
  id: string;
  frameWidth: number;
  frameHeight: number;
  markerSide: number;
  smallMarkerSide: number;
  bubbleDiameter: number;
  digitValueRows: number;
  studentSlots: number;
  examSlots: number;
  sbdSlotCols: number[];
  examSlotCols: number[];
  answerGroups: AnswerGroupSpec[];
  extraMarkers?: Offset[];
}

export class SheetTemplate {
  static readonly pageMarginX = 420;
  static readonly pageMarginY = 500;
  static readonly digitRow0Y = 1008.5;
  static readonly digitRowPitch = 108.6;

  readonly id: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly markerSide: number;
  readonly smallMarkerSide: number;
  readonly bubbleDiameter: number;
  readonly digitValueRows: number;
  readonly studentSlots: number;
  readonly examSlots: number;
  readonly sbdSlotCols: readonly number[];
  readonly examSlotCols: readonly number[];
  readonly answerGroups: readonly AnswerGroupSpec[];
  readonly extraMarkers: readonly Offset[];

  constructor(init: SheetTemplateInit) {
    this.id = init.id;
    this.frameWidth = init.frameWidth;
    this.frameHeight = init.frameHeight;
    this.markerSide = init.markerSide;
    this.smallMarkerSide = init.smallMarkerSide;
    this.bubbleDiameter = init.bubbleDiameter;
    this.digitValueRows = init.digitValueRows;
    this.studentSlots = init.studentSlots;
    this.examSlots = init.examSlots;
    this.sbdSlotCols = init.sbdSlotCols;
    this.examSlotCols = init.examSlotCols;
    this.answerGroups = init.answerGroups;
    this.extraMarkers = init.extraMarkers ?? [];
  }

  get cornerMarkers(): Offset[] {
    return [
      new Offset(0, 0),
      new Offset(this.frameWidth, 0),
      new Offset(this.frameWidth, this.frameHeight),
      new Offset(0, this.frameHeight)
    ];
  }

  get pageWidthUnits(): number {
    return this.frameWidth + 2 * SheetTemplate.pageMarginX;
  }

  get pageHeightUnits(): number {
    return this.frameHeight + 2 * SheetTemplate.pageMarginY;
  }

  get totalQuestions(): number {
    return this.answerGroups.reduce((sum, g) => sum + g.rows, 0);
  }

  digitValueRowY(value: number): number {
    return SheetTemplate.digitRow0Y + value * SheetTemplate.digitRowPitch;
  }

  static get tn40Standard(): SheetTemplate {
    return TN40_STANDARD;
  }
}

const TN40_STANDARD = new SheetTemplate({
  id: 'tn40',
  frameWidth: 2311,
  frameHeight: 3409,
  markerSide: 87,
  smallMarkerSide: 63,
  bubbleDiameter: 80,
  digitValueRows: 10,
  studentSlots: 6,
  examSlots: 3,
  sbdSlotCols: [308.5, 402.0, 495.5, 589.0, 682.5, 776.0],
  examSlotCols: [978.5, 1072.0, 1165.5],
  answerGroups: [
    new AnswerGroupSpec(0, [1552.0, 1645.5, 1739.0, 1832.5], 1008.5, 108.6),
    new AnswerGroupSpec(10, [405.5, 498.3, 591.2, 684.0], 2207.0, 108.7),
    new AnswerGroupSpec(20, [978.5, 1071.8, 1165.2, 1258.5], 2207.0, 108.7),
    new AnswerGroupSpec(30, [1552.0, 1645.5, 1739.0, 1832.5], 2207.0, 108.7)
  ],
  extraMarkers: [
    new Offset(0, 1705),
    new Offset(2311, 1705),
    new Offset(871, 904.5),
    new Offset(1448, 904.5),
    new Offset(871, 2101.5),
    new Offset(1448, 2101.5),
    new Offset(871, 3297),
    new Offset(1448, 3297)
  ]
});

export const TN40_PAGE_SIZE = new Size(
  TN40_STANDARD.pageWidthUnits,
  TN40_STANDARD.pageHeightUnits
);
