import { prisma } from '@ccc/db';

import { isUniqueConstraintError } from '../../lib/prisma-errors.js';

/**
 * Distinct reporters with an OPEN report needed before the target is hidden
 * automatically.
 *
 * Counting distinct reporters, not rows, is the point: the unique index already
 * stops one person filing twice, and this makes the intent explicit for anyone
 * changing the threshold later.
 */
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

export type ReportTarget =
  | { kind: 'post'; postId: string }
  | { kind: 'comment'; commentId: string };

export type ReportResult = {
  /** false when this reporter had already reported this target. */
  created: boolean;
  autoHidden: boolean;
};

/**
 * File a report and auto-hide the target once enough distinct people have.
 *
 * Auto-hide sets `status: 'hidden'` with `hiddenById: null`. Null there means
 * "hidden by the system", which is how a moderator later tells an automatic
 * hide from their own action. It never sets `removed`: removal stays a human
 * decision, taken from the admin moderation queue.
 *
 * Reporting content that is already hidden is allowed and simply adds to the
 * count. Dismissing a report does not un-hide anything either — reverting is a
 * moderator action, not an emergent property of the counter.
 */
export const fileReport = async (input: {
  target: ReportTarget;
  reporterUserId: string;
  reason: string;
}): Promise<ReportResult> => {
  const { target, reporterUserId, reason } = input;

  let created = true;
  try {
    await prisma.report.create({
      data:
        target.kind === 'post'
          ? { targetKind: 'post', postId: target.postId, reporterUserId, reason }
          : { targetKind: 'comment', commentId: target.commentId, reporterUserId, reason },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    // Same reporter, same target. Not an error: fall through and re-evaluate
    // the threshold, which keeps the endpoint idempotent.
    created = false;
  }

  const where =
    target.kind === 'post'
      ? { postId: target.postId, status: 'open' as const }
      : { commentId: target.commentId, status: 'open' as const };

  const distinctReporters = await prisma.report.findMany({
    where,
    select: { reporterUserId: true },
    distinct: ['reporterUserId'],
  });

  if (distinctReporters.length < AUTO_HIDE_REPORT_THRESHOLD) {
    return { created, autoHidden: false };
  }

  // Guarded update: only flip a target that is still visible, so a second
  // report crossing the threshold does not overwrite a moderator's `removed`
  // or re-stamp hiddenAt.
  const hidden =
    target.kind === 'post'
      ? await prisma.feedPost.updateMany({
          where: { id: target.postId, status: 'visible' },
          data: { status: 'hidden', hiddenAt: new Date(), hiddenById: null },
        })
      : await prisma.feedComment.updateMany({
          where: { id: target.commentId, status: 'visible' },
          data: { status: 'hidden', hiddenAt: new Date(), hiddenById: null },
        });

  return { created, autoHidden: hidden.count > 0 };
};
