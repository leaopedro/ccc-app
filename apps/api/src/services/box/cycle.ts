const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable per-cycle key derived from the membership period start (UTC date). */
export const deriveCycleKey = (periodStart: Date): string => periodStart.toISOString().slice(0, 10);

/** Cutoff instant: N days before the period ends. */
export const computeCutoffAt = (periodEnd: Date, cutoffDaysBeforeRenewal: number): Date =>
  new Date(periodEnd.getTime() - cutoffDaysBeforeRenewal * DAY_MS);
