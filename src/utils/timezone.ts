/**
 * Timezone helpers built on `Intl` (no extra dependency).
 *
 * The server runs in UTC on Vercel, but working hours, slot labels and Graph
 * calendar entries all belong to the business timezone (`MS_GRAPH_TIMEZONE`,
 * an IANA name such as Europe/Dublin). These helpers convert between UTC
 * instants and wall-clock times in that zone, DST included.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether `timeZone` is a name this runtime's Intl understands. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of `date` as seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year as number,
    month: values.month as number,
    day: values.day as number,
    hour: (values.hour as number) % 24,
    minute: values.minute as number,
    second: values.second as number,
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (positive = east). */
export function getOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads the given time.
 * Returns null when that wall time does not exist (spring-forward gap).
 * For an ambiguous time (autumn overlap) the earlier instant wins.
 */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date | null {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = wall;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);

  // Two passes settle the offset even when the guess sits on the far side of
  // a DST transition.
  const firstOffset = getOffsetMs(new Date(guess), timeZone);
  let instant = guess - firstOffset;
  const secondOffset = getOffsetMs(new Date(instant), timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;

  // Round-trip to reject wall times skipped by a forward clock change.
  const back = getZonedParts(new Date(instant), timeZone);
  if (back.hour !== hour || back.minute !== minute || back.day !== day) return null;

  // Prefer the earlier instant for an ambiguous (repeated) wall time.
  const earlier = instant - 3_600_000;
  const earlierParts = getZonedParts(new Date(earlier), timeZone);
  if (earlierParts.hour === hour && earlierParts.minute === minute && earlierParts.day === day) {
    return new Date(earlier);
  }
  return new Date(instant);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * Parses a form value. An explicit offset ("...Z", "+01:00") is honoured;
 * an offset-less `datetime-local` value ("2026-10-20T10:00") is read as wall
 * time in `timeZone`. Returns an Invalid Date when unparseable.
 */
export function parseInZone(input: string, timeZone: string): Date {
  const trimmed = input.trim();
  const local = LOCAL_INPUT.exec(trimmed);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    return (
      zonedTimeToUtc(
        { year: +y!, month: +mo!, day: +d!, hour: +h!, minute: +mi!, second: s ? +s : 0 },
        timeZone,
      ) ?? new Date(NaN)
    );
  }
  return new Date(trimmed);
}

/** `YYYY-MM-DDTHH:mm:ss` wall time in `timeZone`, the shape Graph expects. */
export function toLocalIso(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Calendar-day key (YYYY-MM-DD) in `timeZone`, for grouping slots by day. */
export function dayKey(date: Date, timeZone: string): string {
  return toLocalIso(date, timeZone).slice(0, 10);
}

/** Display helpers bound to one timezone, handed to views and emails. */
export function createZonedFormatter(timeZone: string) {
  const make = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat('en-GB', { timeZone, ...options });

  const dateTime = make({
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const longDate = make({ weekday: 'long', day: 'numeric', month: 'long' });
  const time = make({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const zoneName = make({ timeZoneName: 'short' });

  return {
    timeZone,
    /** "20 Oct 2026, 10:00" */
    dateTime: (date: Date): string => dateTime.format(date).replace(' at ', ', '),
    /** "Tuesday 20 October" */
    longDate: (date: Date): string => longDate.format(date),
    /** "10:00" */
    time: (date: Date): string => time.format(date),
    /** "20 Oct 2026, 10:00 IST" — for emails, where there is no page-level zone note. */
    dateTimeWithZone: (date: Date): string => {
      const zone = zoneName.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value;
      return `${dateTime.format(date).replace(' at ', ', ')}${zone ? ` ${zone}` : ''}`;
    },
    dayKey: (date: Date): string => dayKey(date, timeZone),
  };
}

export type ZonedFormatter = ReturnType<typeof createZonedFormatter>;
