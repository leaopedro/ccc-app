import { prisma } from '@ccc/db';

export type SkipResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'conflict' };

const transition = async (
  membershipId: string,
  from: 'open' | 'skipped',
  to: 'skipped' | 'open',
): Promise<SkipResult> => {
  const ref = await prisma.monthlyBox.findFirst({
    where: { membershipId },
    orderBy: { cycleStart: 'desc' },
    select: { id: true, garageId: true },
  });
  if (!ref) return { kind: 'not_found' };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${ref.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: ref.id },
      select: { status: true, cutoffAt: true },
    });
    // Box locks at the cutoff instant even if the cron worker has not run yet.
    if (!box || box.status !== from || box.cutoffAt <= new Date()) {
      return { kind: 'conflict' as const };
    }
    await tx.monthlyBox.update({ where: { id: ref.id }, data: { status: to } });
    return { kind: 'ok' as const };
  });
};

/** Open box the member chose to skip this cycle. Selection is preserved. */
export const skipBox = (membershipId: string): Promise<SkipResult> =>
  transition(membershipId, 'open', 'skipped');

/** Reopen a skipped box while the cutoff has not passed. */
export const unskipBox = (membershipId: string): Promise<SkipResult> =>
  transition(membershipId, 'skipped', 'open');
