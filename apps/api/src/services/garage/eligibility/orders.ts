import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Conquistas da superfície de PEDIDO, avaliadas depois que um pedido virou
 * `paid`. O caller é dono da transação.
 *
 * Codes:
 *   - CCC-005 — "Cliente da Casa" : pelo menos um pedido `paid` de kind
 *                                   `product` ou `mixed`
 *
 * `ticket` e `box` ficam de fora de propósito. Ingresso pode custar zero (o
 * grant marca `paid` do mesmo jeito), e caixa é a assinatura mensal, não
 * alguém escolhendo comprar um produto. Contar os dois daria a conquista de
 * "cliente" a quem nunca passou pela loja.
 *
 * `findFirst` e não `count`: a pergunta é `>= 1`, então o Postgres pode parar
 * na primeira linha. Isto roda em toda liquidação de pedido.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const storeOrder = await tx.order.findFirst({
    where: { userId, status: 'paid', kind: { in: ['product', 'mixed'] } },
    select: { id: true },
  });
  if (storeOrder) codes.push('CCC-005');

  return codes;
};
