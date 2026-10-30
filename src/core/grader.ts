// Nguồn Dart: lib/domain/services/grader.dart (dòng 7–152).

import { AnswerKey, Contest } from './types';
import { OmrDecoder } from './omrDecoder';
import { ScoringRule } from './scoringRule';

export class GradingResult {
  constructor(
    public readonly correctFlags: readonly (boolean | null)[],
    public readonly score: number,
    public readonly partScores: Readonly<Record<string, number>> = {}
  ) {}

  get correctCount(): number {
    return this.correctFlags.filter((f) => f === true).length;
  }

  get incorrectCount(): number {
    return this.correctFlags.filter((f) => f === false).length;
  }

  get unansweredCount(): number {
    return this.correctFlags.filter((f) => f === null).length;
  }
}

export class Grader {
  grade(
    rule: ScoringRule,
    correctFlags: (boolean | null)[],
    partScores: Record<string, number> = {}
  ): GradingResult {
    let sum = 0;
    for (let i = 0; i < correctFlags.length; i++) {
      if (correctFlags[i] === true) sum += rule.weightAt(i);
    }
    return new GradingResult([...correctFlags], Grader.round2(sum), { ...partScores });
  }

  gradeForContest(contest: Contest, keyAnswers: string, chosen: (string | null)[]): GradingResult {
    const rule = ScoringRule.forContest(contest);
    const flags = this.computeFlags(rule, keyAnswers, chosen);
    const partScores = this.computePartScores(contest, rule, flags);
    return this.grade(rule, flags, partScores);
  }

  computeFlags(
    rule: ScoringRule,
    keyAnswers: string,
    chosen: (string | null)[]
  ): (boolean | null)[] {
    const key = keyAnswers.trim().toUpperCase();
    const flags: (boolean | null)[] = [];
    for (let i = 0; i < rule.questionCount; i++) {
      const keyChar = i < key.length ? key[i] : '';
      const valid = /[A-Z]/.test(keyChar);
      if (!valid) {
        flags.push(null);
        continue;
      }
      const pick = i < chosen.length ? chosen[i] : null;
      flags.push(pick == null ? null : pick.toUpperCase() === keyChar);
    }
    return flags;
  }

  computePartScores(
    contest: Contest,
    rule: ScoringRule,
    flags: (boolean | null)[]
  ): Record<string, number> {
    if (contest.formType !== 'ministry') return {};
    const p1 = contest.partOneCount;
    const p2 = contest.partTwoCount;
    const p3 = contest.partThreeCount;
    if (p1 == null || p2 == null || p3 == null) return {};

    const parts: [string, number][] = [
      ['1', p1],
      ['2', p2],
      ['3', p3]
    ];
    const scores: Record<string, number> = {};
    let start = 0;
    for (const [key, count] of parts) {
      let partSum = 0;
      const end = Math.min(Math.max(start + count, 0), flags.length);
      for (let i = start; i < end; i++) {
        if (flags[i] === true) partSum += rule.weightAt(i);
      }
      scores[key] = Grader.round2(partSum);
      start += count;
    }
    return scores;
  }

  static round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  static selectKey(keys: AnswerKey[], decodedExamCode: string): AnswerKey | null {
    const target = OmrDecoder.normalizeCode(decodedExamCode);
    if (target.length === 0 || target.includes('?')) return null;
    for (const key of keys) {
      if (OmrDecoder.normalizeCode(key.examCode) === target) return key;
    }
    return null;
  }

  static bestScoringKey(keys: AnswerKey[], chosen: (string | null)[]): AnswerKey | null {
    if (keys.length === 0) return null;
    let best: AnswerKey | null = null;
    let bestCorrect = -1;
    for (const key of keys) {
      const seq = key.answerSequence.toUpperCase();
      let correct = 0;
      for (let i = 0; i < seq.length && i < chosen.length; i++) {
        if (chosen[i] != null && chosen[i]!.toUpperCase() === seq[i]) correct++;
      }
      if (correct > bestCorrect) {
        bestCorrect = correct;
        best = key;
      }
    }
    return best;
  }
}
