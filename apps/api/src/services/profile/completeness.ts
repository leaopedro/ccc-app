import { prisma } from '@ccc/db';
import { LIVE_DOCUMENT_STATUSES } from '@ccc/shared/documents';
import type { MissingFieldKey, ProfileScope } from '@ccc/shared/profile-status';

// The single source of truth for what each gate demands. Routes never
// hardcode field lists.
export const REQUIRED_BY_SCOPE: Record<ProfileScope, readonly MissingFieldKey[]> = {
  checkout: ['cpf', 'phone'],
  subscription: ['cpf', 'phone', 'document'],
};

export type ProfileCompleteness = {
  cpf: boolean;
  phone: boolean;
  document: boolean;
};

const present = (value: string | null): boolean => typeof value === 'string' && value.length > 0;

/**
 * One query, three booleans. Returns null when the user row is gone, which
 * callers translate to 401 — the access token outlived its user.
 *
 * `pending` counts as present: optimistic auto-approval means sending the
 * document unblocks the subscription immediately. `rejected` does not count,
 * so a rejection re-blocks the gate and the member is asked for a new file.
 */
export const loadProfileCompleteness = async (
  userId: string,
): Promise<ProfileCompleteness | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      cpf: true,
      phone: true,
      documents: {
        where: { status: { in: [...LIVE_DOCUMENT_STATUSES] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return null;
  return {
    cpf: present(user.cpf),
    phone: present(user.phone),
    document: user.documents.length > 0,
  };
};

export const missingFor = (
  completeness: ProfileCompleteness,
  scope: ProfileScope,
): MissingFieldKey[] => REQUIRED_BY_SCOPE[scope].filter((key) => !completeness[key]);
