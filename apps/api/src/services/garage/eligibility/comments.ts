import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Conquistas da superfície de COMENTÁRIO, avaliadas depois que um
 * `FeedComment` acabou de ser criado. O caller é dono da transação.
 *
 * Codes:
 *   - COM-004 — "Bom de Papo"        : count(comentários visíveis) >= 1
 *   - COM-005 — "Voz da Comunidade"  : count(comentários visíveis) >= 10
 *
 * Só comentário `visible`. Um comentário derrubado pela moderação não é
 * participação na conversa, e deixá-lo contar premiaria justamente o que foi
 * removido. Mesma leitura que `feed.ts` faz para COM-008 nas fotos.
 *
 * Uma query para os dois limiares: a pergunta é a mesma contagem.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const commentCount = await tx.feedComment.count({
    where: { authorUserId: userId, status: 'visible' },
  });
  if (commentCount >= 1) codes.push('COM-004');
  if (commentCount >= 10) codes.push('COM-005');

  return codes;
};
