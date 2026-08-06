import type Stripe from 'stripe';

import { BillingActionError } from './errors.js';

/**
 * Descobre qual SubscriptionItem da Stripe e o item de PLANO.
 *
 * Nao existe "o item do plano" por posicao. O comentario em services/stripe/index.ts
 * ja documenta que, com add-ons vinculados, a ordem dos itens nao e contratual.
 * A unica fonte confiavel e o catalogo: o item de plano e aquele cujo price.id
 * esta no conjunto de PremiumPlanPrice.stripePriceId.
 *
 * Zero ou mais de um casamento e ERRO, nao chute. Escolher o item errado trocaria
 * o preco de um modulo pelo preco de um plano, cobrando o membro errado e
 * corrompendo o snapshot. Falhar visivelmente e estritamente melhor.
 */
export const resolvePlanSubscriptionItemId = ({
  subscription,
  planPriceIds,
}: {
  subscription: Stripe.Subscription;
  planPriceIds: ReadonlySet<string>;
}): string => {
  const matches = subscription.items.data.filter((item) => planPriceIds.has(item.price.id));

  if (matches.length !== 1) {
    throw new BillingActionError(
      'AmbiguousPlanItem',
      `expected exactly one plan item on the subscription, found ${matches.length}`,
      {
        subscriptionId: subscription.id,
        matchCount: matches.length,
        itemPriceIds: subscription.items.data.map((i) => i.price.id),
      },
    );
  }

  return matches[0]!.id;
};
