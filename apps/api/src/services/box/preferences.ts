import { BOX_SETTINGS_SINGLETON_ID } from '@ccc/shared/admin-box';
import { prisma } from '@ccc/db';

import { isFreeShippingCep } from './charge.js';

type CepRange = { from: string; to: string };

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

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Garage" WHERE id = ${ref.garageId} FOR UPDATE`;
    const box = await tx.monthlyBox.findUnique({
      where: { id: ref.id },
      select: { status: true, cutoffAt: true },
    });
    if (!box || box.status !== 'open' || box.cutoffAt <= new Date()) {
      return { kind: 'conflict' as const };
    }
    const data: { autoSendOptIn: boolean; shippingAddressId?: string; shippingCents?: number } = {
      autoSendOptIn: args.autoSendOptIn,
    };
    if (args.shippingAddressId) {
      const address = await tx.shippingAddress.findUnique({
        where: { id: args.shippingAddressId },
        select: { userId: true, postalCode: true },
      });
      if (!address || address.userId !== args.userId) return { kind: 'bad_address' as const };
      // Compute shipping the same way confirm does, so the cutoff worker skips an
      // auto-send box outside the free-shipping region instead of shipping unpaid
      // freight. Without this, shippingCents stays 0 and the worker treats a
      // non-free address as free.
      const settings = await tx.boxSettings.findUniqueOrThrow({
        where: { id: BOX_SETTINGS_SINGLETON_ID },
      });
      const ranges = (settings.freeShippingCepRanges as CepRange[]) ?? [];
      data.shippingAddressId = args.shippingAddressId;
      data.shippingCents = isFreeShippingCep(address.postalCode, ranges)
        ? 0
        : settings.shippingFeeCents;
    }
    await tx.monthlyBox.update({ where: { id: ref.id }, data });
    return { kind: 'ok' as const };
  });
};
