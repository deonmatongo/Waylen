import { describe, expect, it } from 'vitest';
import { generateSlots, parseGraphDateTime } from '../../src/services/availability.service.js';
import { parseInZone, toLocalIso, zonedTimeToUtc } from '../../src/utils/timezone.js';

const DUBLIN = 'Europe/Dublin';

describe('timezone conversion', () => {
  it('maps Dublin wall time to UTC either side of a DST change', () => {
    // GMT (UTC+0) in winter, IST (UTC+1) after the last Sunday of March.
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 27, hour: 9 }, DUBLIN)?.toISOString()).toBe(
      '2026-03-27T09:00:00.000Z',
    );
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 30, hour: 9 }, DUBLIN)?.toISOString()).toBe(
      '2026-03-30T08:00:00.000Z',
    );
  });

  it('returns null for a wall time skipped by spring-forward', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, DUBLIN)).toBeNull();
  });

  it('picks the earlier instant for a repeated autumn wall time', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, DUBLIN)?.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
  });

  it('round-trips through toLocalIso', () => {
    const date = new Date('2026-07-01T08:00:00Z');
    expect(toLocalIso(date, DUBLIN)).toBe('2026-07-01T09:00:00');
    expect(toLocalIso(date, 'America/New_York')).toBe('2026-07-01T04:00:00');
  });

  it('reads offset-less form values in the business zone and honours explicit offsets', () => {
    expect(parseInZone('2026-07-01T09:00', DUBLIN).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(parseInZone('2026-07-01T09:00:00Z', DUBLIN).toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(Number.isNaN(parseInZone('not a date', DUBLIN).getTime())).toBe(true);
  });

  it('parses Graph local date-times in the zone they were requested in', () => {
    expect(parseGraphDateTime('2026-07-01T09:00:00.0000000', DUBLIN).toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(parseGraphDateTime('2026-07-01T09:00:00.0000000', 'UTC').toISOString()).toBe(
      '2026-07-01T09:00:00.000Z',
    );
  });
});

describe('generateSlots', () => {
  const slotsFor = (now: string, days: number, timeZone = DUBLIN, extra = {}) =>
    generateSlots({
      now: new Date(now),
      horizon: new Date(new Date(now).getTime() + days * 86_400_000),
      timeZone,
      ...extra,
    });

  it('keeps 09:00 local across the March DST boundary', () => {
    // Friday 27 Mar 2026 (GMT) -> Monday 30 Mar 2026 (IST).
    const slots = slotsFor('2026-03-26T12:00:00Z', 7);
    const firstOf = (day: string) => slots.find((s) => toLocalIso(s, DUBLIN).startsWith(day));

    expect(firstOf('2026-03-27')?.toISOString()).toBe('2026-03-27T09:00:00.000Z');
    expect(firstOf('2026-03-30')?.toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('keeps 09:00 local across the October DST boundary', () => {
    const slots = slotsFor('2026-10-22T12:00:00Z', 7);
    const firstOf = (day: string) => slots.find((s) => toLocalIso(s, DUBLIN).startsWith(day));

    expect(firstOf('2026-10-23')?.toISOString()).toBe('2026-10-23T08:00:00.000Z');
    expect(firstOf('2026-10-26')?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
  });

  it('only produces weekday slots inside local working hours', () => {
    const slots = slotsFor('2026-03-20T12:00:00Z', 21);
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const local = toLocalIso(slot, DUBLIN);
      const weekday = new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay();
      expect([0, 6]).not.toContain(weekday);
      const hour = Number(local.slice(11, 13));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
    }
    // Ten forty-five-minute sessions fit in 09:00-17:00 (the last starts 16:15).
    const firstDay = slots.filter((s) => toLocalIso(s, DUBLIN).startsWith(toLocalIso(slots[0]!, DUBLIN).slice(0, 10)));
    expect(firstDay).toHaveLength(10);
  });

  it('removes taken and calendar-busy slots', () => {
    const all = slotsFor('2026-03-20T12:00:00Z', 3);
    const taken = new Set([all[0]!.getTime()]);
    const busy = [{ start: all[1]!, end: new Date(all[1]!.getTime() + 60_000) }];

    const filtered = slotsFor('2026-03-20T12:00:00Z', 3, DUBLIN, { takenTimes: taken, busyBlocks: busy });

    expect(filtered).not.toContainEqual(all[0]);
    expect(filtered).not.toContainEqual(all[1]);
    expect(filtered).toHaveLength(all.length - 2);
  });

  it('never offers a slot in the past or beyond the horizon', () => {
    const now = new Date('2026-03-26T12:00:00Z');
    const horizon = new Date('2026-03-28T12:00:00Z');
    const slots = generateSlots({ now, horizon, timeZone: DUBLIN });
    expect(slots.every((s) => s > now && s < horizon)).toBe(true);
  });
});
