import { describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { Grade } from './schemas';
import {
  applyGrade,
  fromDbState,
  GRADE_LABELS,
  GRADES,
  newCardScheduling,
  previewSchedule,
  projectCard,
  toDbState,
  toFsrsRating,
  type CardScheduling,
  type FsrsStateName,
} from './fsrs';

/**
 * The scheduler is the part of this app that must be right (SPEC §11). These
 * tests exist for two failures that are invisible in the UI: an enum mapped to
 * the wrong string, and intervals that look plausible one step at a time but
 * diverge over a week.
 */

const NOW = new Date('2026-05-01T09:00:00Z');

function cardInState(state: FsrsStateName): CardScheduling {
  if (state === 'new') return newCardScheduling(NOW);
  return {
    fsrs_state: state,
    stability: 12.5,
    difficulty: 5.2,
    due: NOW.toISOString(),
    last_review: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
    reps: 4,
    lapses: 1,
    scheduled_days: 3,
    elapsed_days: 3,
    learning_steps: 0,
  };
}

// ---------------------------------------------------------------------------

describe('enum mapping', () => {
  it('maps every ts-fsrs State to its database string and back', () => {
    const pairs: Array<[State, FsrsStateName]> = [
      [State.New, 'new'],
      [State.Learning, 'learning'],
      [State.Review, 'review'],
      [State.Relearning, 'relearning'],
    ];
    for (const [state, name] of pairs) {
      expect(toDbState(state)).toBe(name);
      expect(fromDbState(name)).toBe(state);
    }
    // Nothing left unmapped: State is a 4-member numeric enum.
    expect(pairs).toHaveLength(Object.keys(State).length / 2);
  });

  it('maps every grade to the ts-fsrs Rating with the same number', () => {
    expect(toFsrsRating(Grade.Again)).toBe(Rating.Again);
    expect(toFsrsRating(Grade.Hard)).toBe(Rating.Hard);
    expect(toFsrsRating(Grade.Good)).toBe(Rating.Good);
    expect(toFsrsRating(Grade.Easy)).toBe(Rating.Easy);
    // The DB stores the integer directly (reviews.rating 1..4), so the numeric
    // values must agree, not merely the names.
    for (const grade of GRADES) {
      expect(Number(toFsrsRating(grade))).toBe(Number(grade));
    }
  });

  it('never emits a state string the fsrs_state enum does not have', () => {
    const allowed = new Set<FsrsStateName>(['new', 'learning', 'review', 'relearning']);
    for (const state of ['new', 'learning', 'review', 'relearning'] as const) {
      for (const grade of GRADES) {
        const { next, log } = applyGrade(cardInState(state), grade, NOW);
        expect(allowed.has(next.fsrs_state)).toBe(true);
        expect(log.state_after).toBe(next.fsrs_state);
        expect(log.state_before).toBe(state);
      }
    }
  });
});

describe('every grade from every state', () => {
  for (const state of ['new', 'learning', 'review', 'relearning'] as const) {
    for (const grade of GRADES) {
      it(`${state} + ${GRADE_LABELS[grade]} produces a writable row`, () => {
        const card = cardInState(state);
        const { next, log } = applyGrade(card, grade, NOW, { durationMs: 1500 });

        // Column constraints from the init migration. A violation here surfaces
        // in production as a failed rating, not as a wrong interval.
        expect(next.stability).toBeGreaterThan(0);
        expect(next.difficulty).toBeGreaterThanOrEqual(1);
        expect(next.difficulty).toBeLessThanOrEqual(10);
        expect(Number.isInteger(next.scheduled_days)).toBe(true);
        expect(next.scheduled_days).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(next.elapsed_days)).toBe(true);
        expect(next.elapsed_days).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(next.learning_steps)).toBe(true);

        // A reviewed card is never `new` again, and it always moves forward.
        expect(next.fsrs_state).not.toBe('new');
        expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime());
        expect(new Date(next.last_review).getTime()).toBe(NOW.getTime());

        // The log carries the before-state for undo (SPEC §5.4).
        expect(log.due_before).toBe(card.due);
        expect(log.stability_before).toBe(card.stability);
        expect(log.difficulty_before).toBe(card.difficulty);
        expect(log.learning_steps_before).toBe(card.learning_steps);
        expect(log.last_review_before).toBe(card.last_review);
        expect(log.rating).toBe(grade);
        expect(log.duration_ms).toBe(1500);
      });
    }
  }

  it('orders the four outcomes Again <= Hard <= Good <= Easy', () => {
    for (const state of ['new', 'learning', 'review', 'relearning'] as const) {
      const preview = previewSchedule(cardInState(state), NOW);
      const intervals = GRADES.map(grade => preview[grade].intervalMs);
      expect(intervals[0]).toBeLessThanOrEqual(intervals[1]!);
      expect(intervals[1]).toBeLessThanOrEqual(intervals[2]!);
      expect(intervals[2]).toBeLessThanOrEqual(intervals[3]!);
    }
  });
});

describe('previewSchedule', () => {
  it('describes all four buttons before the user commits', () => {
    const preview = previewSchedule(cardInState('review'), NOW);
    for (const grade of GRADES) {
      expect(preview[grade].grade).toBe(grade);
      expect(preview[grade].intervalMs).toBeGreaterThan(0);
      expect(preview[grade].due.getTime()).toBe(
        NOW.getTime() + preview[grade].intervalMs,
      );
    }
    expect(preview[Grade.Good].label).toBe('Good');
  });

  it('commits exactly the interval it showed, despite fuzz', () => {
    // Committing the preview the user was shown, rather than recomputing on
    // click, is what makes "Good → 4d" a statement about what will happen.
    const card = cardInState('review');
    const preview = previewSchedule(card, NOW);
    const { next } = applyGrade(card, Grade.Good, NOW, { preview });
    expect(next.due).toBe(preview[Grade.Good].due.toISOString());
  });

  it('scatters cards that would otherwise share a due date', () => {
    // The point of fuzz (SPEC §6): a batch of cards accepted together and rated
    // together must not come back as one wall on the same day, forever.
    const long: CardScheduling = {
      ...cardInState('review'),
      stability: 240,
      difficulty: 5,
      scheduled_days: 200,
    };
    const dues = new Set(
      Array.from(
        { length: 12 },
        (_, index) => previewSchedule({ ...long, reps: index + 1 }, NOW)[Grade.Good].due,
      ).map(due => due.getTime()),
    );
    expect(dues.size).toBeGreaterThan(6);
  });

  it('is deterministic for one card, so a preview is not a promise it breaks', () => {
    // ts-fsrs seeds the fuzz from the card, not from a global RNG. That is what
    // makes the optimistic UI honest: the same card asked twice answers twice
    // the same.
    const card = cardInState('review');
    const first = previewSchedule(card, NOW);
    const second = previewSchedule(card, NOW);
    for (const grade of GRADES) {
      expect(second[grade].due).toEqual(first[grade].due);
    }
  });
});

describe('a simulated week', () => {
  /** Review the card whenever it falls due, always answering `grade`. */
  function simulate(grade: Grade, days: number) {
    let card = newCardScheduling(NOW);
    const steps: Array<{ at: Date; scheduled_days: number; state: FsrsStateName }> = [];
    const end = new Date(NOW.getTime() + days * 86_400_000);

    let now = NOW;
    let guard = 0;
    while (now <= end && guard < 200) {
      guard += 1;
      const result = applyGrade(card, grade, now);
      card = projectCard(card, result);
      steps.push({
        at: now,
        scheduled_days: result.next.scheduled_days,
        state: result.next.fsrs_state,
      });
      now = new Date(card.due);
    }
    return { card, steps };
  }

  it('grows intervals when everything is Good', () => {
    const { card, steps } = simulate(Grade.Good, 7);

    // It graduates out of learning rather than looping on the 10m step forever —
    // which is what happens if learning_steps is not persisted between reviews.
    expect(steps.some(step => step.state === 'review')).toBe(true);
    expect(card.fsrs_state).toBe('review');

    const dayIntervals = steps.filter(step => step.scheduled_days > 0);
    expect(dayIntervals.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < dayIntervals.length; i += 1) {
      expect(dayIntervals[i]!.scheduled_days).toBeGreaterThan(
        dayIntervals[i - 1]!.scheduled_days,
      );
    }
    expect(card.lapses).toBe(0);
    expect(card.reps).toBe(steps.length);
    expect(card.stability).toBeGreaterThan(1);
  });

  it('rewards a week of Easy more than a week of Good, and Good more than Hard', () => {
    // Reviewed on a fixed daily cadence rather than "when due", so all four runs
    // see the same number of reviews at the same instants. Comparing at a fixed
    // wall-clock instead would compare unequal amounts of work: Easy schedules
    // itself out of the week after one review, Good is reviewed three times.
    const endOfWeek = (grade: Grade) => {
      let card = newCardScheduling(NOW);
      for (let day = 0; day < 7; day += 1) {
        const now = new Date(NOW.getTime() + day * 86_400_000);
        card = projectCard(card, applyGrade(card, grade, now));
      }
      return card;
    };

    const stability = GRADES.map(grade => endOfWeek(grade).stability!);
    for (let i = 1; i < stability.length; i += 1) {
      expect(stability[i]!).toBeGreaterThan(stability[i - 1]!);
    }
  });

  it('leaves a week of Again with nothing learned', () => {
    const failed = (() => {
      let card = newCardScheduling(NOW);
      for (let day = 0; day < 7; day += 1) {
        card = projectCard(
          card,
          applyGrade(card, Grade.Again, new Date(NOW.getTime() + day * 86_400_000)),
        );
      }
      return card;
    })();

    expect(failed.lapses).toBe(7);
    expect(failed.stability!).toBeLessThan(1);
    // Still queued for today, not pushed out of sight.
    expect(new Date(failed.due).getTime() - NOW.getTime()).toBeLessThan(7 * 86_400_000);
  });

  it('collapses the interval and counts a lapse when a mature card is failed', () => {
    // Seven good days first, so there is a real interval to lose.
    let card = simulate(Grade.Good, 7).card;
    const matureInterval = card.scheduled_days;
    expect(matureInterval).toBeGreaterThan(1);

    const failedAt = new Date(card.due);
    const failure = applyGrade(card, Grade.Again, failedAt);
    card = projectCard(card, failure);

    expect(card.fsrs_state).toBe('relearning');
    expect(card.lapses).toBe(1);
    expect(new Date(card.due).getTime() - failedAt.getTime()).toBeLessThan(86_400_000);
    expect(card.scheduled_days).toBeLessThan(matureInterval);
    expect(card.stability).toBeLessThan(failure.log.stability_before!);
  });

  it('counts a lapse only on Again', () => {
    const card = cardInState('review');
    for (const grade of GRADES) {
      const projected = projectCard(card, applyGrade(card, grade, NOW));
      expect(projected.reps).toBe(card.reps + 1);
      expect(projected.lapses).toBe(card.lapses + (grade === Grade.Again ? 1 : 0));
    }
  });

  it('keeps difficulty inside the range the column allows across a long run', () => {
    let card = newCardScheduling(NOW);
    let now = NOW;
    const grades = [Grade.Good, Grade.Again, Grade.Hard, Grade.Easy, Grade.Good];
    for (let i = 0; i < 60; i += 1) {
      const grade = grades[i % grades.length]!;
      card = projectCard(card, applyGrade(card, grade, now));
      expect(card.difficulty!).toBeGreaterThanOrEqual(1);
      expect(card.difficulty!).toBeLessThanOrEqual(10);
      expect(card.stability!).toBeGreaterThan(0);
      now = new Date(card.due);
    }
  });
});
