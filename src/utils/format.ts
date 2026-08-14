/**
 * Presentation helpers shared by views. Kept free of request state so they are
 * trivially testable.
 */
import { format, formatDistanceToNow, isPast } from 'date-fns';

/**
 * Money is stored in minor units throughout (PRD §5.2 invoicing) — this is the
 * only place it becomes a display string.
 */
export function formatMoney(amountMinor: number, currency = 'EUR', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/** Tuition ranges on public listings — "€3,000 – €5,500 per year". */
export function formatTuitionRange(
  minMinor: number | null,
  maxMinor: number | null,
  currency = 'EUR',
): string {
  if (minMinor == null && maxMinor == null) return 'On enquiry';
  if (minMinor != null && maxMinor != null && minMinor !== maxMinor) {
    return `${formatMoney(minMinor, currency)} – ${formatMoney(maxMinor, currency)}`;
  }
  return formatMoney((minMinor ?? maxMinor) as number, currency);
}

export function formatDate(date: Date | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!date) return '—';
  return format(date, pattern);
}

export function formatDateTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return format(date, 'd MMM yyyy, HH:mm');
}

export function relativeTime(date: Date | null | undefined): string {
  if (!date) return '—';
  return isPast(date)
    ? `${formatDistanceToNow(date)} ago`
    : `in ${formatDistanceToNow(date)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Truncates on a word boundary for card excerpts and meta descriptions. */
export function truncate(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxLength)}…`;
}

/** Turns SCREAMING_SNAKE enum values into readable text as a fallback. */
export function humaniseEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
