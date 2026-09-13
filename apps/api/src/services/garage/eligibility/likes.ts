import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Conquistas da superfície de CURTIDA RECEBIDA, avaliadas depois que o
 * contador da garagem do AUTOR subiu. O caller é dono da transação.
 *
 * Codes:
 *   - COM-006 — "Em Chamas"          : Garage.likesReceived >= 50
 *   - COM-007 — "Ídolo da Garagem"   : Garage.likesReceived >= 250
 *
 * Recebe `garageId` e não `userId` porque o caminho da reação já resolveu a
 * garagem do autor (`authorGarageId`) — quem curte não é quem ganha.
 *
 * Lê a COLUNA `Garage.likesReceived`, nunca uma agregação de `FeedReaction`.
 * É o mesmo contrato de `services/garage/stats.ts` (§C4): a coluna é o número
 * que o membro vê na própria tela, mantido pelo `awardXp(post_like)` e
 * desfeito pelo `revertLikeXp`. Agregar aqui deixaria a conquista discordar
 * do contador exibido ao lado dela.
 *
 * Garagem que não resolve devolve lista vazia em vez de estourar: o autor
 * pode ter sido anonimizado entre a leitura e o award, e isso não pode virar
 * um 500 numa curtida.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  garageId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const garage = await tx.garage.findUnique({
    where: { id: garageId },
    select: { likesReceived: true },
  });
  if (!garage) return codes;

  if (garage.likesReceived >= 50) codes.push('COM-006');
  if (garage.likesReceived >= 250) codes.push('COM-007');

  return codes;
};
