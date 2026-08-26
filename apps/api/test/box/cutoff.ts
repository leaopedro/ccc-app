/**
 * A cutoff instant that is always in the future.
 *
 * These suites used to seed the literal `new Date('2026-08-26T00:00:00.000Z')`.
 * Every box route that gates on the cutoff — selection save, confirm,
 * skip/unskip, and the tier sweep — answers 409 `box_locked` once real time
 * passes that instant, so 13 tests across four files turned red on 2026-08-26
 * with no source change at all. A hardcoded future date is a fuse, not a
 * fixture: it only tells you it was wrong on the day it detonates.
 *
 * Tests that deliberately exercise the past-cutoff branch set their own instant
 * (`2000-01-01`, or a local `pastCutoff`) and must keep doing so — this helper
 * is only for the "box is still open" baseline.
 */
export const futureCutoff = (): Date => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
