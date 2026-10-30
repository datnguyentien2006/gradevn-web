// Nguồn Dart: lib/domain/value_objects/scoring_rule.dart (dòng 6–70).

import { Contest } from './types';

export class ScoringRule {
  private constructor(
    private readonly weights: readonly number[],
    public readonly isUniform: boolean
  ) {}

  static uniform(questionCount: number, maxScore: number): ScoringRule {
    const w = maxScore / questionCount;
    return new ScoringRule(Array.from({ length: questionCount }, () => w), true);
  }

  static weighted(weights: number[]): ScoringRule {
    return new ScoringRule([...weights], false);
  }

  static forContest(contest: Contest): ScoringRule {
    if (
      contest.formType === 'ministry' &&
      contest.partOneCount != null &&
      contest.partTwoCount != null &&
      contest.partThreeCount != null &&
      contest.partOneWeight != null &&
      contest.partTwoWeight != null &&
      contest.partThreeWeight != null
    ) {
      const weights: number[] = [];
      const segments: [number, number][] = [
        [contest.partOneCount, contest.partOneWeight / contest.partOneCount],
        [contest.partTwoCount, contest.partTwoWeight / contest.partTwoCount],
        [contest.partThreeCount, contest.partThreeWeight / contest.partThreeCount]
      ];
      for (const [count, perQuestion] of segments) {
        for (let i = 0; i < count; i++) weights.push(perQuestion);
      }
      return ScoringRule.weighted(weights);
    }
    return ScoringRule.uniform(contest.questionCount, contest.maxScore);
  }

  weightAt(questionIndex: number): number {
    return this.weights[questionIndex];
  }

  get questionCount(): number {
    return this.weights.length;
  }

  get maxTotal(): number {
    return this.weights.reduce((a, b) => a + b, 0);
  }
}
