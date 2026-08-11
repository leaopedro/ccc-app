/**
 * Shared date/currency formatting for the assinaturas and premium screens.
 * Consolidated here (instead of the usual per-screen local fmtDate/fmtBRL)
 * because the user asked explicitly for one consistent date scheme across
 * both sections — see design-foundation-report.md.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type DateParts = { day: string; month: string; year: string };

// pt-BR short-month formatting puts a trailing period on the abbreviation
// (e.g. "ago."); strip it so output reads "18 ago 2026", not "18 ago. 2026".
function dateParts(iso: string): DateParts {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(new Date(iso));

  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').replace(/\.$/, '');
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return { day, month, year };
}

export function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function fmtDate(iso: string): string {
  const { day, month, year } = dateParts(iso);
  return `${day} ${month} ${year}`;
}

export function fmtRelative(iso: string, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const target = new Date(iso);

  // Diff by calendar day (midnight to midnight), not raw milliseconds, so
  // "hoje"/"amanhã"/"ontem" match wall-clock intuition regardless of the
  // time-of-day component on either timestamp.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);
  const absDays = Math.abs(diffDays);

  if (absDays < 30) return rtf.format(diffDays, 'day');
  if (absDays < 365) return rtf.format(Math.round(diffDays / 30), 'month');
  return rtf.format(Math.round(diffDays / 365), 'year');
}

export function fmtPeriod(startIso: string, endIso: string): string {
  const start = dateParts(startIso);
  const end = dateParts(endIso);

  const startStr =
    start.year === end.year
      ? `${start.day} ${start.month}`
      : `${start.day} ${start.month} ${start.year}`;
  const endStr = `${end.day} ${end.month} ${end.year}`;

  return `${startStr} – ${endStr}`;
}
