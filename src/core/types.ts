// Entity/value-object tối thiểu dùng cho lõi chấm điểm.
// Nguồn Dart: lib/domain/entities/{sheet_spec,contest,class_room}.dart.

export type SheetFormType = 'standard' | 'fifty' | 'hundred20' | 'ministry';
export type SheetOrientation = 'portrait' | 'landscape';

export interface SheetGeometry {
  readonly columnCells: number;
  readonly rowCells: number;
  readonly cellInsetRatio: number;
}

export interface SheetSpec {
  formType: SheetFormType;
  orientation: SheetOrientation;
  questionCount: number;
  answerChoices: number;
  maxScore: number;
  partOneCount?: number | null;
  partTwoCount?: number | null;
  partThreeCount?: number | null;
  partOneWeight?: number | null;
  partTwoWeight?: number | null;
  partThreeWeight?: number | null;
}

export interface Contest {
  id: number;
  name: string;
  examDate: Date | string;
  classRoomId?: number | null;
  questionCount: number;
  answerChoices: number;
  maxScore: number;
  formType: SheetFormType;
  orientation: SheetOrientation;
  partOneCount?: number | null;
  partTwoCount?: number | null;
  partThreeCount?: number | null;
  partOneWeight?: number | null;
  partTwoWeight?: number | null;
  partThreeWeight?: number | null;
}

export interface AnswerKey {
  id: number;
  contestId: number;
  examCode: string;
  answerSequence: string;
  createdAt?: Date | null;
}

export interface Student {
  id: number;
  classId: number;
  code: string;
  fullName: string;
}

export interface ClassRoom {
  id: number;
  name: string;
  description?: string | null;
}

/** Nguồn Dart: lib/domain/entities/graded_sheet.dart. */
export interface GradedSheet {
  id: number;
  contestId: number;
  examCode: string;
  studentCode: string;
  chosen: string;
  correctFlags: string;
  score: number;
  keyId?: number | null;
  studentId?: number | null;
  partScores: Record<string, number>;
  originalImagePath?: string | null;
  markedImagePath?: string | null;
  infoImagePath?: string | null;
  gradedAt: string | Date;
}

export function contestSheetSpec(contest: Contest): SheetSpec {
  return {
    formType: contest.formType,
    orientation: contest.orientation,
    questionCount: contest.questionCount,
    answerChoices: contest.answerChoices,
    maxScore: contest.maxScore,
    partOneCount: contest.partOneCount,
    partTwoCount: contest.partTwoCount,
    partThreeCount: contest.partThreeCount,
    partOneWeight: contest.partOneWeight,
    partTwoWeight: contest.partTwoWeight,
    partThreeWeight: contest.partThreeWeight
  };
}
