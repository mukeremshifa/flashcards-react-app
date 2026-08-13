import { describe, expect, it } from 'vitest';
import {
  addStudyDays,
  DAY_BOUNDARY_HOUR,
  isValidTimeZone,
  resolveTimeZone,
  startOfNextStudyDay,
  startOfStudyDay,
  studyDayKey,
  studyDayStart,
  studyDaysBetween,
  zonedParts,
  zonedTimeToUtc,
} from './day';

/**
 * SPEC §6: the day boundary is 04:00 local. Everything downstream — the daily
 * new-card cap here in P1, streaks and the heatmap in P3 — is only as correct as
 * this file, and it fails silently for anyone outside UTC.
 */

describe('the 04:00 boundary', () => {
  it('is 04:00, not midnight', () => {
    expect(DAY_BOUNDARY_HOUR).toBe(4);
  });

  it('puts 03:59 local on the previous study day', () => {
    const tz = 'Europe/Berlin'; // UTC+1 in January
    expect(studyDayKey(new Date('2026-01-15T02:59:00Z'), tz)).toBe('2026-01-14');
    expect(studyDayKey(new Date('2026-01-15T03:00:00Z'), tz)).toBe('2026-01-15');
  });

  it('rolls the study day exactly at 04:00 local, not before', () => {
    const tz = 'America/New_York'; // UTC-5 in January
    expect(studyDayKey(new Date('2026-01-15T08:59:59Z'), tz)).toBe('2026-01-14');
    expect(studyDayKey(new Date('2026-01-15T09:00:00Z'), tz)).toBe('2026-01-15');
  });

  it('handles half-hour and three-quarter-hour zones', () => {
    // Kolkata is UTC+05:30, so 04:00 local is 22:30 UTC the previous day.
    expect(startOfStudyDay(new Date('2026-06-15T12:00:00Z'), 'Asia/Kolkata')).toEqual(
      new Date('2026-06-14T22:30:00Z'),
    );
    // Chatham is UTC+12:45 in June (standard time), so 04:00 local is 15:15 UTC
    // on the *previous* UTC date.
    expect(startOfStudyDay(new Date('2026-06-15T12:00:00Z'), 'Pacific/Chatham')).toEqual(
      new Date('2026-06-14T15:15:00Z'),
    );
  });

  it('agrees with itself: the start of a day belongs to that day', () => {
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/Santiago', 'Pacific/Auckland']) {
      const now = new Date('2026-04-05T06:30:00Z');
      const start = startOfStudyDay(now, tz);
      expect(studyDayKey(start, tz)).toBe(studyDayKey(now, tz));
      expect(studyDayKey(new Date(start.getTime() - 1000), tz)).not.toBe(
        studyDayKey(now, tz),
      );
    }
  });
});

describe('DST transitions', () => {
  it('keeps the boundary at 04:00 local across a spring-forward', () => {
    const tz = 'America/New_York'; // 2026-03-08, 02:00 EST -> 03:00 EDT
    // The day before the shift: 04:00 EST = 09:00 UTC.
    expect(studyDayStart('2026-03-07', tz)).toEqual(new Date('2026-03-07T09:00:00Z'));
    // The day of the shift: 04:00 EDT = 08:00 UTC. The study day is 23 hours long.
    expect(studyDayStart('2026-03-08', tz)).toEqual(new Date('2026-03-08T08:00:00Z'));
    expect(
      studyDayStart('2026-03-08', tz).getTime() -
        studyDayStart('2026-03-07', tz).getTime(),
    ).toBe(23 * 3_600_000);
  });

  it('keeps the boundary at 04:00 local across a fall-back', () => {
    const tz = 'America/New_York'; // 2026-11-01, 02:00 EDT -> 01:00 EST
    // 04:00 on 31 Oct is still EDT (UTC-4); by 04:00 on 1 Nov the clocks have
    // already fallen back to EST (UTC-5), making that study day 25 hours long.
    expect(studyDayStart('2026-10-31', tz)).toEqual(new Date('2026-10-31T08:00:00Z'));
    expect(studyDayStart('2026-11-01', tz)).toEqual(new Date('2026-11-01T09:00:00Z'));
    expect(
      studyDayStart('2026-11-01', tz).getTime() -
        studyDayStart('2026-10-31', tz).getTime(),
    ).toBe(25 * 3_600_000);
  });

  it('does not skip or repeat a study day across a transition', () => {
    const tz = 'Europe/London'; // clocks go forward 2026-03-29 01:00 GMT
    const seen: string[] = [];
    for (let hour = 0; hour < 24 * 4; hour += 1) {
      const key = studyDayKey(new Date(Date.UTC(2026, 2, 27, hour)), tz);
      if (key !== seen.at(-1)) seen.push(key);
    }
    // Strictly increasing, one calendar day at a time: no day skipped by the
    // spring-forward, none visited twice.
    expect(seen).toEqual([...seen].sort());
    for (let i = 1; i < seen.length; i += 1) {
      expect(studyDaysBetween(seen[i - 1]!, seen[i]!)).toBe(1);
    }
    expect(seen[0]).toBe('2026-03-26');
    expect(seen.at(-1)).toBe('2026-03-30');
  });

  it('survives a zone whose clocks change at midnight', () => {
    // Santiago shifts at 24:00 local, so the 04:00 boundary is never inside the gap.
    const tz = 'America/Santiago';
    const start = studyDayStart('2026-09-06', tz);
    expect(zonedParts(start, tz).hour).toBe(4);
    expect(studyDayKey(start, tz)).toBe('2026-09-06');
  });
});

describe('zonedTimeToUtc', () => {
  it('round-trips every hour of a normal day', () => {
    const tz = 'Australia/Lord_Howe'; // +10:30 / +11:00, a 30-minute DST shift
    for (let hour = 0; hour < 24; hour += 1) {
      const parts = { year: 2026, month: 6, day: 12, hour, minute: 15, second: 0 };
      expect(zonedParts(zonedTimeToUtc(parts, tz), tz)).toEqual(parts);
    }
  });

  it('resolves a wall-clock time that never happened to the moment clocks jumped', () => {
    const tz = 'America/New_York';
    const skipped = zonedTimeToUtc(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      tz,
    );
    // 02:30 EST does not exist; 03:30 EDT is the same instant the clocks reached.
    expect(skipped).toEqual(new Date('2026-03-08T07:30:00Z'));
  });
});

describe('day arithmetic', () => {
  it('adds and subtracts whole calendar days', () => {
    expect(addStudyDays('2026-02-28', 1)).toBe('2026-03-01'); // not a leap year
    expect(addStudyDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addStudyDays('2026-03-08', 7)).toBe('2026-03-15');
  });

  it('counts days between keys regardless of DST in between', () => {
    expect(studyDaysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(studyDaysBetween('2026-03-31', '2026-03-01')).toBe(-30);
  });

  it('points at the next reset for the "come back later" empty state', () => {
    const tz = 'Europe/Berlin';
    const now = new Date('2026-01-15T20:00:00Z');
    expect(startOfNextStudyDay(now, tz)).toEqual(new Date('2026-01-16T03:00:00Z'));
  });
});

describe('timezone resolution', () => {
  it('accepts real zones and rejects nonsense', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Middle/Earth')).toBe(false);
  });

  it('falls back to UTC rather than throwing on a bad stored value', () => {
    expect(resolveTimeZone('Middle/Earth')).toBe('UTC');
    expect(resolveTimeZone(null)).toBe('UTC');
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});
