import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Compute the community/feed-surface badges a user is eligible for AFTER
 * `feedPost.id` has just been created. Caller is responsible for running
 * this inside the same transaction as the create.
 *
 * COM-002 e COM-003 nunca tiveram regra e saíram do catálogo — ver a migration
 * `20260913120200_prune_unearnable_badges`. A comunidade recomeça em COM-004,
 * que chega no PR 2 com a superfície de comentários.
 *
 * Codes:
 *   - COM-001 — "Primeira Postagem"  : count(feedPost authored by user) >= 1
 *   - COM-008 — "Fotógrafo do Rolê"  : count(photos on the user's VISIBLE
 *                                      posts) >= 20
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
  _postId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const postCount = await tx.feedPost.count({
    where: { authorUserId: userId },
  });
  if (postCount >= 1) codes.push('COM-001');

  // COM-008 — conta FOTOS, não posts, e só as de post `visible`. Uma foto num
  // post derrubado pela moderação não é uma foto publicada, e deixá-la contar
  // premiaria justamente o conteúdo que foi removido.
  const photoCount = await tx.feedPostPhoto.count({
    where: { post: { authorUserId: userId, status: 'visible' } },
  });
  if (photoCount >= 20) codes.push('COM-008');

  return codes;
};
