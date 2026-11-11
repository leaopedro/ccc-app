// Lógica de seleção e montagem de payload da página de venda do Casa In Box,
// extraída em funções puras para serem testadas com `environment: 'node'`
// (apps/garage/vitest.config.ts:20 — sem jsdom, sem interação de navegador).
import type {
  PresaleCampaign,
  PresaleFulfillmentMethod,
  PresaleProduct,
} from '@ccc/shared/presale';

import { presaleCopy } from '~/copy/presale';
import {
  PresaleConflictError,
  PresaleInvalidRequestError,
  type StartPresaleCheckoutInput,
} from '~/lib/presale-api';

export type TierKind = 'basic' | 'premium';

/**
 * Cada tier é um produto comum do catálogo (emenda 2026-11-10); não existe
 * campo "tier" nem convenção de slug para diferenciá-los. O único sinal que a
 * API devolve é a contagem de variantes: o Premium embute a camiseta (P/M/G/GG)
 * no mesmo produto, o Basic não carrega item com tamanho. Não inventar outra
 * heurística sem reabrir essa decisão com o controlador.
 */
export function classifyTier(product: PresaleProduct): TierKind {
  return product.variants.length > 1 ? 'premium' : 'basic';
}

/** Seletor de tamanho só aparece em produto com mais de uma variante. */
export function hasSizeOptions(product: PresaleProduct): boolean {
  return product.variants.length > 1;
}

/** Lista de conteúdo da caixa, da copy — nunca da API (ver copy/presale.ts). */
export function tierContentsFor(product: PresaleProduct): string[] {
  return presaleCopy.tierContents[classifyTier(product)];
}

export function isFulfillmentSupported(
  product: Pick<PresaleProduct, 'canPickup' | 'canShip'>,
  method: PresaleFulfillmentMethod,
): boolean {
  return method === 'ship' ? product.canShip : product.canPickup;
}

/**
 * Espelha `computePresaleTotals` em apps/api/src/services/presale/totals.ts:
 * uma linha só (quantity 1), frete cobrado uma vez e só em 'ship'. É este
 * número que vira `expectedTotalCents` no POST — se o servidor recalcular
 * diferente, o checkout volta 409 (PresaleConflictError).
 */
export function computeExpectedTotalCents(
  priceCents: number,
  fulfillmentMethod: PresaleFulfillmentMethod,
  shippingFeeCents: number,
): number {
  return priceCents + (fulfillmentMethod === 'ship' ? shippingFeeCents : 0);
}

export type FaqItem = { question: string; body: string; requiresField?: string };

/** Omite a pergunta cujo dado comercial correspondente está vazio na campanha. */
export function visibleFaqItems(items: FaqItem[], campaign: PresaleCampaign): FaqItem[] {
  const record = campaign as unknown as Record<string, unknown>;
  return items.filter((item) => {
    if (!item.requiresField) return true;
    const value = record[item.requiresField];
    return value !== null && value !== undefined && value !== '';
  });
}

export function buildCheckoutPayload(input: {
  variantId: string;
  quantity?: number;
  fulfillmentMethod: PresaleFulfillmentMethod;
  expectedTotalCents: number;
  guest: { name: string; email: string; phone?: string };
  delivery?: NonNullable<StartPresaleCheckoutInput['delivery']>;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
}): StartPresaleCheckoutInput {
  return {
    items: [{ variantId: input.variantId, quantity: input.quantity ?? 1 }],
    fulfillmentMethod: input.fulfillmentMethod,
    expectedTotalCents: input.expectedTotalCents,
    guest: input.guest,
    // Entrega não se aplica à retirada (presaleCheckoutRequestSchema rejeita
    // `delivery` presente com fulfillmentMethod 'pickup') — descarta mesmo que
    // o chamador ainda tenha o objeto do formulário em memória.
    delivery: input.fulfillmentMethod === 'ship' ? input.delivery : undefined,
    acceptedTermsVersion: input.acceptedTermsVersion,
    acceptedPrivacyVersion: input.acceptedPrivacyVersion,
  };
}

export type CheckoutErrorCopy = { title: string; body: string };

/**
 * 409 e 422 precisam de mensagem DIFERENTE (brief): 409 é conflito de
 * preço/estoque (recarregar), 422 é payload inválido (bug nosso, não pedir
 * para tentar de novo com o mesmo payload).
 */
export function resolveCheckoutError(err: unknown): CheckoutErrorCopy {
  if (err instanceof PresaleConflictError) return presaleCopy.errors.conflict;
  if (err instanceof PresaleInvalidRequestError) return presaleCopy.errors.invalid;
  return presaleCopy.errors.generic;
}
