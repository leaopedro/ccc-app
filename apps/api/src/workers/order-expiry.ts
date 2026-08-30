/**
 * Varredura de expiracao de pedidos.
 *
 * Ate aqui nenhuma varredura tinha gatilho proprio. sweepExpiredOrdersForTier e
 * sweepExpiredOrdersForVariant so rodam quando outro checkout do mesmo tier ou
 * variant acontece, e expireSingleOrder so roda em GET /orders/:id. Um pedido
 * de um tier que ninguem mais compra ficava pendente para sempre, segurando
 * estoque, com a PaymentIntent viva e pagavel.
 *
 * Este worker e o gatilho que faltava. Ele tambem e o unico lugar que cancela a
 * PI de um pedido que venceu sem que nenhum webhook tenha chegado.
 *
 * Seguranca contra corrida: cada pedido e expirado na sua propria transacao,
 * com um `updateMany` condicionado a `status: 'pending'`. Se outra transacao
 * (uma varredura preguicosa disparada por outro checkout, ou outro tick deste
 * mesmo worker apos um restart) ja tiver expirado o pedido primeiro, o
 * `count` vem 0 e este tick nao libera a reserva de novo — o pedido so e
 * contado como expirado, e a PI so e cancelada, quando esta transacao e quem
 * de fato fez a transicao pending -> expired. Isso segue o mesmo padrao de
 * `expireSingleOrderInTransaction` (apps/api/src/services/orders/expire.ts).
 *
 * Atencao: `sweepExpiredOrdersForTier` e `sweepExpiredOrdersForVariant` NAO
 * seguem esse padrao — o `updateMany` delas nao tem guarda de `status`, e a
 * liberacao de estoque roda incondicionalmente para todo id lido no `findMany`
 * inicial, mesmo que uma transacao concorrente ja tenha expirado e liberado o
 * mesmo pedido entre a leitura e a escrita. Rodando este worker em paralelo
 * com essas varreduras, um pedido que caia nas duas ao mesmo tempo pode ter o
 * estoque liberado duas vezes. Ver o relatorio da tarefa para detalhes — nao
 * corrigido aqui por ser código não relacionado a esta tarefa.
 */
import { prisma } from '@ccc/db';
import type { FastifyBaseLogger } from 'fastify';
import cron from 'node-cron';

import { releaseAllReservationsForOrders } from '../services/orders/expire.js';
import type { StripeClient } from '../services/stripe/index.js';

export type OrderExpiryTickDeps = {
  stripe: StripeClient;
  now?: Date;
  log?: FastifyBaseLogger;
};

/** Teto por tick. Mesmo formato do QUERY_LIMIT do billing-reconcile. */
const QUERY_LIMIT = 200;

type StaleOrder = { id: string; provider: string; providerRef: string | null };

export const runOrderExpiryTick = async (
  deps: OrderExpiryTickDeps,
): Promise<{ expired: number; cancelled: number }> => {
  const now = deps.now ?? new Date();

  const stale = await prisma.order.findMany({
    where: { status: 'pending', expiresAt: { not: null, lt: now } },
    select: { id: true, provider: true, providerRef: true },
    orderBy: { expiresAt: 'asc' },
    take: QUERY_LIMIT,
  });

  if (stale.length === 0) return { expired: 0, cancelled: 0 };

  const expiredNow: StaleOrder[] = [];

  for (const order of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        // Guarda contra corrida: so libera reserva se esta transacao for
        // quem realmente tirou o pedido de `pending`. Ver nota de topo.
        const flipped = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: { status: 'expired' },
        });
        if (flipped.count === 0) return; // ja resolvido por outra varredura/tick

        await releaseAllReservationsForOrders(tx, [order.id]);
        expiredNow.push(order);
      });
    } catch (err) {
      deps.log?.error(
        { err, orderId: order.id },
        '[order-expiry] falha ao expirar pedido, seguindo para o proximo',
      );
    }
  }

  // Cancelar as PIs depois do commit. Best-effort: a Stripe 400a o cancel de
  // uma PI que ela propria ja fechou, e isso nao pode travar a fila.
  let cancelled = 0;
  for (const order of expiredNow) {
    if (order.provider !== 'stripe' || !order.providerRef) continue;
    try {
      await deps.stripe.cancelPaymentIntent(order.providerRef);
      cancelled += 1;
    } catch (err) {
      deps.log?.warn(
        { err, orderId: order.id, providerRef: order.providerRef },
        '[order-expiry] falha ao cancelar a PI do pedido expirado',
      );
    }
  }

  deps.log?.info({ expired: expiredNow.length, cancelled }, '[order-expiry] tick concluido');
  return { expired: expiredNow.length, cancelled };
};

export const startOrderExpiryWorker = (deps: {
  stripe: StripeClient;
  log: FastifyBaseLogger;
}): { stop: () => void } => {
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runOrderExpiryTick({ stripe: deps.stripe, log: deps.log });
    } catch (err) {
      deps.log.error({ err }, '[order-expiry] tick error');
    }
  });
  return {
    stop: () => {
      void task.stop();
    },
  };
};
