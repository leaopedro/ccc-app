import { prisma } from '@ccc/db';

export type PrefsResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'bad_address' };

export const setBoxPreferences = async (args: {
  userId: string;
  membershipId: string;
  autoSendOptIn: boolean;
  shippingAddressId?: string;
}): Promise<PrefsResult> => {
  const ref = await prisma.monthlyBox.findFirst({
    where: { membershipId: args.membershipId },
    orderBy: { cycleStart: 'desc' },
    select: { id: true, garageId: true },
  });
  if (!ref) return { kind: 'not_found' };

  if (args.shippingAddressId) {
    const address = await prisma.shippingAddress.findUnique({
      where: { id: args.shippingAddressId },
      select: { userId: true },
    });
    if (!address || address.userId !== args.userId) return { kind: 'bad_address' };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${ref.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: ref.id },
      select: { status: true, cutoffAt: true },
    });
    if (!box || box.status !== 'open' || box.cutoffAt <= new Date()) {
      return { kind: 'conflict' as const };
    }
    await tx.monthlyBox.update({
      where: { id: ref.id },
      data: {
        autoSendOptIn: args.autoSendOptIn,
        ...(args.shippingAddressId ? { shippingAddressId: args.shippingAddressId } : {}),
      },
    });
    return { kind: 'ok' as const };
  });
};
